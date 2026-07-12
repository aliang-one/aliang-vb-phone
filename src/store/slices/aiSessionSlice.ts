import type { StateCreator } from 'zustand';
import type { AgentCommandInfo, VibeCodingRun, VibeStatus } from '../../data/platformModels';
import { platformTransport } from '../../services/platformTransport';
import { refreshSessionCommands as refreshSessionCommandsApi } from '../../api/sessions';
import { normalizeProvider, providerLabel } from '../../utils/modelIntensity';
import {
  isAuthoritativeRunLive,
  isSessionTurnActive,
} from '../../utils/sessionPhase';
import type { AgentProvider, ControlCenterState } from '../types';
import {
  activityNowMs,
  attachDeviceRelations,
  capEventDetailCache,
  createId,
  demoteIdleSessions,
  event,
  evictStaleSessionDetail,
  fileNameFromPath,
  formatActivityLabel,
  mergeEarlierAgentMessages,
  mergeIds,
  mergeVibeRunSnapshot,
  nowTime,
  serverAiSessionToVibeRun,
} from '../internals';

type AiSessionSlice = Pick<
  ControlCenterState,
  | 'vibeRuns' | 'previewLinks'
  | 'startAgentSession' | 'loadAgentSessionDetail' | 'pauseAgentSession'
  | 'interruptAgentSession' | 'resumeAgentSession' | 'terminateAgentSession' | 'updateAgentSession'
  | 'deleteAgentSession' | 'appendAgentMessage' | 'loadEarlierAgentMessages'
  | 'retryAgentMessage' | 'dismissFailedMessage' | 'cacheStructuredDetail'
  | 'markSessionViewed' | 'clearCurrentlyViewedSession' | 'demoteIdleSessions'
  | 'refreshSessionCommands'
>;

const pendingMessageSends = new Set<string>();

// On-demand `/`-command discovery: 1h auto-gate + in-flight dedup, keyed by
// project (commands are project-scoped). Pure in-memory — a restart re-fetches.
const COMMANDS_REFRESH_MIN_INTERVAL_MS = 60 * 60 * 1000;
const lastCommandsRefreshAt = new Map<string, number>();
const refreshingCommands = new Map<string, Promise<AgentCommandInfo[]>>();

const messageSendKey = (sessionId: string, content: string, mode: 'voice' | 'text') =>
  `${sessionId}:${mode}:${content}`;

const providerWireValue = (provider: AgentProvider): 'codex' | 'claudecode' | 'opencode' =>
  provider === 'claude_code'
    ? 'claudecode'
    : provider === 'opencode'
      ? 'opencode'
      : 'codex';

const providerDefaultModelLabel = (provider: AgentProvider): string =>
  provider === 'codex' ? 'GPT-5 Codex' : providerLabel(provider);

export const createAiSessionSlice: StateCreator<ControlCenterState, [], [], AiSessionSlice> = (set, get) => ({
  vibeRuns: [],
  previewLinks: [],

  refreshSessionCommands: async (sessionId, options) => {
    const force = options?.force ?? false;
    const run = get().vibeRuns.find(r => r.id === sessionId);
    const projectId = run?.projectId ?? '';
    // Key by project (commands are project-scoped); fall back to sessionId.
    const key = projectId || sessionId;

    // In-flight dedup: reuse a running refresh for the same project so repeated
    // ToolsMenu opens / button clicks coalesce into ONE request.
    const inFlight = refreshingCommands.get(key);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<AgentCommandInfo[]> => {
      // 1h auto-gate: only the force path (manual button) bypasses it. First
      // time (no timestamp) counts as stale → ask for fresh data.
      const last = lastCommandsRefreshAt.get(key) ?? 0;
      const wantsFetch = force || Date.now() - last > COMMANDS_REFRESH_MIN_INTERVAL_MS;
      let commands: AgentCommandInfo[];
      try {
        const res = await refreshSessionCommandsApi(sessionId, wantsFetch);
        // Record only genuine agent fetches so the gate reflects real freshness
        // (cache/persisted/offline responses don't advance it).
        if (res.source === 'agent') lastCommandsRefreshAt.set(key, Date.now());
        commands = res.commands ?? [];
      } catch {
        // Discovery is best-effort: a 404 (server not yet updated), timeout, or
        // agent-offline must NOT crash the ToolsMenu auto-refresh or the
        // composer refresh button. Fall back to whatever the project already has.
        return get().projects.find(p => p.id === projectId)?.availableCommands ?? [];
      }
      // Mirror into the project so the typeahead + ToolsMenu read one source.
      if (projectId) {
        set(state => {
          if (!state.projects.some(p => p.id === projectId)) return {};
          return {
            projects: state.projects.map(p =>
              p.id === projectId ? { ...p, availableCommands: commands } : p,
            ),
          };
        });
      }
      return commands;
    })();

    refreshingCommands.set(key, promise);
    try {
      return await promise;
    } finally {
      refreshingCommands.delete(key);
    }
  },

  startAgentSession: async (input) => {
    const provider = providerWireValue(input.provider);
    // Concrete model name forwarded to the agent CLI as `--model` (e.g.
    // "glm-5.2-xhigh"). Empty/omitted => the CLI's own default model is used.
    // Do NOT send a display label — the gateway forwards `model` verbatim, so a
    // label like "Claude Code" would pollute the CLI's model selection.
    const sentModel = input.model?.trim() || undefined;
    // Reasoning effort. '' => omit so the agent/gateway use their own default.
    const sentEffort = input.effort?.trim() || undefined;
    // Presentation label for VibeCodingRun.model / UI copy only (falls back to
    // the provider name when no concrete model is set). NOT sent to the agent.
    const modelLabel =
      sentModel ?? providerDefaultModelLabel(input.provider);

    if (get().serverMode) {
      try {
        let projectId = input.projectId;
        if (!projectId) {
          projectId = await get().createProject({
            deviceId: input.deviceId,
            path: input.directory,
            name: fileNameFromPath(input.directory),
            description: 'Created from mobile VibeCoding.',
          });
        }
        // Send the objective as the FIRST MESSAGE. The server creates the
        // session AND dispatches ai.session.create + ai.message together so the
        // agent starts turn 1 immediately — an empty create (objective as
        // metadata only) would idle forever, since the agent runs a turn only
        // on ai.message, never on ai.session.create.
        const session = await platformTransport.createAiSession({
          device_id: input.deviceId,
          project_id: projectId || undefined,
          project_path: input.directory,
          mode: 'vibe',
          message: input.objective,
          model: sentModel,
          provider,
          tool: provider,
          risk: input.provider === 'claude_code' ? 'medium' : 'low',
          effort: sentEffort,
        });

        const sessionId = session.session_id;

        // Seed the local run from the SERVER's response: real status (running,
        // because a turn was just dispatched), real transcript (the first
        // message the server stored), real currentStep. No fabricated "running"
        // and no locally-invented first message (which would duplicate the
        // server's). provider/projectId/directory are client-known overrides.
        const nextRun: VibeCodingRun = {
          ...serverAiSessionToVibeRun(session, get().devices, get().projects),
          provider: input.provider,
          projectId,
          directory: input.directory,
        };

        set(state => ({
          // Dedup by id: the server creates idempotently (same payload → same
          // session_id), so a double-tap or a WS-broadcast + REST-response
          // race could otherwise reinsert the same id and duplicate the list
          // (React key collision). Drop any existing run with this id first.
          vibeRuns: [nextRun, ...state.vibeRuns.filter(run => run.id !== sessionId)],
          devices: state.devices.map(device =>
            device.id === input.deviceId
              ? { ...device, activeSessionIds: [sessionId, ...device.activeSessionIds] }
              : device
          ),
          events: [
            event('agent.session.started', 'Agent session started', `${modelLabel} started in ${input.directory}.`, 'running', {
              deviceId: input.deviceId,
              projectId,
              sessionId,
            }),
            ...state.events,
          ],
        }));

        return sessionId;
      } catch (error) {
        console.warn('[store] Failed to create agent session:', error);
        throw error;
      }
    }

    throw new Error('Platform connection is required to start a VibeCoding session.');
  },

  loadAgentSessionDetail: async (sessionId, options) => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before loading a VibeCoding session.');
    }
    // `refresh: true` -> server-side `?refresh=true` forces `loadAiMessagePageForSession`
    // to bypass the page cache and re-ask the agent (see shouldAskAgent in the server
    // handler). Used by the chat screen's pull-to-refresh / retry so an empty/offline
    // result can actually recover instead of being stuck on the cached empty page.
    const serverSession = await platformTransport.loadAiSession(sessionId, {
      refresh: options?.refresh,
    });
    set(state => {
      const mapped = serverAiSessionToVibeRun(
        serverSession,
        state.devices,
        state.projects,
      );
      // Only mark the session as "detail loaded" when we actually received
      // transcript content OR a definitive (non-transient) answer from the
      // agent. A `skipped_offline` / `failed` result with no transcript must
      // stay "not loaded" so the chat screen re-attempts on reopen / recovery
      // instead of freezing on a blank conversation whose top bar already reads
      // DONE — the run snapshot that flips `status` to completed never carries
      // the transcript (refreshFromServer / mergeVibeRunSnapshot skip it when the
      // snapshot has no detail), so a transient-empty fetch is the ONLY thing
      // that can fill it, and it must remain retryable.
      const transientEmpty =
        mapped.transcript.length === 0 &&
        (mapped.detailRefreshStatus === 'skipped_offline' ||
          mapped.detailRefreshStatus === 'failed');
      const nextRun = {
        ...mapped,
        detailLoadedAt: transientEmpty ? undefined : nowTime(),
      };
      const exists = state.vibeRuns.some(run => run.id === nextRun.id);
      const vibeRuns = evictStaleSessionDetail(exists ? state.vibeRuns.map(run => run.id === nextRun.id ? mergeVibeRunSnapshot(run, nextRun) : run) : [nextRun, ...state.vibeRuns]);
      return {
        vibeRuns,
        devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
      };
    });
  },

  loadEarlierAgentMessages: async sessionId => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before loading VibeCoding history.');
    }
    const current = get().vibeRuns.find(run => run.id === sessionId);
    const before = current?.transcriptPage?.nextBeforeCursor;
    if (!before || current?.transcriptPage?.hasMore === false) return;

    const response = await platformTransport.loadAiSessionMessages(sessionId, {
      limit: current.transcriptPage?.limit || 40,
      before,
    });
    const earlierMessages = response.messages.map(message => ({
      id: message.id,
      role: message.role,
      mode: message.mode as 'voice' | 'text' | 'action' | undefined,
      content: message.content,
      timestamp: message.timestamp,
      index: message.index,
    }));

    set(state => {
      const vibeRuns = state.vibeRuns.map(run => {
        if (run.id !== sessionId) return run;
        const transcript = mergeEarlierAgentMessages(
          run.transcript,
          earlierMessages,
        );
        return {
          ...run,
          transcript,
          transcriptPage: {
            limit: response.page.limit,
            count: response.page.count,
            totalCount: response.page.total_count,
            hasMore: response.page.has_more,
            nextBeforeCursor: response.page.next_before_cursor,
            nextBeforeMessageId: response.page.next_before_message_id,
            cacheStatus: response.page.cache_status,
            fetchedAt: response.page.fetched_at,
          },
          transcriptCount: Math.max(
            run.transcriptCount ?? 0,
            response.page.total_count ?? 0,
            transcript.length,
          ),
          detailRefreshStatus:
            response.detail_refresh?.status ?? run.detailRefreshStatus,
          detailLoadedAt: nowTime(),
        };
      });
      return {
        vibeRuns,
        devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
      };
    });
  },

  interruptAgentSession: async sessionId => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before interrupting a VibeCoding turn.');
    }
    const interruptedAt = activityNowMs();
    set(state => {
      const vibeRuns = state.vibeRuns.map(run =>
        run.id === sessionId
          ? {
              ...run,
              status: 'idle' as VibeStatus,
              currentStep: 'Interrupted. Ready for your next message.',
              lastActivityMs: interruptedAt,
              updatedAt: formatActivityLabel(interruptedAt),
            }
          : run,
      );
      return {
        vibeRuns,
        devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
      };
    });
    const serverSession = await platformTransport.interruptAiSession(sessionId);
    set(state => {
      const nextRun = serverAiSessionToVibeRun(serverSession, state.devices, state.projects);
      const vibeRuns = state.vibeRuns.map(run =>
        run.id === nextRun.id ? mergeVibeRunSnapshot(run, nextRun) : run,
      );
      return {
        vibeRuns,
        devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
        events: [
          event('agent.session.paused', 'VibeCoding interrupted', nextRun.title, 'done', {
            deviceId: nextRun.deviceId,
            projectId: nextRun.projectId,
            sessionId: nextRun.id,
          }),
          ...state.events,
        ].slice(0, 120),
      };
    });
  },

  pauseAgentSession: async sessionId => {
    void sessionId;
    throw new Error(
      'Pausing is not supported by the desktop Agent. Interrupt the current turn instead.',
    );
  },

  resumeAgentSession: async sessionId => {
    void sessionId;
    throw new Error(
      'A stopped VibeCoding run cannot be resumed. Send a new message to continue the conversation.',
    );
  },

  terminateAgentSession: async sessionId => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before terminating a VibeCoding session.');
    }
    const serverSession = await platformTransport.terminateAiSession(sessionId);
    set(state => {
      const nextRun = serverAiSessionToVibeRun(serverSession, state.devices, state.projects);
      const vibeRuns = state.vibeRuns.map(run =>
        run.id === nextRun.id ? mergeVibeRunSnapshot(run, nextRun) : run,
      );
      return {
        vibeRuns,
        devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
        events: [
          event('agent.session.terminated', 'VibeCoding terminated', nextRun.title, 'done', {
            deviceId: nextRun.deviceId,
            projectId: nextRun.projectId,
            sessionId: nextRun.id,
          }),
          ...state.events,
        ].slice(0, 120),
      };
    });
  },

  updateAgentSession: async (sessionId, input) => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before updating a VibeCoding session.');
    }
    const serverSession = await platformTransport.updateAiSession(sessionId, {
      title: input.title,
      objective: input.objective,
      status: input.status,
      current_step: input.currentStep,
      // Forwarded verbatim. "" clears (revert to CLI default), undefined = omit
      // (unchanged). The new model applies on the next user message — the server
      // re-emits ai.session.create before each ai.message (see server index.ts).
      model: input.model,
      risk: input.risk,
      // Separate field. "" clears, undefined = unchanged. Gateway derives the
      // codex reasoning level from it; never bake it into the model name.
      effort: input.effort,
    });
    set(state => {
      const nextRun = serverAiSessionToVibeRun(serverSession, state.devices, state.projects);
      return {
        vibeRuns: state.vibeRuns.map(run =>
          run.id === nextRun.id ? mergeVibeRunSnapshot(run, nextRun) : run,
        ),
      };
    });
  },

  deleteAgentSession: async sessionId => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before deleting a VibeCoding session.');
    }
    await platformTransport.deleteAiSession(sessionId);
    set(state => ({
      vibeRuns: state.vibeRuns.filter(item => item.id !== sessionId),
      devices: state.devices.map(device => ({
        ...device,
        activeSessionIds: device.activeSessionIds.filter(id => id !== sessionId),
      })),
    }));
  },

  appendAgentMessage: async (sessionId, content, mode) => {
    const normalizedContent = content.trim();
    if (!normalizedContent) return;
    const sendKey = messageSendKey(sessionId, normalizedContent, mode);
    if (pendingMessageSends.has(sendKey)) return;
    pendingMessageSends.add(sendKey);

    if (!get().serverMode) {
      pendingMessageSends.delete(sendKey);
      throw new Error('Platform connection is required before sending a VibeCoding message.');
    }
    const currentRun = get().vibeRuns.find(run => run.id === sessionId);
    const provider = normalizeProvider(
      currentRun?.effectiveModelConfig?.provider ?? currentRun?.provider,
    );
    // 「回合是否在跑」走统一源头 isSessionTurnActive(= status==='running'),与顶部相位 /
    // composer 锁 / 停止按钮同源。status 现在是事件驱动(发送→running、ai.error→failed、
    // idle 由服务端 10s soft-settle 广播落定——**ai.done 本身不再翻 idle**,对齐服务端:生产
    // agent 一次 run 常发多个 ai.done)。回合真正静止后 guard 才放行(单回合结束最多滞后 ~10s,
    // 与顶部相位/composer 锁同步),不再因陈旧 running 误拦「Claude Code is still running」。
    // waiting_approval 是服务端主动推送的可靠态,仍拦。
    const status = currentRun?.status;
    const executionActive = currentRun
      ? isAuthoritativeRunLive(
          currentRun.runStateVersion,
          currentRun.runState,
          currentRun.status,
        )
      : isSessionTurnActive(status ?? 'idle');
    const waitingApproval = currentRun?.runStateVersion !== undefined
      ? currentRun.runState === 'waiting_approval'
      : status === 'waiting_approval';
    const turnActive = executionActive || waitingApproval;
    const sendAsSteer = Boolean(executionActive && provider === 'codex');
    if (turnActive && (provider === 'claude_code' || provider === 'opencode')) {
      pendingMessageSends.delete(sendKey);
      throw new Error(`${providerLabel(provider)} is still running. Stop it before sending another message.`);
    }
    // OPTIMISTIC UPDATE — render the user's message and flip the session to
    // "running / waiting for AI" BEFORE the HTTP round trip. The optimistic
    // message is tagged with `pending: true` so the merge logic (internals.ts)
    // can reconcile it with the server's copy even when IDs differ.
    const optimisticId = createId('msg');
    const optimisticMessage = {
      id: optimisticId,
      role: 'user' as const,
      mode,
      content: normalizedContent,
      timestamp: new Date().toISOString(),
      pending: true,
    };
    set(state => {
      let activeDeviceId = '';
      const vibeRuns = state.vibeRuns.map(run => {
        if (run.id !== sessionId) return run;
        activeDeviceId = run.deviceId;
        const transcript = [...run.transcript, optimisticMessage];
        return {
          ...run,
          status: 'running' as VibeStatus,
          // A normal message starts a new server-owned run. Temporarily drop
          // the previous revision so its completed/failed phase cannot mask
          // the optimistic running state during the HTTP round trip. A steer
          // remains on the current run and keeps its authority intact.
          ...(!sendAsSteer
            ? {
                activeRunId: undefined,
                latestRunId: undefined,
                runState: undefined,
                runStateVersion: undefined,
                phase: 'running' as const,
                optimisticRunPending: true,
                optimisticRunBaseVersion: run.runStateVersion ?? -1,
              }
            : {}),
          currentStep: sendAsSteer ? 'Steering current Codex turn.' : 'Waiting for AI response.',
          lastActivityMs: activityNowMs(),
          updatedAt: formatActivityLabel(activityNowMs()),
          transcript,
          transcriptCount: Math.max(run.transcriptCount ?? 0, transcript.length),
          lastMessage: optimisticMessage,
        };
      });
      return {
        vibeRuns,
        devices: activeDeviceId
          ? state.devices.map(device =>
              device.id === activeDeviceId
                ? { ...device, activeSessionIds: mergeIds([sessionId], device.activeSessionIds) }
                : device,
            )
          : state.devices,
      };
    });
    try {
      const response = sendAsSteer
        ? await platformTransport.sendAiSteer(sessionId, normalizedContent, mode)
        : await platformTransport.sendAiMessage(sessionId, normalizedContent, mode);
      // The server persists the user message under its own id (e.g. `msg_abc123`).
      // Reconcile: the optimistic bubble's id is replaced with the server's id
      // so subsequent server state sync (WebSocket `ai.session.updated`) merges
      // into it rather than rendering a duplicate.
      // FIX: search by content as a fallback — if a WebSocket `ai.session.updated`
      // already arrived and merged the server's copy (different id), the optimistic
      // message may have been replaced. In that case the server copy is already
      // present and `pending` is cleared by the merge, so this handler is a no-op.
      const serverMessageId = response.message_id;
      set(state => ({
        vibeRuns: state.vibeRuns.map(run => {
          if (run.id !== sessionId) return run;

          const responseIsNotOlder =
            response.run_state_version !== undefined &&
            (run.runStateVersion === undefined ||
              response.run_state_version >= run.runStateVersion);
          const withAcceptedRun = responseIsNotOlder
            ? {
                ...run,
                status: 'running' as VibeStatus,
                phase: 'running' as const,
                activeRunId: response.run_id,
                latestRunId: response.run_id,
                runState: response.run_state ?? ('queued' as const),
                runStateVersion: response.run_state_version,
                optimisticRunPending: false,
                optimisticRunBaseVersion: undefined,
              }
            : {
                ...run,
                optimisticRunPending: false,
                optimisticRunBaseVersion: undefined,
              };

          // 1) Ideal path: optimistic message still present, rename to server id.
          const optimisticIndex = withAcceptedRun.transcript.findIndex(
            item => item.id === optimisticId,
          );
          if (optimisticIndex >= 0) {
            const optimistic = withAcceptedRun.transcript[optimisticIndex];
            if (optimistic.role !== 'user') return withAcceptedRun;

            const serverIndex = serverMessageId
              ? withAcceptedRun.transcript.findIndex(item => item.id === serverMessageId)
              : -1;

            if (serverMessageId && serverIndex >= 0) {
              // Server copy already present (WebSocket arrived first). Drop
              // optimistic, confirm the server copy.
              const transcript = withAcceptedRun.transcript
                .filter(item => item.id !== optimisticId)
                .map(item =>
                  item.id === serverMessageId ? { ...item, pending: false } : item,
                );
              return {
                ...withAcceptedRun,
                transcript,
                transcriptCount: Math.max(run.transcriptCount ?? 0, transcript.length),
                lastMessage:
                  withAcceptedRun.lastMessage?.id === optimisticId
                    ? transcript[transcript.length - 1]
                    : withAcceptedRun.lastMessage,
              };
            }

            // No server copy yet — just rename the optimistic message.
            const confirmedMessage = {
              ...optimistic,
              id: serverMessageId || optimisticId,
              pending: false,
            };
            const transcript = withAcceptedRun.transcript.slice();
            transcript[optimisticIndex] = confirmedMessage;
            return {
              ...withAcceptedRun,
              transcript,
              lastMessage:
                withAcceptedRun.lastMessage?.id === optimisticId
                  ? confirmedMessage
                  : withAcceptedRun.lastMessage,
            };
          }

          // 2) Fallback: optimistic message already gone (WebSocket merged it
          //    away). Find the server copy by id and confirm it.
          if (serverMessageId) {
            const serverIndex = withAcceptedRun.transcript.findIndex(
              item => item.id === serverMessageId,
            );
            if (serverIndex >= 0) {
              const serverMsg = withAcceptedRun.transcript[serverIndex];
              if (serverMsg.role === 'user') {
                const transcript = withAcceptedRun.transcript.slice();
                transcript[serverIndex] = { ...serverMsg, pending: false };
                return { ...withAcceptedRun, transcript };
              }
            }
          }

          // 3) Last resort: content-based match (handles edge-case where
          //    server assigned a different id and WebSocket already merged).
          const byContent = withAcceptedRun.transcript.findIndex(
            item =>
              item.role === 'user' &&
              item.mode === mode &&
              item.content === normalizedContent &&
              (item as { pending?: boolean }).pending !== false,
          );
          if (byContent >= 0 && serverMessageId) {
            const existing = withAcceptedRun.transcript[byContent];
            // Already has the server id — just confirm.
            if (existing.id === serverMessageId) {
              const transcript = withAcceptedRun.transcript.slice();
              transcript[byContent] = { ...existing, pending: false };
              return { ...withAcceptedRun, transcript };
            }
            // Different id — rename to server id.
            const transcript = withAcceptedRun.transcript.slice();
            transcript[byContent] = { ...existing, id: serverMessageId, pending: false };
            return { ...withAcceptedRun, transcript };
          }

          // 4) Nothing found — the server copy is already confirmed (or the
          //    message was never created). Return unchanged.
          return withAcceptedRun;
        }),
      }));
    } catch (error) {
      // KEEP the failed message as a client-only retryable bubble
      // (`failed: true`) instead of dropping it. The composer input is NOT
      // restored (handled by the screen), so the user's NEXT message can't
      // accidentally append to this one and ship as a combined prompt. The
      // bubble's retry / dismiss affordance recovers or discards it.
      set(state => ({
        vibeRuns: state.vibeRuns.map(run => {
          if (run.id !== sessionId) return run;
          const transcript = run.transcript.map(item =>
            item.id === optimisticId
              ? { ...item, pending: false, failed: true }
              : item,
          );
          const serverAcceptedWhileRequestFailed =
            !sendAsSteer &&
            run.runStateVersion !== undefined &&
            run.runStateVersion > (currentRun?.runStateVersion ?? -1);
          if (serverAcceptedWhileRequestFailed) {
            // The HTTP response may have been lost after Server committed and
            // the WS snapshot arrived. Never restore the previous terminal run
            // or mark the already-accepted prompt as a failed send.
            return run;
          }
          return {
            ...run,
            status: currentRun?.status ?? ('idle' as VibeStatus),
            phase: currentRun?.phase,
            activeRunId: currentRun?.activeRunId,
            latestRunId: currentRun?.latestRunId,
            runState: currentRun?.runState,
            runStateVersion: currentRun?.runStateVersion,
            optimisticRunPending: false,
            optimisticRunBaseVersion: undefined,
            currentStep: 'Failed to send. Tap the message to retry.',
            transcript,
          };
        }),
      }));
      throw error;
    } finally {
      pendingMessageSends.delete(sendKey);
    }
  },

  retryAgentMessage: async (sessionId, messageId) => {
    const run = get().vibeRuns.find(item => item.id === sessionId);
    if (!run) return;
    const failed = run.transcript.find(message => message.id === messageId && message.failed);
    if (!failed) return;
    const content = failed.content;
    // AgentMessage.mode is wider than the send API's ('voice' | 'text'); a
    // failed user bubble was originally dispatched as voice or text, so narrow.
    const mode: 'voice' | 'text' = failed.mode === 'voice' ? 'voice' : 'text';
    // Drop the stale failed bubble, then dispatch a FRESH send (new optimistic
    // bubble + HTTP). The retry never touches the composer input, so it cannot
    // combine with other text; appendAgentMessage re-marks the new bubble
    // `failed` on a repeat failure, keeping retry idempotent.
    set(state => ({
      vibeRuns: state.vibeRuns.map(item => {
        if (item.id !== sessionId) return item;
        const transcript = item.transcript.filter(message => message.id !== messageId);
        return {
          ...item,
          transcript,
          transcriptCount: Math.max((item.transcriptCount ?? 1) - 1, 0),
        };
      }),
    }));
    try {
      await get().appendAgentMessage(sessionId, content, mode);
    } catch {
      // Failure is already reflected as a `failed` bubble by appendAgentMessage.
    }
  },

  dismissFailedMessage: (sessionId, messageId) => {
    set(state => ({
      vibeRuns: state.vibeRuns.map(item => {
        if (item.id !== sessionId) return item;
        const transcript = item.transcript.filter(message => message.id !== messageId);
        return {
          ...item,
          transcript,
          transcriptCount: Math.max((item.transcriptCount ?? 1) - 1, 0),
        };
      }),
    }));
  },

  cacheStructuredDetail: (sessionId, eventId, detail) => {
    set(state => ({
      vibeRuns: state.vibeRuns.map(run =>
        run.id === sessionId
          ? {
              ...run,
              // FIFO-cap the heavy-detail cache so it can't grow without bound
              // as the user expands activity items. Newest entries survive.
              eventDetailCache: capEventDetailCache({
                ...(run.eventDetailCache ?? {}),
                [eventId]: detail,
              }),
            }
          : run,
      ),
    }));
  },

  // Mark a session as viewed now (chat screen focus). Stamps lastViewedAt and
  // records it as the currently-viewed session so the idle demoter never clears
  // the conversation the user is actively looking at.
  markSessionViewed: sessionId => {
    const viewedAt = Date.now();
    set(state => ({
      currentlyViewedSessionId: sessionId,
      vibeRuns: state.vibeRuns.map(run =>
        run.id === sessionId ? { ...run, lastViewedAt: viewedAt } : run,
      ),
    }));
  },

  // Clear the currently-viewed marker (chat screen blur / unmount). lastViewedAt
  // is retained so the idle threshold clock keeps running for that session.
  clearCurrentlyViewedSession: sessionId => {
    set(state => {
      if (sessionId && state.currentlyViewedSessionId !== sessionId) {
        return {};
      }
      return { currentlyViewedSessionId: undefined };
    });
  },

  // Demote sessions the user hasn't viewed within the idle threshold (and that
  // aren't active or currently viewed) — clears their resident detail to bound
  // memory. Triggered by AppState backgrounding and a coarse interval sweeper.
  demoteIdleSessions: () => {
    set(state => ({
      vibeRuns: demoteIdleSessions(
        state.vibeRuns,
        Date.now(),
        state.currentlyViewedSessionId,
      ),
    }));
  },
});

import type { StateCreator } from 'zustand';
import type { VibeCodingRun, VibeStatus } from '../../data/platformModels';
import { platformTransport } from '../../services/platformTransport';
import type { ControlCenterState } from '../types';
import {
  activityNowMs,
  attachDeviceRelations,
  createId,
  event,
  evictStaleSessionDetail,
  fileNameFromPath,
  formatActivityLabel,
  mergeIds,
  mergeVibeRunSnapshot,
  nowTime,
  serverAiSessionToVibeRun,
  shortTime,
} from '../internals';

type AiSessionSlice = Pick<
  ControlCenterState,
  | 'vibeRuns' | 'previewLinks'
  | 'startAgentSession' | 'loadAgentSessionDetail' | 'pauseAgentSession'
  | 'resumeAgentSession' | 'terminateAgentSession' | 'updateAgentSession'
  | 'deleteAgentSession' | 'appendAgentMessage'
>;

const pendingMessageSends = new Set<string>();

const messageSendKey = (sessionId: string, content: string, mode: 'voice' | 'text') =>
  `${sessionId}:${mode}:${content}`;

export const createAiSessionSlice: StateCreator<ControlCenterState, [], [], AiSessionSlice> = (set, get) => ({
  vibeRuns: [],
  previewLinks: [],

  startAgentSession: async (input) => {
    const provider = input.provider === 'claude_code' ? 'claudecode' : 'codex';
    // Concrete model name forwarded to the agent CLI as `--model` (e.g.
    // "glm-5.2-xhigh"). Empty/omitted => the CLI's own default model is used.
    // Do NOT send a display label — the gateway forwards `model` verbatim, so a
    // label like "Claude Code" would pollute the CLI's model selection.
    const sentModel = input.model?.trim() || undefined;
    // Presentation label for VibeCodingRun.model / UI copy only (falls back to
    // the provider name when no concrete model is set). NOT sent to the agent.
    const modelLabel =
      sentModel ?? (input.provider === 'claude_code' ? 'Claude Code' : 'GPT-5 Codex');

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
        const session = await platformTransport.createAiSession({
          device_id: input.deviceId,
          project_id: projectId || undefined,
          project_path: input.directory,
          mode: 'vibe',
          title: input.objective.slice(0, 44) || 'New VibeCoding session',
          objective: input.objective,
          model: sentModel,
          provider,
          tool: provider,
          risk: input.provider === 'claude_code' ? 'medium' : 'low',
        });

        const sessionId = session.session_id;
        const project = get().projects.find(item => item.id === projectId);

        const nextRun: VibeCodingRun = {
          id: sessionId,
          title: session.title ?? input.objective.slice(0, 44),
          deviceId: input.deviceId,
          projectId,
          directory: input.directory,
          status: 'running',
          objective: input.objective,
          model: modelLabel,
          risk: input.provider === 'claude_code' ? 'medium' : 'low',
          currentStep: `${modelLabel} is reading the project and preparing a plan.`,
          branch: `agent/${sessionId}`,
          lastActivityMs: activityNowMs(),
          updatedAt: formatActivityLabel(activityNowMs()),
          suggestions: ['Ask for plan', 'Open terminal', 'Pause session'],
          transcript: [
            {
              id: createId('msg'),
              role: 'user',
              mode: 'text',
              content: input.objective,
              timestamp: shortTime(),
            },
          ],
          events: [
            {
              id: createId('agent-event'),
              type: 'status',
              title: 'Agent session started',
              detail: `${modelLabel} started on ${project?.name ?? input.projectId}`,
              status: 'running',
              timestamp: shortTime(),
            },
          ],
        };

        set(state => ({
          vibeRuns: [nextRun, ...state.vibeRuns],
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

  pauseAgentSession: async sessionId => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before pausing a VibeCoding session.');
    }
    const serverSession = await platformTransport.pauseAiSession(sessionId);
    set(state => {
      const nextRun = serverAiSessionToVibeRun(serverSession, state.devices, state.projects);
      const vibeRuns = state.vibeRuns.map(run =>
        run.id === nextRun.id ? mergeVibeRunSnapshot(run, nextRun) : run,
      );
      return {
        vibeRuns,
        devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
        events: [
          event('agent.session.paused', 'VibeCoding paused', nextRun.title, 'done', {
            deviceId: nextRun.deviceId,
            projectId: nextRun.projectId,
            sessionId: nextRun.id,
          }),
          ...state.events,
        ].slice(0, 120),
      };
    });
  },

  resumeAgentSession: async sessionId => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before resuming a VibeCoding session.');
    }
    const serverSession = await platformTransport.resumeAiSession(sessionId);
    set(state => {
      const nextRun = serverAiSessionToVibeRun(serverSession, state.devices, state.projects);
      const vibeRuns = state.vibeRuns.map(run =>
        run.id === nextRun.id ? mergeVibeRunSnapshot(run, nextRun) : run,
      );
      return {
        vibeRuns,
        devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
        events: [
          event('agent.session.resumed', 'VibeCoding resumed', nextRun.title, 'running', {
            deviceId: nextRun.deviceId,
            projectId: nextRun.projectId,
            sessionId: nextRun.id,
          }),
          ...state.events,
        ].slice(0, 120),
      };
    });
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
          currentStep: 'Waiting for AI response.',
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
      const response = await platformTransport.sendAiMessage(sessionId, normalizedContent, mode);
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

          // 1) Ideal path: optimistic message still present, rename to server id.
          const optimisticIndex = run.transcript.findIndex(
            item => item.id === optimisticId,
          );
          if (optimisticIndex >= 0) {
            const optimistic = run.transcript[optimisticIndex];
            if (optimistic.role !== 'user') return run;

            const serverIndex = serverMessageId
              ? run.transcript.findIndex(item => item.id === serverMessageId)
              : -1;

            if (serverMessageId && serverIndex >= 0) {
              // Server copy already present (WebSocket arrived first). Drop
              // optimistic, confirm the server copy.
              const transcript = run.transcript
                .filter(item => item.id !== optimisticId)
                .map(item =>
                  item.id === serverMessageId ? { ...item, pending: false } : item,
                );
              return {
                ...run,
                transcript,
                transcriptCount: Math.max(run.transcriptCount ?? 0, transcript.length),
                lastMessage:
                  run.lastMessage?.id === optimisticId
                    ? transcript[transcript.length - 1]
                    : run.lastMessage,
              };
            }

            // No server copy yet — just rename the optimistic message.
            const confirmedMessage = {
              ...optimistic,
              id: serverMessageId || optimisticId,
              pending: false,
            };
            const transcript = run.transcript.slice();
            transcript[optimisticIndex] = confirmedMessage;
            return {
              ...run,
              transcript,
              lastMessage:
                run.lastMessage?.id === optimisticId
                  ? confirmedMessage
                  : run.lastMessage,
            };
          }

          // 2) Fallback: optimistic message already gone (WebSocket merged it
          //    away). Find the server copy by id and confirm it.
          if (serverMessageId) {
            const serverIndex = run.transcript.findIndex(
              item => item.id === serverMessageId,
            );
            if (serverIndex >= 0) {
              const serverMsg = run.transcript[serverIndex];
              if (serverMsg.role === 'user') {
                const transcript = run.transcript.slice();
                transcript[serverIndex] = { ...serverMsg, pending: false };
                return { ...run, transcript };
              }
            }
          }

          // 3) Last resort: content-based match (handles edge-case where
          //    server assigned a different id and WebSocket already merged).
          const byContent = run.transcript.findIndex(
            item =>
              item.role === 'user' &&
              item.mode === mode &&
              item.content === normalizedContent &&
              (item as { pending?: boolean }).pending !== false,
          );
          if (byContent >= 0 && serverMessageId) {
            const existing = run.transcript[byContent];
            // Already has the server id — just confirm.
            if (existing.id === serverMessageId) {
              const transcript = run.transcript.slice();
              transcript[byContent] = { ...existing, pending: false };
              return { ...run, transcript };
            }
            // Different id — rename to server id.
            const transcript = run.transcript.slice();
            transcript[byContent] = { ...existing, id: serverMessageId, pending: false };
            return { ...run, transcript };
          }

          // 4) Nothing found — the server copy is already confirmed (or the
          //    message was never created). Return unchanged.
          return run;
        }),
      }));
    } catch (error) {
      // Rollback the optimistic bubble on failure so a failed send doesn't
      // leave a dangling "sent" message in the transcript.
      set(state => ({
        vibeRuns: state.vibeRuns.map(run => {
          if (run.id !== sessionId) return run;
          const transcript = run.transcript.filter(item => item.id !== optimisticId);
          return {
            ...run,
            status: 'idle' as VibeStatus,
            currentStep: 'Failed to send message.',
            transcript,
            transcriptCount: Math.max((run.transcriptCount ?? 0) - 1, 0),
          };
        }),
      }));
      throw error;
    } finally {
      pendingMessageSends.delete(sendKey);
    }
  },
});

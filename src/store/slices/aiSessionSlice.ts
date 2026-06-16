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
  mergeAgentMessages,
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
    const model = input.provider === 'claude_code' ? 'Claude Code' : 'GPT-5 Codex';
    const provider = input.provider === 'claude_code' ? 'claudecode' : 'codex';

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
          model,
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
          model,
          timeLimitMinutes: input.timeLimitMinutes,
          elapsedMinutes: 1,
          risk: input.provider === 'claude_code' ? 'medium' : 'low',
          currentStep: `${model} is reading the project and preparing a plan.`,
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
              detail: `${model} started on ${project?.name ?? input.projectId}`,
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
            event('agent.session.started', 'Agent session started', `${model} started in ${input.directory}.`, 'running', {
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

  loadAgentSessionDetail: async sessionId => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before loading a VibeCoding session.');
    }
    const serverSession = await platformTransport.loadAiSession(sessionId);
    set(state => {
      const nextRun = {
        ...serverAiSessionToVibeRun(serverSession, state.devices, state.projects),
        detailLoadedAt: nowTime(),
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
    // "running / waiting for AI" BEFORE the HTTP round trip. Previously the
    // bubble and the thinking status only appeared after `sendAiMessage`
    // resolved, so the send button felt sluggish and gave no "you're now in
    // the conversation" feedback.
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
      // The server persists the user message under its own id. Rename the
      // optimistic bubble to that id so the next server state sync (which
      // carries the server's user message) merges into it instead of
      // rendering a duplicate.
      const serverMessageId = response.message_id;
      set(state => ({
        vibeRuns: state.vibeRuns.map(run => {
          if (run.id !== sessionId) return run;
          const optimisticIndex = run.transcript.findIndex(
            item => item.id === optimisticId,
          );
          if (optimisticIndex === -1) return run;

          const serverIndex = serverMessageId
            ? run.transcript.findIndex(item => item.id === serverMessageId)
            : -1;
          const optimistic = run.transcript[optimisticIndex];
          if (optimistic.role !== 'user') return run;

          if (serverMessageId && serverIndex >= 0) {
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

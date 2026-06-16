import { create } from 'zustand';
import type { PreviewLink, VibeStatus } from '../data/platformModels';
import { routeTerminalOutputToEmulator } from '../components/terminal/TerminalEmulator';
import { applyDeltasToRuns } from '../utils/deltaBatch';
import { terminalDisplayUpdate } from '../utils/terminalOutput';
import {
  flushDeltas,
  pushDelta,
  registerDeltaApplier,
  scheduleRefreshDebounce,
} from './streaming';
import type {
  ControlCenterState,
  TerminalSessionStatus,
  UnifiedEvent,
} from './types';
import {
  activityNowMs,
  attachDeviceRelations,
  createId,
  event,
  formatActivityLabel,
  hasMeaningfulVibeRunUpdate,
  line,
  MAX_RUN_EVENTS,
  MAX_TERMINAL_LINES,
  mergeIds,
  mergeVibeRunSnapshot,
  nowTime,
  platformDeviceToClient,
  serverAiSessionToVibeRun,
  serverApprovalToClient,
  serverNotificationToClient,
  serverProjectToClient,
  shortTime,
  tail,
  upsertNotification,
} from './internals';
import { createRealtimeSlice } from './slices/realtimeSlice';
import { createTerminalSlice } from './slices/terminalSlice';
import { createApprovalSlice } from './slices/approvalSlice';
import { createAiSessionSlice } from './slices/aiSessionSlice';
import { createDeviceProjectSlice } from './slices/deviceProjectSlice';

// Re-export the domain types so the 21 consumer files keep importing them from
// this module — their import paths (`../store/controlCenterStore`) stay valid.
export * from './types';

// ============================================================
// Composition root
// ------------------------------------------------------------
// The five domain slices (./slices/*) are composed into one store. The
// cross-domain transport dispatcher stays here at the root because it routes
// events to every domain via get()/set(). The mutable streaming-batching state
// it shares with the realtime slice lives in ./streaming (single owner), and the
// store wires the delta applier into it at creation.
// ============================================================
export const useControlCenterStore = create<ControlCenterState>()(
  (set, get, store) => {
    // Let ./streaming flush buffered ai.delta tokens back into the store
    // without it having to depend on zustand.
    registerDeltaApplier(deltas =>
      set(state => ({
        vibeRuns: applyDeltasToRuns(
          state.vibeRuns,
          deltas,
          () => createId('msg'),
          shortTime,
        ),
      })),
    );

    return {
      ...createRealtimeSlice(set, get, store),
      ...createTerminalSlice(set, get, store),
      ...createApprovalSlice(set, get, store),
      ...createAiSessionSlice(set, get, store),
      ...createDeviceProjectSlice(set, get, store),

      // Only the global activity log lives here; all domain data is owned by slices.
      events: [],
      handleTransportEvent: transportEvent => {
        // Apply any buffered streaming tokens before handling a different event,
        // so ordering is preserved (e.g. an `ai.done` reflects every preceding
        // token). `ai.delta` is the only buffered type — see its case below.
        // flushDeltas / pushDelta + the batching buffers live in ./streaming; the
        // applier that writes flushed deltas into vibeRuns was registered above.

        // Per-event isolation (L0 dispatcher boundary): a reducer throwing for
        // one event must not propagate to the WS onmessage callback and break the
        // realtime pipeline. Each transport event is independent, so we catch,
        // log, and keep the connection alive for subsequent events.
        try {
          if (transportEvent.type !== 'ai.delta') {
            flushDeltas();
          }

          switch (transportEvent.type) {
            case 'transport.status':
              set({
                wsConnected: transportEvent.status === 'connected',
                ...(transportEvent.status !== 'connected'
                  ? { stale: true }
                  : {}),
              });
              return;

            case 'mobile.connected':
              set({ wsConnected: true });
              return;

            case 'device.updated': {
              const clientDevice = platformDeviceToClient(
                transportEvent.device,
              );
              set(state => {
                const previous = state.devices.find(
                  d => d.id === clientDevice.id,
                );
                const nextDevice = {
                  ...clientDevice,
                  projectIds: mergeIds(
                    clientDevice.projectIds,
                    previous?.projectIds ?? [],
                  ),
                  activeSessionIds:
                    previous?.activeSessionIds ?? clientDevice.activeSessionIds,
                };
                const nextDevicesBase = previous
                  ? state.devices.map(d =>
                      d.id === nextDevice.id ? nextDevice : d,
                    )
                  : [nextDevice, ...state.devices];
                const nextDevices = attachDeviceRelations(
                  nextDevicesBase,
                  state.projects,
                  state.vibeRuns,
                );
                const nextEvents: UnifiedEvent[] = [];

                if (!previous) {
                  nextEvents.push(
                    event(
                      'device.bound',
                      'Device registered',
                      `${nextDevice.name} joined the platform.`,
                      'done',
                      {
                        deviceId: nextDevice.id,
                      },
                    ),
                  );
                } else if (
                  previous.status !== 'offline' &&
                  nextDevice.status === 'offline'
                ) {
                  nextEvents.push(
                    event(
                      'device.offline',
                      'Device disconnected',
                      `${nextDevice.name} is no longer reachable.`,
                      'failed',
                      {
                        deviceId: nextDevice.id,
                      },
                    ),
                  );
                }

                return {
                  devices: nextDevices,
                  events: [...nextEvents, ...state.events].slice(0, 120),
                };
              });
              return;
            }

            case 'device.removed':
              set(state => ({
                devices: state.devices.filter(
                  d => d.id !== transportEvent.deviceId,
                ),
                events: [
                  event(
                    'device.offline',
                    'Device removed',
                    transportEvent.deviceId,
                    'failed',
                    {
                      deviceId: transportEvent.deviceId,
                    },
                  ),
                  ...state.events,
                ].slice(0, 120),
              }));
              return;

            case 'ai.delta': {
              // Buffer the token; pushDelta schedules a single coalesced flush per
              // flush window so subscribed screens re-render once per flush instead
              // of once per token. Buffered deltas are merged in one set() on flush.
              pushDelta({
                sessionId: transportEvent.sessionId,
                delta: transportEvent.delta,
                currentStep: transportEvent.currentStep || undefined,
                messageId: transportEvent.messageId,
              });
              return;
            }

            case 'ai.done':
              set(state => {
                const run = state.vibeRuns.find(
                  item => item.id === transportEvent.sessionId,
                );
                const detail =
                  transportEvent.detail || 'VibeCoding session completed.';
                const doneMs = activityNowMs();

                return {
                  vibeRuns: state.vibeRuns.map(item =>
                    item.id === transportEvent.sessionId
                      ? {
                          ...item,
                          status: 'idle' as VibeStatus,
                          currentStep: detail,
                          lastActivityMs: doneMs,
                          updatedAt: formatActivityLabel(doneMs),
                          events: tail(
                            [
                              ...item.events,
                              {
                                id: createId('evt'),
                                type: 'status' as const,
                                title: 'Session completed',
                                detail,
                                status: 'done' as const,
                                timestamp: shortTime(),
                              },
                            ],
                            MAX_RUN_EVENTS,
                          ),
                        }
                      : item,
                  ),
                  devices: state.devices.map(device => ({
                    ...device,
                    activeSessionIds: device.activeSessionIds.filter(
                      id => id !== transportEvent.sessionId,
                    ),
                  })),
                  events: [
                    event(
                      'agent.session.completed',
                      'VibeCoding completed',
                      run?.title ?? detail,
                      'done',
                      {
                        deviceId: run?.deviceId,
                        projectId: run?.projectId,
                        sessionId: transportEvent.sessionId,
                      },
                    ),
                    ...state.events,
                  ].slice(0, 120),
                };
              });
              return;

            case 'ai.error':
              set(state => {
                const run = state.vibeRuns.find(
                  item => item.id === transportEvent.sessionId,
                );
                return {
                  vibeRuns: state.vibeRuns.map(item =>
                    item.id === transportEvent.sessionId
                      ? {
                          ...item,
                          status: 'failed' as VibeStatus,
                          currentStep: transportEvent.error,
                          lastActivityMs: activityNowMs(),
                          updatedAt: formatActivityLabel(activityNowMs()),
                        }
                      : item,
                  ),
                  devices: state.devices.map(device => ({
                    ...device,
                    activeSessionIds: device.activeSessionIds.filter(
                      id => id !== transportEvent.sessionId,
                    ),
                  })),
                  events: [
                    event(
                      'agent.session.failed',
                      'VibeCoding failed',
                      transportEvent.error,
                      'failed',
                      {
                        deviceId: run?.deviceId,
                        projectId: run?.projectId,
                        sessionId: transportEvent.sessionId,
                      },
                    ),
                    ...state.events,
                  ].slice(0, 120),
                };
              });
              return;

            case 'ai.session.created': {
              const createdMs = activityNowMs();
              set(state => ({
                vibeRuns: state.vibeRuns.map(run =>
                  run.id === transportEvent.sessionId
                    ? {
                        ...run,
                        status: 'idle' as VibeStatus,
                        lastActivityMs: createdMs,
                        updatedAt: formatActivityLabel(createdMs),
                      }
                    : run,
                ),
              }));
              return;
            }

            case 'ai.session.updated': {
              set(state => {
                const nextRun = serverAiSessionToVibeRun(
                  transportEvent.session,
                  state.devices,
                  state.projects,
                );
                const previousRun = state.vibeRuns.find(
                  run => run.id === nextRun.id,
                );
                const shouldRecordEvent = hasMeaningfulVibeRunUpdate(
                  previousRun,
                  nextRun,
                );
                const exists = Boolean(previousRun);
                const vibeRuns = exists
                  ? state.vibeRuns.map(run =>
                      run.id === nextRun.id
                        ? mergeVibeRunSnapshot(run, nextRun)
                        : run,
                    )
                  : [nextRun, ...state.vibeRuns];
                return {
                  vibeRuns,
                  devices: attachDeviceRelations(
                    state.devices,
                    state.projects,
                    vibeRuns,
                  ),
                  events: shouldRecordEvent
                    ? [
                        event(
                          exists
                            ? 'agent.session.updated'
                            : 'agent.session.started',
                          exists ? 'VibeCoding updated' : 'VibeCoding started',
                          nextRun.title,
                          'running',
                          {
                            deviceId: nextRun.deviceId,
                            projectId: nextRun.projectId,
                            sessionId: nextRun.id,
                          },
                        ),
                        ...state.events,
                      ].slice(0, 120)
                    : state.events,
                };
              });
              return;
            }

            case 'ai.session.deleted':
              set(state => ({
                vibeRuns: state.vibeRuns.filter(
                  run => run.id !== transportEvent.sessionId,
                ),
                devices: state.devices.map(device => ({
                  ...device,
                  activeSessionIds: device.activeSessionIds.filter(
                    id => id !== transportEvent.sessionId,
                  ),
                })),
                events: [
                  event(
                    'agent.session.terminated',
                    'VibeCoding deleted',
                    transportEvent.sessionId,
                    'done',
                    {
                      sessionId: transportEvent.sessionId,
                    },
                  ),
                  ...state.events,
                ].slice(0, 120),
              }));
              return;

            case 'ai.sessions.updated':
              if (get().serverMode) {
                scheduleRefreshDebounce(() =>
                  get()
                    .refreshFromServer()
                    .catch(() => {}),
                );
              }
              return;

            case 'terminal.output': {
              const routedToEmulator = routeTerminalOutputToEmulator(
                transportEvent.sessionId,
                transportEvent.data,
                transportEvent.encoding,
              );
              if (routedToEmulator) {
                return;
              }
              set(state => ({
                terminalSessions: state.terminalSessions.map(ts => {
                  if (ts.id !== transportEvent.sessionId) return ts;

                  let screenFrameStartIndex = 0;
                  for (
                    let index = ts.lines.length - 1;
                    index >= 0;
                    index -= 1
                  ) {
                    if (ts.lines[index].kind === 'command') {
                      screenFrameStartIndex = index + 1;
                      break;
                    }
                  }

                  const previousScreenLines = ts.lines
                    .slice(screenFrameStartIndex)
                    .filter(item => item.kind === 'stdout')
                    .map(item => item.content);
                  const outputUpdate = terminalDisplayUpdate(
                    transportEvent.data,
                    transportEvent.encoding,
                    previousScreenLines,
                  );
                  if (
                    !outputUpdate.lines.length &&
                    outputUpdate.mode !== 'replaceScreen'
                  ) {
                    return ts;
                  }

                  const nextOutputLines = outputUpdate.lines.map(item =>
                    line('stdout', item),
                  );
                  let preservedLines = ts.lines;

                  if (outputUpdate.mode === 'replaceScreen') {
                    preservedLines = [
                      ...ts.lines.slice(0, screenFrameStartIndex),
                      ...ts.lines
                        .slice(screenFrameStartIndex)
                        .filter(item => item.kind !== 'stdout'),
                    ];
                  } else if (outputUpdate.mode === 'rewriteLastLine') {
                    let lastStdoutIndex = -1;
                    for (
                      let index = ts.lines.length - 1;
                      index >= 0;
                      index -= 1
                    ) {
                      if (ts.lines[index].kind === 'stdout') {
                        lastStdoutIndex = index;
                        break;
                      }
                    }
                    preservedLines =
                      lastStdoutIndex >= 0
                        ? ts.lines.filter(
                            (_, index) => index !== lastStdoutIndex,
                          )
                        : ts.lines;
                  }

                  return {
                    ...ts,
                    lines: tail(
                      [...preservedLines, ...nextOutputLines],
                      MAX_TERMINAL_LINES,
                    ),
                    updatedAt: nowTime(),
                  };
                }),
              }));
              return;
            }

            case 'terminal.created':
              set(state => ({
                terminalSessions: state.terminalSessions.map(ts =>
                  ts.id === transportEvent.sessionId
                    ? { ...ts, status: 'running' as TerminalSessionStatus }
                    : ts,
                ),
              }));
              return;

            case 'terminal.exit':
              set(state => ({
                terminalSessions: state.terminalSessions.map(ts =>
                  ts.id === transportEvent.sessionId
                    ? {
                        ...ts,
                        status: transportEvent.failed
                          ? ('failed' as TerminalSessionStatus)
                          : ('completed' as TerminalSessionStatus),
                      }
                    : ts,
                ),
                events: [
                  event(
                    'command.completed',
                    transportEvent.failed
                      ? 'Terminal session failed'
                      : 'Terminal session completed',
                    transportEvent.sessionId,
                    transportEvent.failed ? 'failed' : 'done',
                    { terminalId: transportEvent.sessionId },
                  ),
                  ...state.events,
                ].slice(0, 120),
              }));
              return;

            case 'approval.requested': {
              const approval = serverApprovalToClient(transportEvent.approval);
              set(state => ({
                approvals: [
                  approval,
                  ...state.approvals.filter(item => item.id !== approval.id),
                ],
                events: [
                  event(
                    'approval.requested',
                    approval.title,
                    approval.summary,
                    'waiting',
                    {
                      deviceId: approval.deviceId,
                      projectId: approval.projectId,
                      sessionId: approval.sessionId,
                      terminalId: approval.terminalId,
                      approvalId: approval.id,
                    },
                  ),
                  ...state.events,
                ].slice(0, 120),
              }));
              return;
            }

            case 'notification.created': {
              const nextNotification = serverNotificationToClient(
                transportEvent.notification,
              );
              set(state => ({
                notifications: upsertNotification(
                  state.notifications,
                  nextNotification,
                ),
                events: [
                  event(
                    nextNotification.type === 'completed'
                      ? 'agent.session.completed'
                      : nextNotification.type === 'error'
                      ? 'agent.session.failed'
                      : nextNotification.type === 'approval'
                      ? 'approval.requested'
                      : 'platform.event',
                    nextNotification.title,
                    nextNotification.body,
                    nextNotification.type === 'error'
                      ? 'failed'
                      : nextNotification.type === 'approval'
                      ? 'waiting'
                      : 'done',
                    {
                      deviceId: nextNotification.deviceId,
                      sessionId: nextNotification.sessionId,
                      approvalId: nextNotification.approvalId,
                    },
                  ),
                  ...state.events,
                ].slice(0, 120),
              }));
              return;
            }

            case 'notification.updated': {
              const nextNotification = serverNotificationToClient(
                transportEvent.notification,
              );
              set(state => ({
                notifications: upsertNotification(
                  state.notifications,
                  nextNotification,
                ),
              }));
              return;
            }

            case 'notifications.updated':
              if (transportEvent.readAll) {
                set(state => ({
                  notifications: state.notifications.map(item => ({
                    ...item,
                    read: true,
                  })),
                }));
              }
              return;

            case 'preview.ready': {
              const preview: PreviewLink = {
                id: transportEvent.preview.id,
                sessionId: transportEvent.preview.sessionId,
                port: transportEvent.preview.port,
                shortUrl: transportEvent.preview.shortUrl,
                targetUrl: transportEvent.preview.targetUrl,
                expiresIn: transportEvent.expiresIn,
                access: transportEvent.preview.access as PreviewLink['access'],
              };
              set(state => ({
                previewLinks: [
                  preview,
                  ...state.previewLinks.filter(p => p.id !== preview.id),
                ],
                vibeRuns: state.vibeRuns.map(run =>
                  run.id === preview.sessionId
                    ? {
                        ...run,
                        status: 'preview_ready' as VibeStatus,
                        previewId: preview.id,
                        lastActivityMs: activityNowMs(),
                        updatedAt: formatActivityLabel(activityNowMs()),
                      }
                    : run,
                ),
                events: [
                  event(
                    'agent.delta',
                    'Preview ready',
                    preview.shortUrl,
                    'done',
                    {
                      sessionId: preview.sessionId,
                    },
                  ),
                  ...state.events,
                ].slice(0, 120),
              }));
              return;
            }

            case 'project.updated': {
              const nextProject = serverProjectToClient(transportEvent.project);
              set(state => {
                const exists = state.projects.some(
                  project => project.id === nextProject.id,
                );
                const projects = exists
                  ? state.projects.map(project =>
                      project.id === nextProject.id ? nextProject : project,
                    )
                  : [nextProject, ...state.projects];
                return {
                  projects,
                  devices: attachDeviceRelations(
                    state.devices,
                    projects,
                    state.vibeRuns,
                  ),
                  events: [
                    event(
                      'project.updated',
                      'Project updated',
                      nextProject.path,
                      'done',
                      {
                        deviceId: nextProject.deviceId,
                        projectId: nextProject.id,
                      },
                    ),
                    ...state.events,
                  ].slice(0, 120),
                };
              });
              return;
            }

            case 'project.deleted':
              set(state => {
                const projects = state.projects.filter(
                  project => project.id !== transportEvent.projectId,
                );
                const vibeRuns = state.vibeRuns.filter(
                  run => run.projectId !== transportEvent.projectId,
                );
                return {
                  projects,
                  vibeRuns,
                  devices: attachDeviceRelations(
                    state.devices,
                    projects,
                    vibeRuns,
                  ),
                  projectFiles: state.projectFiles.filter(
                    file => file.projectId !== transportEvent.projectId,
                  ),
                  events: [
                    event(
                      'project.updated',
                      'Project deleted',
                      transportEvent.projectId,
                      'done',
                      {
                        projectId: transportEvent.projectId,
                      },
                    ),
                    ...state.events,
                  ].slice(0, 120),
                };
              });
              return;

            case 'projects.updated':
              if (get().serverMode) {
                scheduleRefreshDebounce(() =>
                  get()
                    .refreshFromServer()
                    .catch(() => {}),
                );
              }
              return;

            case 'client.presence.updated':
            case 'raw':
              return;
          }
        } catch (error) {
          console.warn(
            '[store] transport handler failed for',
            transportEvent.type,
            error,
          );
        }
      },
    };
  },
);

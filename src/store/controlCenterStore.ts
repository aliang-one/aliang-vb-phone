import { create } from 'zustand';
import { useMemo } from 'react';
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
import {
  flushTerminalOutput,
  pushTerminalOutput,
  registerTerminalOutputApplier,
  type TerminalOutputBatchItem,
} from './terminalBatching';
import type {
  ControlCenterState,
  TerminalSessionStatus,
  UnifiedEvent,
} from './types';
import {
  activityNowMs,
  attachDeviceRelations,
  createId,
  evictOverflowVibeRuns,
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
  trimTranscript,
  upsertNotification,
} from './internals';
import { createRealtimeSlice } from './slices/realtimeSlice';
import { createTerminalSlice } from './slices/terminalSlice';
import { createApprovalSlice } from './slices/approvalSlice';
import { createAiSessionSlice } from './slices/aiSessionSlice';
import { createDeviceProjectSlice } from './slices/deviceProjectSlice';
import {
  applyStructuredEvent,
  reconcileStructured,
} from './slices/structuredSlice';

const EMPTY_SESSION_APPROVALS: ControlCenterState['approvals'] = [];

// Re-export the domain types so the 21 consumer files keep importing them from
// this module — their import paths (`../store/controlCenterStore`) stay valid.
export * from './types';

// ============================================================
// Fine-grained selectors
// ------------------------------------------------------------
// The store is a single tree, but that does NOT mean subscribers must
// re-render on every field change. These selector helpers let screens
// subscribe to ONLY the slice they render, so (for example) a streaming
// ai.delta on session A no longer re-renders the screen viewing session B.
// `find` returns a stable reference as long as that one run object's
// identity is unchanged — merging logic in internals.ts keeps unchanged
// runs referentially equal, so the selector bails out cheaply.
// ============================================================

/** Subscribe to a single AI session by id. Re-renders ONLY when that session's
 *  object identity changes (not when other sessions stream deltas). */
export const useVibeRun = (sessionId: string | undefined) =>
  useControlCenterStore(state =>
    sessionId ? state.vibeRuns.find(run => run.id === sessionId) : undefined,
  );

/** Subscribe to approvals for one session, sorted newest-first. */
export const useSessionApprovals = (sessionId: string | undefined) => {
  const approvals = useControlCenterStore(state => state.approvals);

  return useMemo(
    () =>
      sessionId
        ? approvals
            .filter(item => item.sessionId === sessionId)
            .sort(
              (left, right) =>
                Date.parse(right.createdAt) - Date.parse(left.createdAt),
            )
        : EMPTY_SESSION_APPROVALS,
    [approvals, sessionId],
  );
};

/** Subscribe to a single project by id. */
export const useProject = (projectId: string | undefined) =>
  useControlCenterStore(state =>
    projectId ? state.projects.find(project => project.id === projectId) : undefined,
  );

/** Subscribe to a single device by id. */
export const useDevice = (deviceId: string | undefined) =>
  useControlCenterStore(state =>
    deviceId ? state.devices.find(device => device.id === deviceId) : undefined,
  );

/** Subscribe to the preview link for a session. */
export const useSessionPreview = (sessionId: string | undefined) =>
  useControlCenterStore(state =>
    sessionId
      ? state.previewLinks.find(link => link.sessionId === sessionId)
      : undefined,
  );

/** Subscribe to a single terminal session by id. Re-renders ONLY when that
 *  session's object identity changes. The batched terminal.output flush
 *  (applyOutputToSession) preserves identity for sessions whose lines didn't
 *  change, so background terminal output no longer re-renders a screen viewing
 *  a different terminal. */
export const useTerminalSession = (sessionId: string | undefined) =>
  useControlCenterStore(state =>
    sessionId
      ? state.terminalSessions.find(ts => ts.id === sessionId)
      : undefined,
  );

// ============================================================
// Terminal output reducer (extracted from the transport dispatcher)
// ------------------------------------------------------------
// Pure per-session line update for one `terminal.output` payload. Returns the
// SAME session reference when the payload is a no-op, so the batched flush can
// preserve identity for sessions whose lines didn't change (and for the whole
// `terminalSessions` array when no session changed). Exported for testing.
// ============================================================
type TerminalSessionLike = ControlCenterState['terminalSessions'][number];

export const applyOutputToSession = (
  session: TerminalSessionLike,
  data: string,
  encoding: string,
): TerminalSessionLike => {
  let screenFrameStartIndex = 0;
  for (let index = session.lines.length - 1; index >= 0; index -= 1) {
    if (session.lines[index].kind === 'command') {
      screenFrameStartIndex = index + 1;
      break;
    }
  }

  const previousScreenLines = session.lines
    .slice(screenFrameStartIndex)
    .filter(item => item.kind === 'stdout')
    .map(item => item.content);
  const outputUpdate = terminalDisplayUpdate(data, encoding, previousScreenLines);
  if (!outputUpdate.lines.length && outputUpdate.mode !== 'replaceScreen') {
    return session;
  }

  const nextOutputLines = outputUpdate.lines.map(item => line('stdout', item));
  let preservedLines = session.lines;

  if (outputUpdate.mode === 'replaceScreen') {
    preservedLines = [
      ...session.lines.slice(0, screenFrameStartIndex),
      ...session.lines
        .slice(screenFrameStartIndex)
        .filter(item => item.kind !== 'stdout'),
    ];
  } else if (outputUpdate.mode === 'rewriteLastLine') {
    let lastStdoutIndex = -1;
    for (let index = session.lines.length - 1; index >= 0; index -= 1) {
      if (session.lines[index].kind === 'stdout') {
        lastStdoutIndex = index;
        break;
      }
    }
    preservedLines =
      lastStdoutIndex >= 0
        ? session.lines.filter((_, index) => index !== lastStdoutIndex)
        : session.lines;
  }

  return {
    ...session,
    lines: tail([...preservedLines, ...nextOutputLines], MAX_TERMINAL_LINES),
    updatedAt: nowTime(),
  };
};

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
      set(state => {
        const vibeRuns = applyDeltasToRuns(
          state.vibeRuns,
          deltas,
          () => createId('msg'),
          shortTime,
        );
        return {
          vibeRuns: evictOverflowVibeRuns(
            vibeRuns.map(run => ({
              ...run,
              transcript: trimTranscript(run.transcript),
            })),
          ),
        };
      }),
    );

    // Let ./terminalBatching flush buffered `terminal.output` chunks back into
    // the store without it depending on zustand. One identity-preserving write
    // per flush window: chunks are grouped by session and applied in arrival
    // order, and untouched sessions keep their object reference — so a
    // fine-grained `useTerminalSession(id)` subscriber only re-renders when ITS
    // terminal actually changed, and the whole `terminalSessions` array keeps
    // its reference when no session changed.
    registerTerminalOutputApplier(items =>
      set(state => {
        const grouped = new Map<string, TerminalOutputBatchItem[]>();
        for (const item of items) {
          const arr = grouped.get(item.sessionId);
          if (arr) {
            arr.push(item);
          } else {
            grouped.set(item.sessionId, [item]);
          }
        }
        let changed = false;
        const next = state.terminalSessions.map(ts => {
          const batch = grouped.get(ts.id);
          if (!batch) {
            return ts;
          }
          let current: TerminalSessionLike = ts;
          for (const item of batch) {
            current = applyOutputToSession(current, item.data, item.encoding);
          }
          if (current === ts) {
            return ts;
          }
          changed = true;
          return current;
        });
        return {
          terminalSessions: changed ? next : state.terminalSessions,
        };
      }),
    );

    return {
      ...createRealtimeSlice(set, get, store),
      ...createTerminalSlice(set, get, store),
      ...createApprovalSlice(set, get, store),
      ...createAiSessionSlice(set, get, store),
      ...createDeviceProjectSlice(set, get, store),

      // Only the global activity log lives here; all domain data is owned by slices.
      events: [],
      // No session is viewed until a chat screen focuses.
      currentlyViewedSessionId: undefined,
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
          if (transportEvent.type !== 'terminal.output') {
            flushTerminalOutput();
          }

          switch (transportEvent.type) {
            case 'transport.status':
              // On (re)connect, pull a fresh snapshot to recover any state
              // changes that were broadcast while the socket was down — WS has
              // no replay buffer, so a full resync is the only way to not lose
              // events during a network blip.
              if (transportEvent.status === 'connected') {
                set({ wsConnected: true });
                if (get().serverMode) {
                  get()
                    .refreshFromServer()
                    .catch(() => {
                      set({ stale: true });
                    });
                }
              } else {
                set({ wsConnected: false, stale: true });
              }
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
              // Status-neutral. ai.done ends ONE streaming turn, not the whole
              // run — for a tool-using agent it often lands mid-task (the model
              // just emitted a tool_use and will start a new turn when the tool
              // returns). The server is the status authority: it arms a soft
              // idle-settle (ALIANG_AI_IDLE_SETTLE_MS) and only publishes
              // idle/completed when no further activity follows, which arrives
              // here as 'ai.session.updated' and is merged via
              // mergeVibeRunSnapshot. Buffered deltas were already flushed above
              // (flushDeltas runs before the switch), so there's nothing to do.
              // Flipping to idle + a "Session completed" event on every turn
              // would make a tool-using run flash done/idle during every tool
              // gap.
              //
              // BUT: a turn may have produced an approval / 方案选择 that the
              // server derived from the assistant reply and pushed as
              // approval.requested + a paused session state. Those are one-shot
              // pushes that can be missed (the WS was momentarily gone), and
              // unlike deltas they don't self-heal — so the user would only see
              // the approval after a manual re-entry (REST). Re-fetch the
              // dashboard snapshot (debounced, same as ai.sessions.updated) so
              // any missed approval/state is recovered at turn-end. The
              // snapshot's pending_approvals repopulate state.approvals, which
              // useSessionApprovals renders.
              //
              // Finalize any in-flight structured activity so isSessionLive can
              // settle. ai.done ends THIS streaming turn, so an active thinking
              // block / a started command that wasn't followed by its own
              // completion event must not keep deriveLivePulse().hasActive pinned
              // true — that would pin the top status at 进行中 via the isLive
              // branch even after the server settles to idle, so the session
              // shows 进行中 forever after a turn that ended on a thinking/command
              // event with no trailing done.
              set(state => ({
                vibeRuns: state.vibeRuns.map(run => {
                  if (run.id !== transportEvent.sessionId) return run;
                  if (!run.structuredEvents?.length) return run;
                  let changed = false;
                  const finalized = run.structuredEvents.map(e => {
                    if (e.kind === 'thinking' && e.active) {
                      changed = true;
                      return { ...e, active: false };
                    }
                    if (e.kind === 'command' && e.status === 'started') {
                      changed = true;
                      return { ...e, status: 'done' as const };
                    }
                    return e;
                  });
                  return changed ? { ...run, structuredEvents: finalized } : run;
                }),
              }));
              if (get().serverMode) {
                scheduleRefreshDebounce(() =>
                  get()
                    .refreshFromServer()
                    .catch(() => {}),
                );
              }
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

            case 'ai.status':
              set(state => ({
                vibeRuns: state.vibeRuns.map(item =>
                  item.id === transportEvent.sessionId
                    ? {
                        ...item,
                        status:
                          item.status === 'failed' || item.status === 'completed'
                            ? item.status
                            : ('running' as VibeStatus),
                        currentStep: transportEvent.status || item.currentStep,
                        lastActivityMs: activityNowMs(),
                        updatedAt: formatActivityLabel(activityNowMs()),
                      }
                    : item,
                ),
              }));
              return;

            case 'ai.steer.ack':
              set(state => ({
                vibeRuns: state.vibeRuns.map(run => {
                  if (run.id !== transportEvent.sessionId) return run;
                  const failed =
                    transportEvent.result === 'error' ||
                    transportEvent.result === 'unsupported' ||
                    transportEvent.result === 'not_running';
                  const transcript = run.transcript.map(message =>
                    message.id === transportEvent.messageId
                      ? { ...message, pending: false }
                      : message,
                  );
                  return {
                    ...run,
                    transcript,
                    currentStep: failed
                      ? transportEvent.error || 'Failed to steer current turn.'
                      : run.currentStep,
                    lastActivityMs: activityNowMs(),
                    updatedAt: formatActivityLabel(activityNowMs()),
                  };
                }),
              }));
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

            case 'ai.command':
            case 'ai.file_change':
            case 'ai.thinking':
            case 'ai.usage':
            case 'ai.task': {
              // All 5 structured-activity transport types funnel through
              // applyStructuredEvent, which dispatches on type internally
              // (command two-state merge, task replace, others overlay) and
              // upserts onto run.structuredEvents by eventId.
              set(state => ({
                vibeRuns: state.vibeRuns.map(run =>
                  run.id === transportEvent.sessionId
                    ? applyStructuredEvent(run, transportEvent)
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
                // Reconcile the snapshot's structured_events with live state so
                // events that arrived live (and may not be in the snapshot yet)
                // aren't clobbered. Snapshot wins on eventId conflict; local
                // events not in the snapshot are preserved. The per-event detail
                // cache is local-only (never present in a snapshot) so keep the
                // previous run's cache.
                const reconciled = previousRun
                  ? {
                      ...nextRun,
                      structuredEvents: reconcileStructured(
                        previousRun.structuredEvents,
                        nextRun.structuredEvents,
                      ),
                      eventDetailCache: previousRun.eventDetailCache,
                    }
                  : nextRun;
                const shouldRecordEvent = hasMeaningfulVibeRunUpdate(
                  previousRun,
                  reconciled,
                );
                const exists = Boolean(previousRun);
                const rawVibeRuns = exists
                  ? state.vibeRuns.map(run =>
                      run.id === reconciled.id
                        ? mergeVibeRunSnapshot(run, reconciled)
                        : run,
                    )
                  : [reconciled, ...state.vibeRuns];
                // Apply memory bounds: limit total sessions and trim transcripts
                const vibeRuns = evictOverflowVibeRuns(
                  rawVibeRuns.map(run => ({
                    ...run,
                    transcript: trimTranscript(run.transcript),
                  })),
                );
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
              // Route to the live emulator when its screen is mounted; the
              // emulator owns the rendered output and the store isn't touched.
              // Otherwise buffer the chunk — a background terminal can spew many
              // chunks per second, and batching them into one identity-preserving
              // store write per ~60ms window avoids re-rendering every
              // terminalSessions subscriber on every chunk.
              const routedToEmulator = routeTerminalOutputToEmulator(
                transportEvent.sessionId,
                transportEvent.data,
                transportEvent.encoding,
              );
              if (routedToEmulator) {
                return;
              }
              pushTerminalOutput({
                sessionId: transportEvent.sessionId,
                data: transportEvent.data,
                encoding: transportEvent.encoding,
              });
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

            // Server-initiated close (idle-timeout reaper, agent disconnect, or
            // an explicit close from another client). Mark the local session
            // completed so list views drop it; the PTY is already gone.
            case 'terminal.closed':
              set(state => ({
                terminalSessions: state.terminalSessions.map(ts =>
                  ts.id === transportEvent.sessionId
                    ? { ...ts, status: 'completed' as TerminalSessionStatus }
                    : ts,
                ),
                events: [
                  event(
                    'command.completed',
                    'Terminal session closed',
                    transportEvent.sessionId,
                    'done',
                    { terminalId: transportEvent.sessionId },
                  ),
                  ...state.events,
                ].slice(0, 120),
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
              const approvalEvent = {
                id: `approval-${approval.id}`,
                type: 'approval' as const,
                title: approval.title,
                detail: approval.summary,
                status: 'waiting' as const,
                timestamp: approval.createdAt || shortTime(),
              };
              set(state => ({
                approvals: [
                  approval,
                  ...state.approvals.filter(item => item.id !== approval.id),
                ],
                vibeRuns: state.vibeRuns.map(run =>
                  run.id === approval.sessionId
                    ? {
                        ...run,
                        status: 'waiting_approval' as VibeStatus,
                        currentStep: approval.title,
                        lastActivityMs:
                          Date.parse(approval.createdAt) || activityNowMs(),
                        updatedAt: formatActivityLabel(
                          Date.parse(approval.createdAt) || activityNowMs(),
                        ),
                        events: tail(
                          [
                            ...run.events.filter(
                              item => item.id !== approvalEvent.id,
                            ),
                            approvalEvent,
                          ],
                          MAX_RUN_EVENTS,
                        ),
                      }
                    : run,
                ),
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
              const approvalDecision =
                nextNotification.approvalId &&
                nextNotification.type !== 'approval'
                  ? nextNotification.type === 'completed'
                    ? 'approved'
                    : nextNotification.type === 'error'
                    ? 'denied'
                    : undefined
                  : undefined;
              set(state => ({
                notifications: upsertNotification(
                  state.notifications,
                  nextNotification,
                ),
                approvals: approvalDecision
                  ? state.approvals.map(item =>
                      item.id === nextNotification.approvalId
                        ? {
                            ...item,
                            status: approvalDecision,
                            resolvedAt: nextNotification.createdAt,
                          }
                        : item,
                    )
                  : state.approvals,
                vibeRuns: approvalDecision
                  ? state.vibeRuns.map(run => {
                      if (run.id !== nextNotification.sessionId) return run;
                      const resolvedAtMs =
                        Date.parse(nextNotification.createdAt) ||
                        activityNowMs();
                      const nextEvent = {
                        id: `approval-${nextNotification.approvalId}`,
                        type: 'approval' as const,
                        title:
                          approvalDecision === 'approved'
                            ? 'Approval granted'
                            : 'Approval denied',
                        detail: nextNotification.body,
                        status:
                          approvalDecision === 'approved'
                            ? ('done' as const)
                            : ('failed' as const),
                        timestamp: nextNotification.createdAt,
                      };
                      return {
                        ...run,
                        status:
                          approvalDecision === 'approved'
                            ? run.status === 'waiting_approval'
                              ? ('running' as VibeStatus)
                              : run.status
                            : ('failed' as VibeStatus),
                        currentStep:
                          approvalDecision === 'approved'
                            ? 'Approval granted. Waiting for agent to continue.'
                            : 'Approval denied from mobile.',
                        lastActivityMs: Math.max(
                          run.lastActivityMs ?? 0,
                          resolvedAtMs,
                        ),
                        updatedAt: formatActivityLabel(
                          Math.max(run.lastActivityMs ?? 0, resolvedAtMs),
                        ),
                        events: tail(
                          [
                            ...run.events.filter(
                              item => item.id !== nextEvent.id,
                            ),
                            nextEvent,
                          ],
                          MAX_RUN_EVENTS,
                        ),
                      };
                    })
                  : state.vibeRuns,
                events:
                  nextNotification.approvalId
                    ? state.events
                    : [
                        event(
                          nextNotification.type === 'completed'
                            ? 'agent.session.completed'
                            : nextNotification.type === 'error'
                            ? 'agent.session.failed'
                            : 'platform.event',
                          nextNotification.title,
                          nextNotification.body,
                          nextNotification.type === 'error'
                            ? 'failed'
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

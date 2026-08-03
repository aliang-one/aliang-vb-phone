import type { StateCreator } from 'zustand';
import { platformTransport } from '../../services/platformTransport';
import { getApiAuthToken } from '../../api/client';
import { cancelRefreshDebounce } from '../streaming';
import { cancelAiStreamBatch } from '../aiStreamBatching';
import { cancelTerminalBatch } from '../terminalBatching';
import type { ControlCenterState, RefreshOutcome } from '../types';
import {
  dedupeUnifiedEvents,
  emptySessionData,
  realtimeEventToUnifiedEvent,
  resolveRefreshAction,
  stateFromSnapshot,
} from '../internals';
import { emptyHistoryPage, historyPageFromServer } from '../historyPaging';

const SNAPSHOT_SYNC_TIMEOUT_MS = 30_000;

type RealtimeSlice = Pick<
  ControlCenterState,
  | 'wsConnected' | 'serverMode' | 'lastSyncedAt' | 'stale' | 'lastConnectError'
  | 'eventHistory' | 'eventHistoryPages' | 'loadEventHistory'
  | 'initializeFromServer' | 'refreshFromServer' | 'disconnectFromServer'
  | 'resetSessionData' | 'markStale'
>;

let refreshInFlight: Promise<RefreshOutcome> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

const loadSnapshotWithTimeout = () =>
  withTimeout(platformTransport.loadSnapshot(), SNAPSHOT_SYNC_TIMEOUT_MS, 'Platform snapshot refresh');

// Connection lifecycle slice. Owns connection/freshness state + the
// server-sync lifecycle. The cross-domain transport dispatcher
// (`handleTransportEvent`) stays in the composition root below — it routes
// events to every domain via get()/set(), so it is infrastructure, not a domain.
export const createRealtimeSlice: StateCreator<ControlCenterState, [], [], RealtimeSlice> = (set, get) => ({
  wsConnected: false,
  serverMode: false,
  lastSyncedAt: null,
  stale: false,
  lastConnectError: null,
  eventHistory: [],
  eventHistoryPages: {},

  loadEventHistory: async options => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before loading event history.');
    }
    const scopeKey = `${options?.deviceId ?? 'all'}:${options?.sessionId ?? 'all'}`;
    const currentPage = get().eventHistoryPages[scopeKey] ?? emptyHistoryPage();
    if (currentPage.loading) return;
    const reset = options?.reset === true;
    if (!reset && currentPage.initialized && !currentPage.hasMore) return;
    set(state => ({
      eventHistoryPages: {
        ...state.eventHistoryPages,
        [scopeKey]: { ...currentPage, loading: true, error: undefined },
      },
    }));
    try {
      const response = await platformTransport.loadRealtimeEventsPage({
        limit: 30,
        before: reset ? undefined : currentPage.nextBeforeCursor,
        deviceId: options?.deviceId,
        sessionId: options?.sessionId,
      });
      const incoming = response.events.map(realtimeEventToUnifiedEvent);
      set(state => ({
        eventHistory: dedupeUnifiedEvents([...incoming, ...state.eventHistory]),
        eventHistoryPages: {
          ...state.eventHistoryPages,
          [scopeKey]: historyPageFromServer(response.page),
        },
      }));
    } catch (error) {
      set(state => ({
        eventHistoryPages: {
          ...state.eventHistoryPages,
          [scopeKey]: {
            ...(state.eventHistoryPages[scopeKey] ?? currentPage),
            initialized: true,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          },
        },
      }));
      throw error;
    }
  },

  initializeFromServer: async (token) => {
    platformTransport.disconnect();
    cancelAiStreamBatch();
    cancelTerminalBatch();
    cancelRefreshDebounce();
    set(state => {
      const hasResidentData =
        state.vibeRuns.length ||
        state.devices.length ||
        state.projects.length ||
        state.approvals.length ||
        state.notifications.length;
      return {
        ...(hasResidentData ? {} : emptySessionData()),
        serverMode: true,
        wsConnected: false,
        stale: Boolean(hasResidentData),
      };
    });

    try {
      const snapshot = await loadSnapshotWithTimeout();
      const nextState = stateFromSnapshot(
        snapshot,
        get().vibeRuns,
        get().terminalSessions,
        get().terminalCommandHistory,
      );

      set({
        ...nextState,
        lastSyncedAt: Date.now(),
        stale: false,
        lastConnectError: null,
      });

      console.log(`[store] Initialized from server: ${nextState.devices.length} devices, ${nextState.projects.length} projects, ${nextState.vibeRuns.length} AI sessions, ${nextState.terminalSessions.length} terminals, ${nextState.approvals.length} approvals`);

      platformTransport.connect(transportEvent => {
        get().handleTransportEvent(transportEvent);
      }, token);
    } catch (error) {
      console.warn('[store] Failed to initialize from server:', error);
      platformTransport.disconnect();
      cancelAiStreamBatch();
      cancelRefreshDebounce();
      set({
        wsConnected: false,
        serverMode: false,
        lastConnectError: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error
        ? error
        : new Error('Unable to connect to the local platform.');
    }
  },

  refreshFromServer: async () => {
    // Self-heal: if we're NOT in server mode (initializeFromServer failed or
    // never ran) but still hold a session token, re-run the full init instead
    // of no-op'ing. Without this, a single transient snapshot/WS failure at
    // boot strands the app "logged in (Me) but no data" until the user kills
    // the app or re-logs in — `refreshFromServer` is the path every recovery
    // trigger (foreground heartbeat, pull-to-refresh) routes through.
    const token = getApiAuthToken();
    const action = resolveRefreshAction(get().serverMode, Boolean(token));
    if (action === 'reinitialize' && token) {
      return get()
        .initializeFromServer(token)
        .then(() => ({ ok: true as const }))
        .catch(error => {
          console.warn('[store] Failed to reinitialize from server:', error);
          const message = error instanceof Error ? error.message : String(error);
          set({ stale: true, lastConnectError: message });
          return { ok: false as const, error: message };
        });
    }
    if (action === 'noop') {
      set({ stale: true });
      return { ok: false, error: 'No active connection' };
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async (): Promise<RefreshOutcome> => {
      try {
        const snapshot = await loadSnapshotWithTimeout();
        set(state => ({
          ...stateFromSnapshot(
            snapshot,
            state.vibeRuns,
            state.terminalSessions,
            state.terminalCommandHistory,
          ),
          lastSyncedAt: Date.now(),
          stale: false,
          lastConnectError: null,
        }));
        return { ok: true };
      } catch (error) {
        console.warn('[store] Failed to refresh from server:', error);
        const message = error instanceof Error ? error.message : String(error);
        set({ stale: true, lastConnectError: message });
        return { ok: false, error: message };
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  },

  disconnectFromServer: () => {
    platformTransport.disconnect();
    cancelAiStreamBatch();
    cancelTerminalBatch();
    cancelRefreshDebounce();
    set({ wsConnected: false, serverMode: false });
  },

  resetSessionData: () => {
    platformTransport.disconnect();
    cancelAiStreamBatch();
    cancelTerminalBatch();
    cancelRefreshDebounce();
    set({
      ...emptySessionData(),
      wsConnected: false,
      serverMode: false,
    });
  },

  markStale: () => set({ stale: true }),
});

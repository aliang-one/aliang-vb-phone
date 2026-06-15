import type { StateCreator } from 'zustand';
import { platformTransport } from '../../services/platformTransport';
import { cancelDeltaBatch, cancelRefreshDebounce } from '../streaming';
import type { ControlCenterState } from '../types';
import { emptySessionData, stateFromSnapshot } from '../internals';

const SNAPSHOT_SYNC_TIMEOUT_MS = 12000;

type RealtimeSlice = Pick<
  ControlCenterState,
  | 'wsConnected' | 'serverMode' | 'lastSyncedAt' | 'stale'
  | 'initializeFromServer' | 'refreshFromServer' | 'disconnectFromServer'
  | 'resetSessionData' | 'markStale'
>;

let refreshInFlight: Promise<void> | null = null;

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

  initializeFromServer: async (token) => {
    platformTransport.disconnect();
    cancelDeltaBatch();
    cancelRefreshDebounce();
    set({ ...emptySessionData(), serverMode: true, wsConnected: false });

    try {
      const snapshot = await loadSnapshotWithTimeout();
      const nextState = stateFromSnapshot(snapshot, get().vibeRuns);

      set({
        ...nextState,
        lastSyncedAt: Date.now(),
        stale: false,
      });

      console.log(`[store] Initialized from server: ${nextState.devices.length} devices, ${nextState.projects.length} projects, ${nextState.vibeRuns.length} AI sessions, ${nextState.terminalSessions.length} terminals, ${nextState.approvals.length} approvals`);

      platformTransport.connect(transportEvent => {
        get().handleTransportEvent(transportEvent);
      }, token);
    } catch (error) {
      console.warn('[store] Failed to initialize from server:', error);
      platformTransport.disconnect();
      cancelDeltaBatch();
      cancelRefreshDebounce();
      set({ wsConnected: false, serverMode: false });
      throw error instanceof Error
        ? error
        : new Error('Unable to connect to the local platform.');
    }
  },

  refreshFromServer: async () => {
    if (!get().serverMode) {
      set({ stale: true });
      return;
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      try {
        const snapshot = await loadSnapshotWithTimeout();
        set(state => ({
          ...stateFromSnapshot(snapshot, state.vibeRuns),
          lastSyncedAt: Date.now(),
          stale: false,
        }));
      } catch (error) {
        console.warn('[store] Failed to refresh from server:', error);
        set({ stale: true });
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  },

  disconnectFromServer: () => {
    platformTransport.disconnect();
    cancelDeltaBatch();
    cancelRefreshDebounce();
    set({ wsConnected: false, serverMode: false });
  },

  resetSessionData: () => {
    platformTransport.disconnect();
    cancelDeltaBatch();
    cancelRefreshDebounce();
    set({
      ...emptySessionData(),
      wsConnected: false,
      serverMode: false,
    });
  },

  markStale: () => set({ stale: true }),
});

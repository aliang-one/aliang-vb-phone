import type { StateCreator } from 'zustand';
import { platformTransport } from '../../services/platformTransport';
import { cancelDeltaBatch, cancelRefreshDebounce } from '../streaming';
import type { ControlCenterState } from '../types';
import { emptySessionData, stateFromSnapshot } from '../internals';

type RealtimeSlice = Pick<
  ControlCenterState,
  | 'wsConnected' | 'serverMode' | 'lastSyncedAt' | 'stale'
  | 'initializeFromServer' | 'refreshFromServer' | 'disconnectFromServer'
  | 'resetSessionData' | 'markStale'
>;

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
      const snapshot = await platformTransport.loadSnapshot();
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
      throw new Error('Platform connection is required before refreshing workspace data.');
    }
    const snapshot = await platformTransport.loadSnapshot();
    set(state => ({
      ...stateFromSnapshot(snapshot, state.vibeRuns),
      lastSyncedAt: Date.now(),
      stale: false,
    }));
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


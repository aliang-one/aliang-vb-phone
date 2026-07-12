import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { platformTransport } from '../services/platformTransport';
import { useControlCenterStore } from '../store/controlCenterStore';

// Interval for the app-level presence heartbeat. While the app is in the
// foreground we send `presence.alive` so the server's terminal idle-timeout
// reaper keeps the user's shells alive (B model: app open => not idle). The
// moment the app backgrounds, the timer stops — no more heartbeats — so after
// the configured threshold the server closes inactive terminals.
const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * App-lifecycle hook. Mount once at the app root (RootNavigator). Two duties:
 *
 * 1. Presence heartbeat — emit `presence.alive` while foregrounded + connected.
 *
 * 2. Foreground re-sync — on every transition to `active`, pull a fresh
 *    platform snapshot (`refreshFromServer`). WS has no replay buffer, and
 *    React Native keeps the socket "connected" across a background suspension
 *    (no `onclose`/`onopen` fires), so the reconnect-driven resync never runs
 *    on a plain background→foreground hop. Any state the server published
 *    while we were away — VibeCoding sessions the agent reported, approvals,
 *    project changes — is silently lost without this. This is the only
 *    reliable recovery path for, e.g., a project's VibeCoding list missing
 *    sessions that the admin console can see. `refreshFromServer` dedupes
 *    concurrent calls and no-ops when not yet in server mode.
 */
export function usePresenceHeartbeat(): void {
  const refreshFromServer = useControlCenterStore(
    state => state.refreshFromServer,
  );
  const serverMode = useControlCenterStore(state => state.serverMode);
  const previousAppStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const sendAlive = () => {
      // send() returns false (no-op) when the socket isn't open, so this is safe
      // to call before the platform is connected or after a disconnect.
      platformTransport.send({ type: 'presence.alive' });
    };

    const start = () => {
      if (timer) return;
      sendAlive();
      timer = setInterval(sendAlive, PRESENCE_HEARTBEAT_INTERVAL_MS);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Recover anything the server published while we were backgrounded. Initial
    // connect already loads a snapshot, so only AppState background -> active
    // transitions need this extra pull. NOT guarded on serverMode anymore: if
    // the initial initializeFromServer failed (serverMode still false),
    // refreshFromServer now self-heals by re-running the full init — so a
    // background→foreground hop recovers the "logged in but no data" stuck
    // state instead of no-op'ing. When genuinely logged out (no token),
    // refreshFromServer no-ops internally.
    const resync = () => {
      void refreshFromServer();
    };

    const handleChange = (state: AppStateStatus) => {
      const previousState = previousAppStateRef.current;
      previousAppStateRef.current = state;
      if (state === 'active') {
        start();
        if (previousState !== 'active') {
          resync();
        }
      } else {
        stop();
      }
    };

    // AppState may already be 'active' at mount (no change event will fire), so
    // start the heartbeat without forcing a second initial snapshot refresh.
    if (AppState.currentState === 'active') {
      start();
    }

    const subscription = AppState.addEventListener('change', handleChange);
    return () => {
      subscription.remove();
      stop();
    };
  }, [refreshFromServer, serverMode]);
}

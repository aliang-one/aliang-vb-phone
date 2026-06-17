import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { platformTransport } from '../services/platformTransport';

// Interval for the app-level presence heartbeat. While the app is in the
// foreground we send `presence.alive` so the server's terminal idle-timeout
// reaper keeps the user's shells alive (B model: app open => not idle). The
// moment the app backgrounds, the timer stops — no more heartbeats — so after
// the configured threshold the server closes inactive terminals.
const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Sends a `presence.alive` heartbeat to the platform while the app is in the
 * foreground and the realtime socket is connected. Stops on background/inactive
 * and cleans up on unmount. Mount once at the app root.
 */
export function usePresenceHeartbeat(): void {
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

    const handleChange = (state: AppStateStatus) => {
      if (state === 'active') {
        start();
      } else {
        stop();
      }
    };

    // AppState may already be 'active' at mount (no change event will fire).
    if (AppState.currentState === 'active') {
      start();
    }

    const subscription = AppState.addEventListener('change', handleChange);
    return () => {
      subscription.remove();
      stop();
    };
  }, []);
}

import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useControlCenterStore } from '../store/controlCenterStore';
import { IDLE_SWEEP_INTERVAL_MS } from '../store/internals';

/**
 * Bounds resident AI-session memory by demoting sessions the user isn't paying
 * attention to (see bounded-memory spec). Two triggers, both calling
 * `demoteIdleSessions`:
 *
 *  1. AppState → inactive/background: the user left the app — sweep idle
 *     sessions now (the primary "stopped paying attention" signal).
 *  2. A coarse `setInterval` (IDLE_SWEEP_INTERVAL_MS, default 5 min): a
 *     fallback that also covers "app stays foregrounded but the user walked
 *     away", satisfying the literal "periodically clean" intent without a
 *     high-frequency always-on timer.
 *
 * The hard-floor caps (structuredEvents / eventDetailCache) bound memory
 * regardless of whether this hook ever fires; demotion is an optimization that
 * releases detail for not-attended sessions. Active (streaming) sessions and
 * the currently-viewed session are never demoted, so this never interrupts a
 * live view. Self-guards on `serverMode` so it's safe to mount unconditionally
 * at the root.
 */
export function useIdleSessionDemoter(): void {
  const serverMode = useControlCenterStore(state => state.serverMode);
  const demoteIdleSessions = useControlCenterStore(
    state => state.demoteIdleSessions,
  );

  useEffect(() => {
    if (!serverMode) return;

    const sweep = () => {
      try {
        demoteIdleSessions();
      } catch (error) {
        // Best-effort cleanup: never let a sweep failure break the app.
        console.warn('[idleSessionDemoter] sweep failed:', error);
      }
    };

    const onAppStateChange = (nextState: AppStateStatus) => {
      // 'active' = app in foreground; anything else = user's attention left.
      if (nextState !== 'active') {
        sweep();
      }
    };

    const subscription = AppState.addEventListener('change', onAppStateChange);
    const timer = setInterval(sweep, IDLE_SWEEP_INTERVAL_MS);

    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [serverMode, demoteIdleSessions]);
}

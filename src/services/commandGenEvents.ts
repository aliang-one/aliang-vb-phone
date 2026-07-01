// Transient subscriber registry for `commandGen.*` WebSocket events.
//
// The control-center store owns the durable conversation/AI state, but the live
// command-generation loop timeline (tool calls, snippets, final command) is
// ephemeral and only one consumer (VoiceToBashModal) cares about it at a time.
// Rather than thread these high-frequency, short-lived events through the store,
// we expose a process-local pub/sub here. websocket.ts taps every incoming
// `commandGen.*` message into `dispatchCommandGenEvent`, and any mounted view
// subscribes via `subscribeCommandGenEvents` for the duration of its focus.

export type CommandGenLiveEvent =
  | {
      type: 'commandGen.runStarted';
      runId: string;
      text?: string;
      cwd?: string;
      mode?: string;
      model?: string;
      ts?: string;
    }
  | {
      type: 'commandGen.step';
      runId: string;
      seq: number;
      kind: string;
      toolName?: string;
      toolArgs?: Record<string, unknown>;
      snippet?: string;
      durationMs?: number;
      ts?: string;
    }
  | {
      type: 'commandGen.runFinished';
      runId: string;
      status: string;
      finalCommand?: string;
      dangerous?: boolean;
      ts?: string;
    }
  | {
      type: 'commandGen.failed';
      runId: string;
      reason?: string;
      ts?: string;
    };

type Listener = (e: CommandGenLiveEvent) => void;

const listeners = new Set<Listener>();

/**
 * Subscribe to all `commandGen.*` events for the lifetime of a view/hook.
 * Returns an unsubscribe function; calling it removes the listener.
 */
export function subscribeCommandGenEvents(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * Fan an incoming `commandGen.*` WS message out to every active subscriber.
 * A listener that throws is isolated — one bad consumer must not starve the
 * rest of the timeline.
 */
export function dispatchCommandGenEvent(e: CommandGenLiveEvent): void {
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      /* a bad listener must not break others */
    }
  }
}

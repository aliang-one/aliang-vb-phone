import { subscribeCommandGenEvents, dispatchCommandGenEvent } from '../../src/services/commandGenEvents';

describe('commandGenEvents registry', () => {
  it('delivers commandGen.* events to subscribers', () => {
    const seen: any[] = [];
    const unsub = subscribeCommandGenEvents((e) => seen.push(e));
    dispatchCommandGenEvent({ type: 'commandGen.step', runId: 'cgr_1', seq: 1, kind: 'tool_call', durationMs: 3, ts: 't' });
    expect(seen).toHaveLength(1);
    expect(seen[0].runId).toBe('cgr_1');
    unsub();
  });
  it('unsubscribe stops delivery', () => {
    const seen: any[] = [];
    const unsub = subscribeCommandGenEvents((e) => seen.push(e));
    unsub();
    dispatchCommandGenEvent({ type: 'commandGen.runStarted', runId: 'x', ts: 't' } as any);
    expect(seen).toHaveLength(0);
  });
  it('a throwing listener does not break other listeners', () => {
    subscribeCommandGenEvents(() => { throw new Error('boom'); });
    let got = false;
    subscribeCommandGenEvents(() => { got = true; });
    dispatchCommandGenEvent({ type: 'commandGen.runStarted', runId: 'x', ts: 't' } as any);
    expect(got).toBe(true);
  });
});

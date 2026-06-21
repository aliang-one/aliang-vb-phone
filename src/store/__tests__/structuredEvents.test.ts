import type { VibeCodingRun } from '../../data/platformModels';
import type { PlatformTransportEvent } from '../../services/platformTransport';
import {
  applyStructuredEvent,
  reconcileStructured,
} from '../slices/structuredSlice';

// Minimal run mock — only the fields the slice touches. Cast through unknown
// so we don't have to materialize the full VibeCodingRun literal.
const makeRun = (
  structuredEvents: VibeCodingRun['structuredEvents'] = [],
): VibeCodingRun =>
  ({
    id: 's1',
    structuredEvents,
  }) as unknown as VibeCodingRun;

const commandStarted = (): PlatformTransportEvent => ({
  type: 'ai.command',
  sessionId: 's1',
  messageId: 'm1',
  itemId: 'i1',
  status: 'running',
  command: 'npm test',
  cwd: '/repo',
  eventId: 'e1',
  raw: {},
});

const commandCompleted = (): PlatformTransportEvent => ({
  type: 'ai.command',
  sessionId: 's1',
  messageId: 'm1',
  itemId: 'i1',
  status: 'completed',
  exitCode: 0,
  // command/cwd intentionally omitted on the completed envelope
  eventId: 'e1',
  raw: {},
});

const thinkingActive = (): PlatformTransportEvent => ({
  type: 'ai.thinking',
  sessionId: 's1',
  messageId: 'm1',
  active: true,
  chars: 100,
  eventId: 'e2',
  raw: {},
});

const thinkingUpdate = (): PlatformTransportEvent => ({
  type: 'ai.thinking',
  sessionId: 's1',
  messageId: 'm1',
  active: false,
  chars: 250,
  eventId: 'e2',
  raw: {},
});

const taskOne = (): PlatformTransportEvent => ({
  type: 'ai.task',
  sessionId: 's1',
  messageId: 'm1',
  tasks: [{ subject: 'A', status: 'in_progress', active_form: 'doing A' }],
  eventId: 'e3',
  raw: {},
});

const taskTwo = (): PlatformTransportEvent => ({
  type: 'ai.task',
  sessionId: 's1',
  messageId: 'm1',
  tasks: [
    { subject: 'A', status: 'completed' },
    { subject: 'B', status: 'in_progress' },
  ],
  eventId: 'e3',
  raw: {},
});

const usageOne = (): PlatformTransportEvent => ({
  type: 'ai.usage',
  sessionId: 's1',
  inputTokens: 10,
  outputTokens: 20,
  eventId: 'e4',
  raw: {},
});

const usageOverlay = (): PlatformTransportEvent => ({
  type: 'ai.usage',
  sessionId: 's1',
  outputTokens: 99,
  model: 'gpt-x',
  eventId: 'e4',
  raw: {},
});

const fileChange = (): PlatformTransportEvent => ({
  type: 'ai.file_change',
  sessionId: 's1',
  messageId: 'm1',
  itemId: 'i5',
  path: '/repo/a.ts',
  kind: 'edit',
  added: 3,
  removed: 1,
  eventId: 'e5',
  raw: {},
});

describe('structuredSlice / applyStructuredEvent', () => {
  it('appends a new event when no matching eventId exists', () => {
    const run = makeRun([]);
    const next = applyStructuredEvent(run, commandStarted());
    expect(next.structuredEvents).toHaveLength(1);
    expect(next.structuredEvents[0]).toMatchObject({
      kind: 'command',
      eventId: 'e1',
      status: 'running',
      command: 'npm test',
    });
  });

  it('merges a completed command onto the started one (one entry, completed status, keeps command/cwd)', () => {
    let run = makeRun([]);
    run = applyStructuredEvent(run, commandStarted());
    run = applyStructuredEvent(run, commandCompleted());
    expect(run.structuredEvents).toHaveLength(1);
    const ev = run.structuredEvents[0];
    expect(ev.kind).toBe('command');
    if (ev.kind !== 'command') return;
    expect(ev.status).toBe('completed');
    expect(ev.exitCode).toBe(0);
    // kept from started envelope since completed omits them
    expect(ev.command).toBe('npm test');
    expect(ev.cwd).toBe('/repo');
  });

  it('updates thinking active/chars by eventId', () => {
    let run = makeRun([]);
    run = applyStructuredEvent(run, thinkingActive());
    run = applyStructuredEvent(run, thinkingUpdate());
    expect(run.structuredEvents).toHaveLength(1);
    const ev = run.structuredEvents[0];
    expect(ev.kind).toBe('thinking');
    if (ev.kind !== 'thinking') return;
    expect(ev.active).toBe(false);
    expect(ev.chars).toBe(250);
  });

  it('replaces the task array (latest snapshot wins)', () => {
    let run = makeRun([]);
    run = applyStructuredEvent(run, taskOne());
    run = applyStructuredEvent(run, taskTwo());
    expect(run.structuredEvents).toHaveLength(1);
    const ev = run.structuredEvents[0];
    expect(ev.kind).toBe('task');
    if (ev.kind !== 'task') return;
    expect(ev.tasks).toHaveLength(2);
    expect(ev.tasks[0].status).toBe('completed');
    expect(ev.tasks[1].subject).toBe('B');
  });

  it('overlays usage fields by eventId', () => {
    let run = makeRun([]);
    run = applyStructuredEvent(run, usageOne());
    run = applyStructuredEvent(run, usageOverlay());
    expect(run.structuredEvents).toHaveLength(1);
    const ev = run.structuredEvents[0];
    expect(ev.kind).toBe('usage');
    if (ev.kind !== 'usage') return;
    // The overlay is a shallow {...prev, ...activity} merge. The second
    // envelope's omitted fields are `undefined` on the object literal, so they
    // clobber prior values (JS spread copies undefined keys). Fields the second
    // envelope carries win; omitted ones become undefined.
    expect(ev.outputTokens).toBe(99); // overwritten (present on 2nd)
    expect(ev.model).toBe('gpt-x'); // added (present on 2nd)
    expect(ev.inputTokens).toBeUndefined(); // clobbered (omitted on 2nd)
  });

  it('maps the file_change transport `kind` field to activity `changeKind`', () => {
    const run = makeRun([]);
    const next = applyStructuredEvent(run, fileChange());
    const ev = next.structuredEvents[0];
    expect(ev.kind).toBe('file_change');
    if (ev.kind !== 'file_change') return;
    expect(ev.changeKind).toBe('edit');
    expect(ev.path).toBe('/repo/a.ts');
    expect(ev.added).toBe(3);
  });

  it('does not mutate the input run (immutability)', () => {
    const run = makeRun([]);
    const snapshot = run.structuredEvents;
    applyStructuredEvent(run, commandStarted());
    expect(run.structuredEvents).toBe(snapshot);
    expect(run.structuredEvents).toHaveLength(0);
  });

  it('returns the run unchanged for an unrelated transport type', () => {
    const run = makeRun([]);
    const unrelated = {
      type: 'ai.delta',
      sessionId: 's1',
      delta: 'x',
      eventId: 'ex',
      raw: {},
    } as unknown as PlatformTransportEvent;
    const next = applyStructuredEvent(run, unrelated);
    expect(next).toBe(run);
  });
});

describe('structuredSlice / reconcileStructured', () => {
  it('unions local + snapshot by eventId', () => {
    const local = [
      { kind: 'command', eventId: 'e1', status: 'running' },
      { kind: 'thinking', eventId: 'e2', active: true, chars: 1 },
    ] as VibeCodingRun['structuredEvents'];
    const snapshot = [
      { kind: 'usage', eventId: 'e3', inputTokens: 5 },
    ] as VibeCodingRun['structuredEvents'];
    const out = reconcileStructured(local, snapshot);
    expect(out).toHaveLength(3);
    expect(out.map(e => e.eventId).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('snapshot wins on conflicting eventId', () => {
    const local = [
      { kind: 'command', eventId: 'e1', status: 'running', command: 'local' },
    ] as VibeCodingRun['structuredEvents'];
    const snapshot = [
      { kind: 'command', eventId: 'e1', status: 'completed', exitCode: 0 },
    ] as VibeCodingRun['structuredEvents'];
    const out = reconcileStructured(local, snapshot);
    expect(out).toHaveLength(1);
    const ev = out[0];
    if (ev.kind !== 'command') throw new Error('expected command');
    expect(ev.status).toBe('completed');
    expect(ev.exitCode).toBe(0);
  });

  it('preserves local events absent from the snapshot', () => {
    const local = [
      { kind: 'command', eventId: 'e1', status: 'running' },
      { kind: 'thinking', eventId: 'e2', active: false, chars: 9 },
    ] as VibeCodingRun['structuredEvents'];
    const snapshot = [] as VibeCodingRun['structuredEvents'];
    const out = reconcileStructured(local, snapshot);
    expect(out).toHaveLength(2);
    expect(out.map(e => e.eventId).sort()).toEqual(['e1', 'e2']);
  });
});

describe('structuredEvents hard-floor cap', () => {
  const commandAt = (n: number): PlatformTransportEvent => ({
    type: 'ai.command',
    sessionId: 's1',
    messageId: 'm1',
    itemId: `i${n}`,
    status: 'running',
    command: `cmd ${n}`,
    eventId: `e${n}`,
    raw: {},
  });

  it('applyStructuredEvent caps resident events, keeping the newest', () => {
    let run = makeRun();
    // STRUCTURED_EVENTS_CAP is 200; feed 205 distinct events.
    for (let i = 0; i < 205; i++) {
      run = applyStructuredEvent(run, commandAt(i));
    }
    expect(run.structuredEvents).toHaveLength(200);
    const ids = run.structuredEvents.map(e => e.eventId);
    // Oldest 5 dropped (ring-buffer keeps newest), newest retained.
    expect(ids).not.toContain('e0');
    expect(ids).not.toContain('e4');
    expect(ids).toContain('e5');
    expect(ids).toContain('e204');
  });

  it('reconcileStructured re-caps the union so a large snapshot stays bounded', () => {
    const local = Array.from({ length: 205 }, (_, i) => ({
      kind: 'command' as const,
      eventId: `e${i}`,
      status: 'running',
    })) as unknown as VibeCodingRun['structuredEvents'];
    const out = reconcileStructured(local, []);
    expect(out).toHaveLength(200);
    expect(out.map(e => e.eventId)).toContain('e204');
    expect(out.map(e => e.eventId)).not.toContain('e0');
  });
});

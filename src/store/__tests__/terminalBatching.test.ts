import { applyOutputToSession } from '../controlCenterStore';
import {
  cancelTerminalBatch,
  flushTerminalOutput,
  pushTerminalOutput,
  registerTerminalOutputApplier,
  type TerminalOutputBatchItem,
} from '../terminalBatching';
import type { ControlCenterState } from '../types';

type TerminalSession = ControlCenterState['terminalSessions'][number];

// Minimal terminal-session mock — only `lines`/`id` are touched. Cast through
// unknown so we don't materialize the full literal.
const makeSession = (
  over: Partial<TerminalSession> & { id: string },
): TerminalSession =>
  ({
    lines: [],
    ...over,
  }) as unknown as TerminalSession;

describe('applyOutputToSession', () => {
  it('appends a text line and returns a NEW session', () => {
    const session = makeSession({ id: 't1' });
    const next = applyOutputToSession(session, 'hello\n', 'text');
    expect(next).not.toBe(session);
    expect(next.lines.map(l => l.content)).toContain('hello');
  });

  it('returns the SAME reference for a no-op payload', () => {
    const session = makeSession({ id: 't1' });
    // Empty payload produces no new lines and isn't a screen replace.
    expect(applyOutputToSession(session, '', 'text')).toBe(session);
  });

  it('applies successive outputs in arrival order', () => {
    let session: TerminalSession = makeSession({ id: 't1' });
    session = applyOutputToSession(session, 'one\n', 'text');
    session = applyOutputToSession(session, 'two\n', 'text');
    const contents = session.lines.map(l => l.content);
    expect(contents).toEqual(expect.arrayContaining(['one', 'two']));
    expect(contents.indexOf('one')).toBeLessThan(contents.indexOf('two'));
  });
});

describe('terminalBatching', () => {
  afterEach(() => {
    cancelTerminalBatch();
  });

  it('coalesces multiple pushes into one applier call, in arrival order', () => {
    const calls: TerminalOutputBatchItem[][] = [];
    registerTerminalOutputApplier(items => {
      calls.push(items);
    });
    pushTerminalOutput({ sessionId: 't1', data: 'a\n', encoding: 'text' });
    pushTerminalOutput({ sessionId: 't1', data: 'b\n', encoding: 'text' });
    pushTerminalOutput({ sessionId: 't2', data: 'c\n', encoding: 'text' });
    flushTerminalOutput();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(3);
    expect(calls[0].map(item => item.sessionId)).toEqual(['t1', 't1', 't2']);
  });

  it('flush is a no-op when nothing is buffered', () => {
    let called = 0;
    registerTerminalOutputApplier(() => {
      called += 1;
    });
    flushTerminalOutput();
    expect(called).toBe(0);
  });

  it('cancel drops buffered items and clears the pending flush', () => {
    let called = 0;
    registerTerminalOutputApplier(() => {
      called += 1;
    });
    pushTerminalOutput({ sessionId: 't1', data: 'a\n', encoding: 'text' });
    cancelTerminalBatch();
    flushTerminalOutput();
    expect(called).toBe(0);
  });
});

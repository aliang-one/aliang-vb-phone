import { applyDeltasToRuns, type DeltaUpdate } from '../src/utils/deltaBatch';
import type { VibeCodingRun } from '../src/data/platformModels';

const run = (
  id: string,
  transcript: VibeCodingRun['transcript'] = [],
  extra: Partial<VibeCodingRun> = {},
): VibeCodingRun => ({
  id,
  title: `run-${id}`,
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/proj',
  status: 'running',
  objective: '',
  model: 'Claude Code',
  timeLimitMinutes: 60,
  elapsedMinutes: 0,
  risk: 'medium',
  currentStep: '',
  branch: 'main',
  lastActivityMs: 0,
  updatedAt: '',
  suggestions: [],
  transcript,
  events: [],
  ...extra,
});

const delta = (
  sessionId: string,
  deltaText: string,
  messageId = 'msg-A',
  currentStep?: string,
): DeltaUpdate => ({ sessionId, delta: deltaText, messageId, currentStep });

const makeId = () => 'generated-id';
const nowLabel = () => '10:00:00';

describe('applyDeltasToRuns', () => {
  it('concatenates deltas for the same trailing assistant message into one update', () => {
    const base = run('s1', [
      { id: 'msg-A', role: 'assistant', content: 'Hello', timestamp: '09:59' },
    ]);

    const next = applyDeltasToRuns(
      [base],
      [
        delta('s1', ' world', 'msg-A'),
        delta('s1', '!', 'msg-A'),
        delta('s1', ' How are you?', 'msg-A'),
      ],
      makeId,
      nowLabel,
    );

    expect(next[0].transcript).toHaveLength(1);
    expect(next[0].transcript[0].content).toBe('Hello world! How are you?');
    expect(next[0].transcriptCount).toBe(1);
    expect(next[0].lastMessage?.content).toBe('Hello world! How are you?');
  });

  it('starts a new assistant message when the messageId does not match the trailing one', () => {
    const base = run('s1', [
      { id: 'msg-A', role: 'assistant', content: 'Hello', timestamp: '09:59' },
    ]);

    const next = applyDeltasToRuns([base], [delta('s1', 'Second answer', 'msg-B')], makeId, nowLabel);

    expect(next[0].transcript).toHaveLength(2);
    expect(next[0].transcript[1].content).toBe('Second answer');
    expect(next[0].transcript[1].id).toBe('msg-B');
  });

  it('does not append a new answer to an older assistant after a user follow-up', () => {
    const base = run('s1', [
      { id: 'msg-A', role: 'assistant', content: 'Old answer', timestamp: '09:58' },
      { id: 'msg-user', role: 'user', content: 'Follow-up', timestamp: '09:59' },
    ]);

    const next = applyDeltasToRuns(
      [base],
      [{ sessionId: 's1', delta: 'New answer' }],
      makeId,
      nowLabel,
    );

    expect(next[0].transcript.map(item => item.content)).toEqual([
      'Old answer',
      'Follow-up',
      'New answer',
    ]);
    expect(next[0].transcript[2]).toMatchObject({
      id: 'generated-id',
      role: 'assistant',
    });
  });

  it('keeps assistant deltas separate when they reuse the user message id', () => {
    const base = run('s1', [
      { id: 'msg-user', role: 'user', content: 'Please help', timestamp: '09:59' },
    ]);

    const next = applyDeltasToRuns(
      [base],
      [
        delta('s1', 'Assistant ', 'msg-user'),
        delta('s1', 'reply', 'msg-user'),
      ],
      makeId,
      nowLabel,
    );

    expect(next[0].transcript).toHaveLength(2);
    expect(next[0].transcript[0].id).toBe('msg-user');
    expect(next[0].transcript[1]).toMatchObject({
      id: 'msg-user:assistant',
      role: 'assistant',
      content: 'Assistant reply',
    });
  });

  it('applies a mixed batch in arrival order across message boundaries', () => {
    const base = run('s1', [
      { id: 'msg-A', role: 'assistant', content: 'A', timestamp: '09:59' },
    ]);

    const next = applyDeltasToRuns(
      [base],
      [
        delta('s1', '-1', 'msg-A'),
        delta('s1', '-2', 'msg-A'),
        delta('s1', 'B-start', 'msg-B'),
        delta('s1', 'B-end', 'msg-B'),
      ],
      makeId,
      nowLabel,
    );

    expect(next[0].transcript.map(item => item.content)).toEqual([
      'A-1-2',
      'B-startB-end',
    ]);
  });

  it('keeps the original array reference for runs that received no deltas', () => {
    const untouched = run('s2', [
      { id: 'msg-X', role: 'assistant', content: 'untouched', timestamp: '09:59' },
    ]);
    const touched = run('s1', [
      { id: 'msg-A', role: 'assistant', content: 'A', timestamp: '09:59' },
    ]);

    const [nextTouched, nextUntouched] = applyDeltasToRuns(
      [touched, untouched],
      [delta('s1', '+', 'msg-A')],
      makeId,
      nowLabel,
    );

    expect(nextUntouched).toBe(untouched);
    expect(nextTouched).not.toBe(touched);
  });

  it('returns the input array untouched when there are no deltas', () => {
    const base = run('s1');
    const input = [base];
    const result = applyDeltasToRuns(input, [], makeId, nowLabel);
    expect(result).toBe(input);
    expect(result[0]).toBe(base);
  });

  it('takes the last non-empty currentStep across the batch', () => {
    const base = run('s1', [
      { id: 'msg-A', role: 'assistant', content: 'A', timestamp: '09:59' },
    ]);

    const next = applyDeltasToRuns(
      [base],
      [
        delta('s1', 'x', 'msg-A', 'Step one'),
        delta('s1', 'y', 'msg-A', 'Step two'),
      ],
      makeId,
      nowLabel,
    );

    expect(next[0].currentStep).toBe('Step two');
    expect(next[0].status).toBe('running');
  });

  it('drops deltas for sessions that no longer exist', () => {
    const base = run('s1');
    const next = applyDeltasToRuns([base], [delta('gone', 'x', 'msg-A')], makeId, nowLabel);
    expect(next[0].transcript).toHaveLength(0);
    expect(next).toHaveLength(1);
  });
});

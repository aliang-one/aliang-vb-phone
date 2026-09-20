import {
  countTrailingActiveActivityGroups,
  groupConsecutiveToolMessageIds,
} from '../activityGrouping';

const user = (id: string, content: string) => ({ id, role: 'user' as const, content });
const assistant = (id: string, content = '') => ({
  id,
  role: 'assistant' as const,
  content,
});

describe('groupConsecutiveToolMessageIds', () => {
  it('groups adjacent tool-only assistant messages', () => {
    expect(
      groupConsecutiveToolMessageIds(
        [user('u1', 'run'), assistant('a1'), assistant('a2'), assistant('a3')],
        ['a1', 'a2', 'a3'],
      ),
    ).toEqual([['a1', 'a2', 'a3']]);
  });

  it('does not split a run on system tool output', () => {
    expect(
      groupConsecutiveToolMessageIds(
        [
          assistant('a1'),
          { id: 'tool-output', role: 'system' as const, content: 'done' },
          assistant('a2'),
        ],
        ['a1', 'a2'],
      ),
    ).toEqual([['a1', 'a2']]);
  });

  it('splits at user messages and assistant prose', () => {
    expect(
      groupConsecutiveToolMessageIds(
        [
          assistant('a1'),
          assistant('a2'),
          user('u2', 'next turn'),
          assistant('a3'),
          assistant('a4', 'answer'),
          assistant('a5'),
        ],
        ['a1', 'a2', 'a3', 'a5'],
      ),
    ).toEqual([['a1', 'a2'], ['a3'], ['a5']]);
  });

  it('bounds recovered ids missing from the loaded transcript', () => {
    expect(
      groupConsecutiveToolMessageIds(
        [assistant('a1')],
        ['a1', 'old-a2', 'old-a3', 'old-a4'],
        { maxMessageIdsPerGroup: 2 },
      ),
    ).toEqual([['a1'], ['old-a2', 'old-a3'], ['old-a4']]);
  });

  it('uses event volume as a second recovery boundary', () => {
    expect(
      groupConsecutiveToolMessageIds(
        [],
        ['old-a1', 'old-a2', 'old-a3'],
        {
          maxEventsPerGroup: 5,
          eventCountByMessageId: new Map([
            ['old-a1', 3],
            ['old-a2', 2],
            ['old-a3', 1],
          ]),
        },
      ),
    ).toEqual([['old-a1', 'old-a2'], ['old-a3']]);
  });
});

describe('countTrailingActiveActivityGroups', () => {
  const command = (messageId: string, status: string) => ({
    kind: 'command' as const,
    eventId: `${messageId}:cmd`,
    messageId,
    itemId: '',
    status,
    command: 'ls',
  });
  const thinking = (messageId: string, active: boolean) => ({
    kind: 'thinking' as const,
    eventId: `${messageId}:think`,
    messageId,
    active,
    chars: 0,
  });
  const usage = (messageId: string) => ({
    kind: 'usage' as const,
    eventId: `${messageId}:usage`,
    messageId,
    inputTokens: 1,
    outputTokens: 1,
  });
  const eventsFor = (...entries: [string, unknown[]][]) =>
    new Map(entries as [string, never[]][]);

  it('returns 0 when there are no orphan groups', () => {
    expect(countTrailingActiveActivityGroups([], new Map())).toBe(0);
  });

  it('returns 0 when the newest group is fully settled', () => {
    const events = eventsFor(
      ['a1', [command('a1', 'completed'), usage('a1')]],
      ['a2', [command('a2', 'completed'), usage('a2')]],
    );
    expect(
      countTrailingActiveActivityGroups([['a1'], ['a2']], events),
    ).toBe(0);
  });

  it('returns 1 when the newest group has an in-flight command', () => {
    const events = eventsFor(
      ['a1', [command('a1', 'completed')]],
      ['a2', [command('a2', 'started')]],
    );
    expect(
      countTrailingActiveActivityGroups([['a1'], ['a2']], events),
    ).toBe(1);
  });

  it('returns 1 when the newest group has active thinking', () => {
    const events = eventsFor(['a9', [thinking('a9', true)]]);
    expect(countTrailingActiveActivityGroups([['a9']], events)).toBe(1);
  });

  it('ignores stale in-flight activity in older groups', () => {
    const events = eventsFor(
      ['old', [command('old', 'started')]],
      ['a2', [command('a2', 'completed')]],
    );
    expect(
      countTrailingActiveActivityGroups([['old'], ['a2']], events),
    ).toBe(0);
  });

  it('returns 0 when the newest group only carries usage events', () => {
    const events = eventsFor(['a1', [usage('a1')]]);
    expect(countTrailingActiveActivityGroups([['a1']], events)).toBe(0);
  });
});

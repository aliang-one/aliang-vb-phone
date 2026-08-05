import { groupConsecutiveToolMessageIds } from '../activityGrouping';

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

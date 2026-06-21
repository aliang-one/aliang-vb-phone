import type { StructuredActivityEvent } from '../../data/platformModels';
import { summarizeActivity } from '../activitySummary';

const cmd = (
  overrides: Partial<
    Extract<StructuredActivityEvent, { kind: 'command' }>
  > = {},
): StructuredActivityEvent => ({
  kind: 'command',
  eventId: 'cmd-1',
  messageId: 'm1',
  itemId: 'i1',
  status: 'started',
  command: 'npm test',
  ...overrides,
});

const fileChange = (
  overrides: Partial<
    Extract<StructuredActivityEvent, { kind: 'file_change' }>
  > = {},
): StructuredActivityEvent => ({
  kind: 'file_change',
  eventId: 'fc-1',
  messageId: 'm1',
  itemId: 'i1',
  path: 'src/index.ts',
  changeKind: 'edit',
  ...overrides,
});

const thinking = (
  overrides: Partial<
    Extract<StructuredActivityEvent, { kind: 'thinking' }>
  > = {},
): StructuredActivityEvent => ({
  kind: 'thinking',
  eventId: 'th-1',
  messageId: 'm1',
  active: false,
  chars: 0,
  ...overrides,
});

const usage = (
  overrides: Partial<
    Extract<StructuredActivityEvent, { kind: 'usage' }>
  > = {},
): StructuredActivityEvent => ({
  kind: 'usage',
  eventId: 'us-1',
  inputTokens: 100,
  outputTokens: 50,
  ...overrides,
});

const task = (
  overrides: Partial<
    Extract<StructuredActivityEvent, { kind: 'task' }>
  > = {},
): StructuredActivityEvent => ({
  kind: 'task',
  eventId: 'tk-1',
  messageId: 'm1',
  tasks: [
    { subject: 'Write tests', status: 'completed' },
    { subject: 'Running tests', status: 'in_progress' },
    { subject: 'Pending task', status: 'pending' },
  ],
  ...overrides,
});

describe('summarizeActivity', () => {
  it('returns null for an empty group', () => {
    expect(summarizeActivity([])).toBeNull();
  });

  describe('headline priority', () => {
    it('active thinking wins and includes formatted chars (1200 -> 1.2k)', () => {
      const events: StructuredActivityEvent[] = [
        cmd({ status: 'started', command: 'npm test' }),
        fileChange(),
        thinking({ active: true, chars: 1200 }),
      ];
      const summary = summarizeActivity(events);
      expect(summary?.headline).toBe('🧠 思考中…(1.2k)');
      expect(summary?.hasActive).toBe(true);
    });

    it('active thinking with zero chars omits the parenthetical', () => {
      const summary = summarizeActivity([thinking({ active: true, chars: 0 })]);
      expect(summary?.headline).toBe('🧠 思考中…');
    });

    it('uses last thinking event for chars when multiple present', () => {
      const summary = summarizeActivity([
        thinking({ active: true, chars: 500 }),
        thinking({ active: true, chars: 2500 }),
      ]);
      // 2500 -> 2.5k (last event)
      expect(summary?.headline).toBe('🧠 思考中…(2.5k)');
    });

    it('open command wins when no active thinking', () => {
      const summary = summarizeActivity([
        fileChange(),
        cmd({ status: 'started', command: 'npm test' }),
      ]);
      expect(summary?.headline).toBe('⚙ npm test');
      expect(summary?.hasActive).toBe(true);
    });

    it('open command falls back to "运行命令" when command missing', () => {
      const summary = summarizeActivity([cmd({ status: 'started', command: undefined })]);
      expect(summary?.headline).toBe('⚙ 运行命令');
    });

    it('files win when no active thinking and no open command', () => {
      const summary = summarizeActivity([
        cmd({ status: 'completed' }),
        fileChange(),
        fileChange(),
      ]);
      expect(summary?.headline).toBe('📝 编辑 2 个文件');
    });

    it('completed (no active, no files) -> "已完成"', () => {
      const summary = summarizeActivity([cmd({ status: 'completed' })]);
      expect(summary?.headline).toBe('已完成');
      expect(summary?.hasActive).toBe(false);
    });
  });

  describe('counts', () => {
    it('counts files and commands by discriminant kind', () => {
      const summary = summarizeActivity([
        cmd({ status: 'completed' }),
        cmd({ status: 'completed', eventId: 'cmd-2' }),
        fileChange(),
        fileChange({ eventId: 'fc-2' }),
        fileChange({ eventId: 'fc-3' }),
      ]);
      expect(summary?.commandCount).toBe(2);
      expect(summary?.fileCount).toBe(3);
    });

    it('counts task done/total from the first task event', () => {
      const summary = summarizeActivity([task()]);
      expect(summary?.taskTotal).toBe(3);
      expect(summary?.taskDone).toBe(1);
    });

    it('exposes the in_progress task subject as taskCurrent', () => {
      const summary = summarizeActivity([task()]);
      expect(summary?.taskCurrent).toBe('Running tests');
    });

    it('taskCurrent is undefined when no in_progress task', () => {
      const summary = summarizeActivity([
        task({
          tasks: [
            { subject: 'done one', status: 'completed' },
            { subject: 'pending one', status: 'pending' },
          ],
        }),
      ]);
      expect(summary?.taskCurrent).toBeUndefined();
    });

    it('taskDone/Total are 0 when no task event present', () => {
      const summary = summarizeActivity([cmd({ status: 'completed' })]);
      expect(summary?.taskDone).toBe(0);
      expect(summary?.taskTotal).toBe(0);
      expect(summary?.taskCurrent).toBeUndefined();
    });

    it('usageTokens = input+output of the last usage event', () => {
      const summary = summarizeActivity([
        usage({ inputTokens: 10, outputTokens: 5, eventId: 'us-1' }),
        usage({ inputTokens: 200, outputTokens: 50, eventId: 'us-2' }),
      ]);
      // last = 200 + 50 = 250
      expect(summary?.usageTokens).toBe(250);
    });

    it('usageTokens is undefined when 0 / absent', () => {
      const summary = summarizeActivity([
        usage({ inputTokens: 0, outputTokens: 0 }),
      ]);
      expect(summary?.usageTokens).toBeUndefined();
    });

    it('usageTokens is undefined when no usage event', () => {
      const summary = summarizeActivity([cmd({ status: 'completed' })]);
      expect(summary?.usageTokens).toBeUndefined();
    });
  });

  describe('hasActive', () => {
    it('true when only an open command (no thinking)', () => {
      const summary = summarizeActivity([cmd({ status: 'started' })]);
      expect(summary?.hasActive).toBe(true);
    });

    it('false for interrupted command with nothing else active', () => {
      const summary = summarizeActivity([cmd({ status: 'interrupted' })]);
      expect(summary?.hasActive).toBe(false);
    });
  });
});

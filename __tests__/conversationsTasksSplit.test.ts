/**
 * 对话/任务分离：
 * - 对话列表(useSessionListRuns 的合并纯函数)不包含 purpose==='goal' 的会话；
 * - Tasks 入口(organizeGoalRows)非终态在前、历史在后、deleted 丢弃。
 */
import { mergeSessionListRuns } from '../src/store/controlCenterStore';
import { organizeGoalRows } from '../src/screens/vibecoding/GoalInboxScreen';
import type { VibeCodingRun } from '../src/data/platformModels';

const run = (over: Partial<VibeCodingRun> & { id: string }): VibeCodingRun =>
  ({
    deviceId: 'd1',
    projectId: 'p1',
    status: 'completed',
    title: over.id,
    lastActivityMs: 0,
    transcript: [],
    events: [],
    structuredEvents: [],
    ...over,
  }) as unknown as VibeCodingRun;

describe('对话列表过滤 goal', () => {
  it('excludes goal sessions from both live and history sources', () => {
    const merged = mergeSessionListRuns(
      [
        run({ id: 'live_chat' }),
        run({ id: 'live_goal', purpose: 'goal' }),
      ],
      [
        run({ id: 'hist_chat' }),
        run({ id: 'hist_goal', purpose: 'goal' }),
      ],
    );
    expect(merged.map(item => item.id)).toEqual(['live_chat', 'hist_chat']);
  });

  it('history cannot shadow a live session with the same id', () => {
    const merged = mergeSessionListRuns(
      [run({ id: 's1', title: 'live' })],
      [run({ id: 's1', title: 'history' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('live');
  });
});

describe('organizeGoalRows', () => {
  const row = (over: Partial<Parameters<typeof organizeGoalRows>[0][number]>) =>
    over as Parameters<typeof organizeGoalRows>[0][number];

  it('puts non-terminal goals first, then history, newest first', () => {
    const ordered = organizeGoalRows([
      row({ goal_id: 'old_active', state: 'active', updated_at: '2026-08-01T00:00:00Z' }),
      row({ goal_id: 'done_new', state: 'completed', updated_at: '2026-10-01T00:00:00Z' }),
      row({ goal_id: 'active_new', state: 'active', updated_at: '2026-09-30T00:00:00Z' }),
      row({ goal_id: 'cancelled', state: 'cancelled', updated_at: '2026-09-15T00:00:00Z' }),
    ]);
    expect(ordered.map(item => item.goal_id)).toEqual([
      'active_new',
      'old_active',
      'done_new',
      'cancelled',
    ]);
  });

  it('drops deleted goals', () => {
    const ordered = organizeGoalRows([
      row({ goal_id: 'gone', state: 'active', deleted_at: '2026-09-30T00:00:00Z' }),
      row({ goal_id: 'kept', state: 'active', updated_at: '2026-09-30T00:00:00Z' }),
    ]);
    expect(ordered.map(item => item.goal_id)).toEqual(['kept']);
  });
});

import { buildTabs } from '../src/utils/vibeTabs';

describe('buildTabs', () => {
  it('shows two tabs without task data', () => {
    expect(buildTabs(false).map(tab => tab.key)).toEqual([
      'vibecoding',
      'terminals',
    ]);
  });
  it('inserts Tasks between them when task data exists', () => {
    expect(buildTabs(true).map(tab => tab.key)).toEqual([
      'vibecoding',
      'tasks',
      'terminals',
    ]);
  });
});

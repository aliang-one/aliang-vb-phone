import { collectFileChanges, sessionsForProject, latestSessionForProject, changeReviewCount, pickChangesWithDiff } from './sessionChanges';
import type { StructuredActivityEvent, VibeCodingRun } from '../../data/platformModels';
import type { SessionFileChange } from './sessionChanges';

function makeRun(
  o: Partial<VibeCodingRun> & Pick<VibeCodingRun, 'id' | 'projectId' | 'lastActivityMs'>,
): VibeCodingRun {
  return {
    title: 't',
    deviceId: 'd',
    directory: '/p',
    status: 'idle',
    objective: '',
    model: 'm',
    risk: 'low',
    currentStep: '',
    branch: '',
    updatedAt: '',
    structuredEvents: [],
    suggestions: [],
    transcript: [],
    events: [],
    ...o,
  } as VibeCodingRun;
}

describe('collectFileChanges', () => {
  test('只收 file_change；同 path 取最后一次数据，位置按首次出现顺序', () => {
    const events: StructuredActivityEvent[] = [
      { kind: 'command', eventId: 'e1', messageId: 'm1', itemId: 'i1', status: 'completed', command: 'ls' },
      { kind: 'file_change', eventId: 'e2', messageId: 'm2', itemId: 'i2', path: 'a.ts', changeKind: 'create', added: 10, removed: 0 },
      { kind: 'thinking', eventId: 'e3', messageId: 'm3', active: true, chars: 5 },
      { kind: 'file_change', eventId: 'e4', messageId: 'm4', itemId: 'i4', path: 'b.ts', changeKind: 'edit', added: 2, removed: 1 },
      { kind: 'file_change', eventId: 'e5', messageId: 'm5', itemId: 'i5', path: 'a.ts', changeKind: 'edit', added: 3, removed: 2 },
    ];

    const result = collectFileChanges(events);

    expect(result).toEqual([
      { path: 'a.ts', changeKind: 'edit', added: 3, removed: 2, eventId: 'e5', messageId: 'm5', itemId: 'i5' },
      { path: 'b.ts', changeKind: 'edit', added: 2, removed: 1, eventId: 'e4', messageId: 'm4', itemId: 'i4' },
    ]);
  });

  test('空事件列表返回 []', () => {
    expect(collectFileChanges([])).toEqual([]);
  });

  test('跳过没有 path 的 file_change 事件', () => {
    const events: StructuredActivityEvent[] = [
      { kind: 'file_change', eventId: 'e1', messageId: 'm1', itemId: 'i1', path: '', changeKind: 'edit', added: 1, removed: 0 },
      { kind: 'file_change', eventId: 'e2', messageId: 'm2', itemId: 'i2', changeKind: 'edit', added: 2, removed: 0 },
    ];
    expect(collectFileChanges(events)).toEqual([]);
  });

  test('保留 renamedFrom', () => {
    const events: StructuredActivityEvent[] = [
      { kind: 'file_change', eventId: 'e1', messageId: 'm1', itemId: 'i1', path: 'new.ts', changeKind: 'edit', renamedFrom: 'old.ts' },
    ];
    expect(collectFileChanges(events)).toEqual([
      { path: 'new.ts', changeKind: 'edit', renamedFrom: 'old.ts', eventId: 'e1', messageId: 'm1', itemId: 'i1' },
    ]);
  });
});

describe('sessionsForProject', () => {
  test('按 projectId 过滤，lastActivityMs 倒序（最新在前）', () => {
    const runs = [
      makeRun({ id: 'old', projectId: 'P', lastActivityMs: 100 }),
      makeRun({ id: 'newest', projectId: 'P', lastActivityMs: 900 }),
      makeRun({ id: 'mid', projectId: 'P', lastActivityMs: 500 }),
      makeRun({ id: 'other', projectId: 'Q', lastActivityMs: 9999 }),
    ];
    expect(sessionsForProject(runs, 'P').map(r => r.id)).toEqual(['newest', 'mid', 'old']);
  });

  test('无匹配返回 []', () => {
    expect(sessionsForProject([makeRun({ id: 'a', projectId: 'P', lastActivityMs: 1 })], 'Z')).toEqual([]);
  });
});

describe('latestSessionForProject', () => {
  test('返回最新的匹配会话', () => {
    const runs = [
      makeRun({ id: 'a', projectId: 'P', lastActivityMs: 100 }),
      makeRun({ id: 'b', projectId: 'P', lastActivityMs: 900 }),
    ];
    expect(latestSessionForProject(runs, 'P')?.id).toBe('b');
  });

  test('无匹配返回 undefined', () => {
    expect(latestSessionForProject([], 'P')).toBeUndefined();
  });
});

describe('changeReviewCount', () => {
  // 关键 bug 修复：列表快照不带 structured_events,所以 banner 的显隐/计数必须
  // 用列表里就有的 resident filesTouchedCount,不能依赖 structuredEvents。
  test('undefined 会话 → 0', () => {
    expect(changeReviewCount(undefined)).toBe(0);
  });

  test('用 resident filesTouchedCount,即使 structuredEvents 为空(列表快照场景)', () => {
    const run = makeRun({ id: 's', projectId: 'P', lastActivityMs: 1, filesTouchedCount: 5 });
    expect(changeReviewCount(run)).toBe(5);
  });

  test('filesTouchedCount 缺失时回退到 structuredEvents 长度(已水合时)', () => {
    const run = makeRun({
      id: 's',
      projectId: 'P',
      lastActivityMs: 1,
      structuredEvents: [
        { kind: 'file_change', eventId: 'e1', messageId: 'm1', itemId: 'i1', path: 'a.ts', changeKind: 'edit' },
        { kind: 'file_change', eventId: 'e2', messageId: 'm2', itemId: 'i2', path: 'b.ts', changeKind: 'create' },
      ],
    });
    expect(changeReviewCount(run)).toBe(2);
  });

  test('filesTouchedCount 优先于 structuredEvents', () => {
    const run = makeRun({
      id: 's',
      projectId: 'P',
      lastActivityMs: 1,
      filesTouchedCount: 3,
      structuredEvents: [
        { kind: 'file_change', eventId: 'e1', messageId: 'm1', itemId: 'i1', path: 'a.ts' },
      ],
    });
    expect(changeReviewCount(run)).toBe(3);
  });

  test('session.gitChangedCount 最优先（列表快照常带的字段）', () => {
    const run = makeRun({
      id: 's',
      projectId: 'P',
      lastActivityMs: 1,
      gitChangedCount: 7,
      filesTouchedCount: 5,
      structuredEvents: [
        { kind: 'file_change', eventId: 'e1', messageId: 'm1', itemId: 'i1', path: 'a.ts' },
      ],
    });
    expect(changeReviewCount(run)).toBe(7);
  });
});

describe('pickChangesWithDiff', () => {
  const fc = (path: string, eventId: string): SessionFileChange => ({
    path,
    eventId,
    messageId: 'm',
    itemId: 'i',
  });
  type Detail = { text?: string; truncated: boolean };

  it('只保留 detail.text 非空的 file_change，保持顺序', () => {
    const results: Array<{ fc: SessionFileChange; detail: Detail } | null> = [
      { fc: fc('a.ts', 'e1'), detail: { text: '@@ diff a', truncated: false } },
      { fc: fc('b.ts', 'e2'), detail: { text: undefined, truncated: false } }, // 无 diff → 丢
      null, // 拉取失败 → 丢
      { fc: fc('c.ts', 'e3'), detail: { text: '', truncated: false } }, // 空串 → 丢
      { fc: fc('d.ts', 'e4'), detail: { text: '@@ diff d', truncated: true } }, // 截断也算有 diff
    ];
    expect(pickChangesWithDiff(results).map(c => c.path)).toEqual(['a.ts', 'd.ts']);
  });

  it('全空 → []', () => {
    expect(pickChangesWithDiff([])).toEqual([]);
    expect(pickChangesWithDiff([null, null])).toEqual([]);
  });
});

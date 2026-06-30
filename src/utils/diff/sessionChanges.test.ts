import { collectFileChanges, sessionsForProject, latestSessionForProject } from './sessionChanges';
import type { StructuredActivityEvent, VibeCodingRun } from '../../data/platformModels';

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

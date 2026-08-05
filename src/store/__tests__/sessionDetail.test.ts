import {
  shouldEscalateEmptyDetailToRefresh,
  resolveDetailState,
  isAuthoritativeDetail,
  mergeDetailState,
} from '../sessionDetail';

describe('shouldEscalateEmptyDetailToRefresh', () => {
  const escalate = (over: Partial<{
    transcriptLength: number;
    transcriptCount: number;
    detailRefreshStatus: string | undefined;
    purpose: 'chat' | 'goal' | undefined;
    isManualRefresh: boolean;
  }>) =>
    shouldEscalateEmptyDetailToRefresh({
      transcriptLength: 0,
      transcriptCount: 3,
      detailRefreshStatus: 'fresh',
      purpose: 'chat',
      isManualRefresh: false,
      ...over,
    });

  it('空 transcript + 已知历史(transcriptCount>0)+ fresh + chat + 非手动 → 升级', () => {
    expect(escalate({})).toBe(true);
  });

  it('cache_miss / cached / cached_partial / undefined 状态同样升级(只要空+有历史)', () => {
    for (const status of ['cache_miss', 'cached', 'cached_partial', undefined]) {
      expect(escalate({ detailRefreshStatus: status })).toBe(true);
    }
  });

  it('手动刷新(refresh:true)→ 不重复升级', () => {
    expect(escalate({ isManualRefresh: true })).toBe(false);
  });

  it('goal 会话 → 不升级(服务端账本持有历史)', () => {
    expect(escalate({ purpose: 'goal' })).toBe(false);
  });

  it('server_owned 状态 → 不升级', () => {
    expect(escalate({ detailRefreshStatus: 'server_owned' })).toBe(false);
  });

  it('failed 状态 → 不升级(走 recoverable 路径,不掩盖真实状态)', () => {
    expect(escalate({ detailRefreshStatus: 'failed' })).toBe(false);
  });

  it('skipped_offline 状态 → 不升级(设备离线,强刷无意义)', () => {
    expect(escalate({ detailRefreshStatus: 'skipped_offline' })).toBe(false);
  });

  it('非空 transcript → 不升级(已拿到内容,无需补救)', () => {
    expect(escalate({ transcriptLength: 5 })).toBe(false);
  });

  it('真实空会话(transcriptCount=0)→ 不升级(确实没历史)', () => {
    expect(escalate({ transcriptCount: 0 })).toBe(false);
  });
});

describe('resolveDetailState — 解析优先级(返回 DetailState 对象)', () => {
  it('有 transcript 内容 → ready(压过一切状态)', () => {
    expect(
      resolveDetailState({
        transcriptLength: 2,
        transcriptCount: 5,
        detailRefreshStatus: 'failed',
      }),
    ).toEqual({ kind: 'ready' });
    expect(
      resolveDetailState({ transcriptLength: 1, transcriptCount: 0, detailRefreshStatus: undefined }),
    ).toEqual({ kind: 'ready' });
  });

  it('空 + skipped_offline → offline(压过 recoverable_empty)', () => {
    expect(
      resolveDetailState({
        transcriptLength: 0,
        transcriptCount: 5,
        detailRefreshStatus: 'skipped_offline',
      }),
    ).toEqual({ kind: 'offline' });
  });

  it('空 + failed → failed(压过 recoverable_empty)', () => {
    expect(
      resolveDetailState({
        transcriptLength: 0,
        transcriptCount: 5,
        detailRefreshStatus: 'failed',
      }),
    ).toEqual({ kind: 'failed' });
  });

  it('空 + 已知历史(transcriptCount>0)+ 非失败/离线 → recoverable_empty', () => {
    expect(
      resolveDetailState({
        transcriptLength: 0,
        transcriptCount: 3,
        detailRefreshStatus: 'fresh',
      }),
    ).toEqual({ kind: 'recoverable_empty' });
    expect(
      resolveDetailState({ transcriptLength: 0, transcriptCount: 1, detailRefreshStatus: 'cache_miss' }),
    ).toEqual({ kind: 'recoverable_empty' });
  });

  it('空 + 无已知历史(count=0)→ empty(真实空会话)', () => {
    expect(
      resolveDetailState({ transcriptLength: 0, transcriptCount: 0, detailRefreshStatus: 'fresh' }),
    ).toEqual({ kind: 'empty' });
    expect(
      resolveDetailState({ transcriptLength: 0, transcriptCount: 0, detailRefreshStatus: undefined }),
    ).toEqual({ kind: 'empty' });
  });
});

describe('isAuthoritativeDetail — 替代旧 Boolean(detailLoadedAt) 的单一谓词', () => {
  it('ready / empty → true(有内容 或 真实空,算 detail-loaded)', () => {
    expect(isAuthoritativeDetail({ kind: 'ready' })).toBe(true);
    expect(isAuthoritativeDetail({ kind: 'empty' })).toBe(true);
  });

  it('recoverable_empty / offline / failed → false(保持可重试,本次 bug 核心)', () => {
    expect(isAuthoritativeDetail({ kind: 'recoverable_empty' })).toBe(false);
    expect(isAuthoritativeDetail({ kind: 'offline' })).toBe(false);
    expect(isAuthoritativeDetail({ kind: 'failed' })).toBe(false);
  });

  it('undefined(从未拉取)→ false', () => {
    expect(isAuthoritativeDetail(undefined)).toBe(false);
  });
});

describe('mergeDetailState — 权威 incoming 覆盖,非权威保留 existing', () => {
  it('权威 incoming(ready/empty)→ 覆盖 existing', () => {
    expect(mergeDetailState({ kind: 'ready' }, { kind: 'empty' })).toEqual({ kind: 'ready' });
    expect(mergeDetailState({ kind: 'empty' }, { kind: 'ready' })).toEqual({ kind: 'empty' });
  });

  it('非权威 incoming(recoverable_empty/offline/failed)→ 保留 existing(不擦内容)', () => {
    expect(mergeDetailState({ kind: 'recoverable_empty' }, { kind: 'ready' })).toEqual({ kind: 'ready' });
    expect(mergeDetailState({ kind: 'offline' }, { kind: 'ready' })).toEqual({ kind: 'ready' });
    expect(mergeDetailState({ kind: 'failed' }, { kind: 'empty' })).toEqual({ kind: 'empty' });
  });

  it('incoming undefined(列表快照)→ 保留 existing', () => {
    expect(mergeDetailState(undefined, { kind: 'ready' })).toEqual({ kind: 'ready' });
  });

  it('两者皆非权威/缺省 → undefined', () => {
    expect(mergeDetailState({ kind: 'recoverable_empty' }, undefined)).toBeUndefined();
    expect(mergeDetailState(undefined, undefined)).toBeUndefined();
  });
});

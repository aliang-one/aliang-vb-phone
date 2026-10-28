import {
  computeHasDetail,
  isDetailFetchUnavailable,
  isRecoverableConversation,
} from '../sessionDetailState';

describe('computeHasDetail (mount auto-load gate)', () => {
  // 2026-10-28 实锤:快照热窗 transcript 不再构成「已加载」——必须先有过一次
  // 真实详情页加载(detailFromPage),否则权威 ai_messages 页永不被拉,
  // 失败会话只显示被截断的热窗(「从半截开始」)。
  it('page-loaded + authoritative ready → true', () => {
    expect(computeHasDetail({ kind: 'ready' }, 0, true)).toBe(true);
  });
  it('page-loaded + authoritative empty → true (definitive empty, no re-fetch)', () => {
    expect(computeHasDetail({ kind: 'empty' }, 0, true)).toBe(true);
  });
  it('page-loaded + recoverable_empty → false (keep re-attempting)', () => {
    expect(computeHasDetail({ kind: 'recoverable_empty' }, 0, true)).toBe(false);
  });
  it('page-loaded + offline / failed(空转录) → false', () => {
    expect(computeHasDetail({ kind: 'offline' }, 0, true)).toBe(false);
    expect(computeHasDetail({ kind: 'failed' }, 0, true)).toBe(false);
  });
  it('page-loaded + failed 但有缓存页 → true(对过账,有内容即不再自动拉)', () => {
    expect(computeHasDetail({ kind: 'failed' }, 5, true)).toBe(true);
  });
  it('未页加载:快照 ready 声明 + 热窗 transcript → false(本缺陷修复)', () => {
    expect(computeHasDetail({ kind: 'ready' }, 3, undefined)).toBe(false);
    expect(computeHasDetail(undefined, 3, undefined)).toBe(false);
  });
  it('未页加载 + 空转录 → false', () => {
    expect(computeHasDetail(undefined, 0, undefined)).toBe(false);
  });
  it('页加载过但确无内容 → false', () => {
    expect(computeHasDetail(undefined, 0, true)).toBe(false);
  });
});

describe('isDetailFetchUnavailable (读 detailState.kind)', () => {
  it('offline / failed → true', () => {
    expect(isDetailFetchUnavailable({ kind: 'failed' })).toBe(true);
    expect(isDetailFetchUnavailable({ kind: 'offline' })).toBe(true);
  });
  it('ready / empty / recoverable_empty / undefined → false', () => {
    expect(isDetailFetchUnavailable({ kind: 'ready' })).toBe(false);
    expect(isDetailFetchUnavailable({ kind: 'empty' })).toBe(false);
    expect(isDetailFetchUnavailable({ kind: 'recoverable_empty' })).toBe(false);
    expect(isDetailFetchUnavailable(undefined)).toBe(false);
  });
});

describe('isRecoverableConversation (self-heal edge trigger)', () => {
  const base = {
    wsConnected: true,
    deviceStatus: 'online',
    transcriptLength: 0,
    detailState: { kind: 'failed' as const },
  };
  it('connected + online + empty + failed → true', () => {
    expect(isRecoverableConversation(base)).toBe(true);
  });
  it('offline status → true', () => {
    expect(isRecoverableConversation({ ...base, detailState: { kind: 'offline' } })).toBe(true);
  });
  it('disconnected → false', () => {
    expect(isRecoverableConversation({ ...base, wsConnected: false })).toBe(false);
  });
  it('device offline → false', () => {
    expect(isRecoverableConversation({ ...base, deviceStatus: 'offline' })).toBe(false);
  });
  it('non-empty transcript → false (already has content)', () => {
    expect(isRecoverableConversation({ ...base, transcriptLength: 2 })).toBe(false);
  });
  it('ready / empty / recoverable_empty → false (非 offline/failed)', () => {
    expect(isRecoverableConversation({ ...base, detailState: { kind: 'ready' } })).toBe(false);
    expect(isRecoverableConversation({ ...base, detailState: { kind: 'empty' } })).toBe(false);
    expect(isRecoverableConversation({ ...base, detailState: { kind: 'recoverable_empty' } })).toBe(false);
  });
});

import {
  computeHasDetail,
  isDetailFetchUnavailable,
  isRecoverableConversation,
} from '../sessionDetailState';

describe('computeHasDetail (mount auto-load gate)', () => {
  it('authoritative ready → true', () => {
    expect(computeHasDetail({ kind: 'ready' }, 0)).toBe(true);
  });
  it('authoritative empty → true (definitive empty, no re-fetch)', () => {
    expect(computeHasDetail({ kind: 'empty' }, 0)).toBe(true);
  });
  it('recoverable_empty → false (keep re-attempting)', () => {
    expect(computeHasDetail({ kind: 'recoverable_empty' }, 0)).toBe(false);
  });
  it('offline / failed → false', () => {
    expect(computeHasDetail({ kind: 'offline' }, 0)).toBe(false);
    expect(computeHasDetail({ kind: 'failed' }, 0)).toBe(false);
  });
  it('undefined detail + hot-window transcript → true', () => {
    expect(computeHasDetail(undefined, 3)).toBe(true);
  });
  it('undefined detail + empty transcript → false (never fetched)', () => {
    expect(computeHasDetail(undefined, 0)).toBe(false);
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

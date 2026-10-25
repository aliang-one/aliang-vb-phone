import { resolveRescanTick } from '../sessionRescan';

const base = {
  polledCount: 3,
  polledIds: ['a', 'b', 'c'],
  polledLatestLastActiveAt: '2026-10-25T00:00:00Z',
  baselineCount: 3,
  baselineIds: ['a', 'b', 'c'],
  baselineLatestLastActiveAt: '2026-10-25T00:00:00Z',
  isFinalTick: false,
};

describe('resolveRescanTick — 重扫到达判定', () => {
  it('无变化:继续轮询', () => {
    expect(resolveRescanTick(base)).toBe('keep-polling');
  });

  it('total_count 增大:停表(有变化)', () => {
    expect(resolveRescanTick({ ...base, polledCount: 4 })).toBe('stop-changed');
  });

  it('出现新 session id:停表', () => {
    expect(
      resolveRescanTick({ ...base, polledIds: ['a', 'b', 'c', 'd'] }),
    ).toBe('stop-changed');
  });

  it('last_active_at 变新(新消息落到旧会话):停表', () => {
    expect(
      resolveRescanTick({
        ...base,
        polledLatestLastActiveAt: '2026-10-25T01:00:00Z',
      }),
    ).toBe('stop-changed');
  });

  it('双方都缺 last_active_at:只看 count/ids,不算变化', () => {
    expect(
      resolveRescanTick({
        ...base,
        polledLatestLastActiveAt: undefined,
        baselineLatestLastActiveAt: undefined,
      }),
    ).toBe('keep-polling');
  });

  it('末拍仍无变化:超时停表', () => {
    expect(resolveRescanTick({ ...base, isFinalTick: true })).toBe(
      'stop-timeout',
    );
  });

  it('数量收缩/ids 变少不是到达:继续轮询', () => {
    expect(
      resolveRescanTick({ ...base, polledCount: 2, polledIds: ['a', 'b'] }),
    ).toBe('keep-polling');
  });

  it('变化优先于末拍:到达而非超时', () => {
    expect(
      resolveRescanTick({ ...base, polledCount: 4, isFinalTick: true }),
    ).toBe('stop-changed');
  });
});

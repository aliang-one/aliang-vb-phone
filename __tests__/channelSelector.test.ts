import {
  pickChannel, domesticPrior, RELAY_WIN_RATIO,
  type ChannelProbe, type EndpointId,
} from '../src/config/channelSelector';

const p = (id: EndpointId, ttfbMs: number | null): ChannelProbe => ({ id, ttfbMs });

describe('pickChannel', () => {
  it('nat0 快 30% 以上 → nat0', () => {
    expect(pickChannel([p('primary', 200), p('nat0', 100)], 'primary')).toBe('nat0');
  });
  it('primary 快 30% 以上 → primary', () => {
    expect(pickChannel([p('primary', 100), p('nat0', 200)], 'nat0')).toBe('primary');
  });
  it('平手 → 地理先验', () => {
    expect(pickChannel([p('primary', 200), p('nat0', 180)], 'nat0')).toBe('nat0');
    expect(pickChannel([p('primary', 200), p('nat0', 180)], 'primary')).toBe('primary');
  });
  it('恰好 70% 边界:140/200 → nat0;141/200 → 平手取先验', () => {
    expect(RELAY_WIN_RATIO).toBe(0.7);
    expect(pickChannel([p('primary', 200), p('nat0', 140)], 'primary')).toBe('nat0');
    expect(pickChannel([p('primary', 200), p('nat0', 141)], 'primary')).toBe('primary');
  });
  it('仅一方可达 → 可达者当选', () => {
    expect(pickChannel([p('primary', null), p('nat0', 500)], 'primary')).toBe('nat0');
    expect(pickChannel([p('primary', 500), p('nat0', null)], 'nat0')).toBe('primary');
  });
  it('双方皆不可达 → 先验(调用方保持现状重试)', () => {
    expect(pickChannel([p('primary', null), p('nat0', null)], 'nat0')).toBe('nat0');
  });
});

describe('domesticPrior', () => {
  afterEach(() => jest.restoreAllMocks());
  it('中国时区名 → nat0', () => {
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' } as Intl.ResolvedDateTimeFormatOptions);
    expect(domesticPrior()).toBe('nat0');
  });
  it('非中国时区(即便同为 UTC+8,如新加坡)→ primary', () => {
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ locale: 'en-SG', timeZone: 'Asia/Singapore' } as Intl.ResolvedDateTimeFormatOptions);
    expect(domesticPrior()).toBe('primary');
  });
  it('Intl 不可用 → 回落 UTC+8 offset 判定', () => {
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('no intl');
    });
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-480);
    expect(domesticPrior()).toBe('nat0');
  });
});

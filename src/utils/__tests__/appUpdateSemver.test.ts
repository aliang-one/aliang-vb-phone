import {
  compareAppVersions,
  normalizeAppVersion,
  resolveUpdateDecision,
} from '../appUpdateSemver';

describe('normalizeAppVersion', () => {
  it('accepts v-prefixed and bare triplets', () => {
    expect(normalizeAppVersion('v1.0.7')).toBe('v1.0.7');
    expect(normalizeAppVersion('1.0.7')).toBe('v1.0.7');
    expect(normalizeAppVersion('  v2.10.3 ')).toBe('v2.10.3');
  });

  it('rejects anything the website check endpoint would 400 on', () => {
    // website 端 versionPattern = ^v\d+\.\d+\.\d+$;预发布/两段/空串全拒。
    expect(normalizeAppVersion('v1.0.7-beta')).toBeNull();
    expect(normalizeAppVersion('1.0')).toBeNull();
    expect(normalizeAppVersion('')).toBeNull();
    expect(normalizeAppVersion('V1.0.7')).toBeNull(); // 大写 V 与服务端正则不符
    // 服务端 \d+ 接受前导零(Go Atoi 解析 01=1),客户端保持同语义。
    expect(normalizeAppVersion('v01.2.3')).toBe('v01.2.3');
    expect(normalizeAppVersion(null)).toBeNull();
    expect(normalizeAppVersion(undefined)).toBeNull();
  });

  it('rejects non-string payloads (misconfigured server responses)', () => {
    // 坏配置形态:JSON 数字/数组/对象。必须静默 null,不能抛 TypeError。
    expect(normalizeAppVersion(1.07 as unknown as string)).toBeNull();
    expect(normalizeAppVersion(['v1.0.7'] as unknown as string)).toBeNull();
    expect(normalizeAppVersion({ latest: 'v1.0.7' } as unknown as string)).toBeNull();
  });

  it('rejects absurdly long digit runs ( MB 级版本串不得进渲染)', () => {
    expect(normalizeAppVersion(`v${'1'.repeat(100)}.0.0`)).toBeNull();
    expect(normalizeAppVersion(`v1.${'0'.repeat(100000)}.0`)).toBeNull();
  });
});

describe('compareAppVersions', () => {
  it('orders numerically per segment (multi-digit aware)', () => {
    expect(compareAppVersions('v1.0.7', 'v1.0.7')).toBe(0);
    expect(compareAppVersions('v1.0.7', 'v1.1.0')).toBeLessThan(0);
    expect(compareAppVersions('v1.10.0', 'v1.9.0')).toBeGreaterThan(0);
    expect(compareAppVersions('v2.0.0', 'v1.99.99')).toBeGreaterThan(0);
  });
});

describe('resolveUpdateDecision', () => {
  it('returns null when the client version is unreadable (never mis-judge)', () => {
    expect(resolveUpdateDecision(null, 'v9.9.9', true)).toBeNull();
    expect(resolveUpdateDecision('garbage', 'v9.9.9', true)).toBeNull();
  });

  it('returns null when the server has no latest row', () => {
    expect(resolveUpdateDecision('v1.0.7', null, true)).toBeNull();
    expect(resolveUpdateDecision('v1.0.7', 'not-a-version', false)).toBeNull();
  });

  it('behind + force flag = forced', () => {
    expect(resolveUpdateDecision('v1.0.6', 'v1.0.7', true)).toEqual({
      needsUpdate: true,
      forceUpdate: true,
    });
  });

  it('behind without flag = soft reminder', () => {
    expect(resolveUpdateDecision('v1.0.6', 'v1.0.7', false)).toEqual({
      needsUpdate: true,
      forceUpdate: false,
    });
    expect(resolveUpdateDecision('1.0.6', 'v1.0.7', false)).toEqual({
      needsUpdate: true,
      forceUpdate: false,
    });
  });

  it('up-to-date or ahead needs nothing, regardless of the flag', () => {
    expect(resolveUpdateDecision('v1.0.7', 'v1.0.7', true)).toEqual({
      needsUpdate: false,
      forceUpdate: false,
    });
    // 本地比服务端新(开发机)——绝不提示。
    expect(resolveUpdateDecision('v1.0.8', 'v1.0.7', true)).toEqual({
      needsUpdate: false,
      forceUpdate: false,
    });
  });

  it('recomputes locally and never blindly trusts server needs/force math', () => {
    // 服务端只回行级 force 标志;真正的 needs 由本地比较复算——
    // 服务端若误报 force 但版本相同,也不得强制。
    expect(resolveUpdateDecision('v1.0.7', 'v1.0.7', true)).toEqual({
      needsUpdate: false,
      forceUpdate: false,
    });
  });
});

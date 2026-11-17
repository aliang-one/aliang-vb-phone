import {
  parseLanCandidate, lanDirectDialAvailable, shouldAttemptLanDirect,
} from '../lanDirectDownload';

// LAN 直连下载(P1-3②手机半)解析与放行判定。拨号腿在原生 TLS 模块落地前
// 恒 COS(lanDirectDialAvailable=false),本文件钉三件事:候选解析校验面、
// 能力闸恒 false 的现契约、shouldAttempt 的门序。

const goodCandidate = {
  type: 'lan_direct',
  addr: '192.168.1.10:45678',
  token: 'tok',
  transfer_id: 'dl_t7_abc123',
  expires_at: '2026-11-17T00:00:30.000Z',
  fingerprint: 'ab'.repeat(32),
};

describe('parseLanCandidate', () => {
  it('合法候选原样通过(指纹归一小写)', () => {
    const parsed = parseLanCandidate({ direct_candidates: [goodCandidate] });
    expect(parsed).not.toBeNull();
    expect(parsed!.addr).toBe('192.168.1.10:45678');
    expect(parsed!.transfer_id).toBe('dl_t7_abc123');
    expect(parsed!.fingerprint).toBe('ab'.repeat(32));
  });

  it('缺 direct_candidates / 空数组 / 非 lan_direct 条目 → null(纯 COS)', () => {
    expect(parseLanCandidate(undefined)).toBeNull();
    expect(parseLanCandidate({})).toBeNull();
    expect(parseLanCandidate({ direct_candidates: [] })).toBeNull();
    expect(parseLanCandidate({ direct_candidates: [{ type: 'relay_cos' }] })).toBeNull();
  });

  it('畸形候选逐项拒收(主机名/无端口/指纹长度/缺 transfer_id/长 token)', () => {
    const variants = [
      { ...goodCandidate, addr: 'peer.local:45678' },
      { ...goodCandidate, addr: '192.168.1.10' },
      { ...goodCandidate, addr: '192.168.1.10:' },
      { ...goodCandidate, fingerprint: 'abcd' },
      { ...goodCandidate, transfer_id: '' },
      { ...goodCandidate, token: 'x'.repeat(129) },
    ];
    for (const bad of variants) {
      expect(parseLanCandidate({ direct_candidates: [bad] })).toBeNull();
    }
  });

  it('首条畸形跳过后继续看下一条(与 Go 侧 parse 同语义)', () => {
    const parsed = parseLanCandidate({
      direct_candidates: [{ type: 'lan_direct', addr: 'bad', token: 't', transfer_id: 'x', fingerprint: 'zz' }, goodCandidate],
    });
    expect(parsed?.addr).toBe('192.168.1.10:45678');
  });
});

describe('能力闸与放行判定', () => {
  it('原生 TLS 模块未落地:lanDirectDialAvailable 恒 false,shouldAttempt 恒 false(现链路恒 COS)', () => {
    expect(lanDirectDialAvailable()).toBe(false);
    expect(shouldAttemptLanDirect({ state: 'ready', direct_candidates: [goodCandidate] })).toBe(false);
    expect(shouldAttemptLanDirect(undefined)).toBe(false);
    expect(shouldAttemptLanDirect({ state: 'uploading', direct_candidates: [goodCandidate] })).toBe(false);
  });
});

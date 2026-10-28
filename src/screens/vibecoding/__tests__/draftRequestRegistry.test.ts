import {
  acquireDraftRequestId,
  confirmDraftRequestId,
  draftRequestKey,
  resetDraftRequestRegistryForTests,
  type DraftCreatePayload,
} from '../draftRequestRegistry';

const payload = (overrides: Partial<DraftCreatePayload> = {}): DraftCreatePayload => ({
  deviceId: 'dev-1',
  projectId: 'proj-1',
  directory: '/data/proj',
  provider: 'claude_code',
  objective: '继续k8s管理平台的开发',
  ...overrides,
});

beforeEach(() => {
  resetDraftRequestRegistryForTests();
});

describe('draftRequestRegistry — 跨导航重试复用 requestId(7-24 重复卡实锤)', () => {
  test('同载荷两次获取 → 同一 requestId(幂等重试回放同一会话)', () => {
    const first = acquireDraftRequestId(payload(), 1000);
    const second = acquireDraftRequestId(payload(), 60_000);
    expect(second).toBe(first);
  });

  test('载荷任一字段不同 → 新 requestId(避免服务端 409 idempotency_key_reused)', () => {
    const first = acquireDraftRequestId(payload(), 1000);
    const changed = acquireDraftRequestId(payload({ provider: 'codex' }), 60_000);
    expect(changed).not.toBe(first);
    expect(draftRequestKey(payload({ provider: 'codex' }))).not.toBe(
      draftRequestKey(payload()),
    );
  });

  test('TTL 过期(10min) → 新 requestId(视为新的会话意图)', () => {
    const first = acquireDraftRequestId(payload(), 1000);
    const expired = acquireDraftRequestId(payload(), 1000 + 10 * 60 * 1000);
    expect(expired).not.toBe(first);
  });

  test('创建成功 confirm 后删除 → 同载荷再次获取得到新会话', () => {
    const p = payload();
    const first = acquireDraftRequestId(p, 1000);
    confirmDraftRequestId(p);
    const deliberate = acquireDraftRequestId(p, 2000);
    expect(deliberate).not.toBe(first);
  });

  test('confirm 只删对应载荷,不影响其它登记', () => {
    const a = acquireDraftRequestId(payload({ objective: 'A' }), 1000);
    const b = acquireDraftRequestId(payload({ objective: 'B' }), 1001);
    confirmDraftRequestId(payload({ objective: 'A' }));
    expect(acquireDraftRequestId(payload({ objective: 'B' }), 2000)).toBe(b);
    expect(acquireDraftRequestId(payload({ objective: 'A' }), 2000)).not.toBe(a);
  });

  test('登记表容量上限:超限裁最旧,不无界增长', () => {
    let now = 1000;
    const ids: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      ids.push(acquireDraftRequestId(payload({ objective: `obj-${i}` }), now));
      now += 1;
    }
    // 第 1 条已被裁掉 → 重新获取得到新 id;最后一条仍在 → 复用。
    expect(acquireDraftRequestId(payload({ objective: 'obj-0' }), now)).not.toBe(ids[0]);
    expect(acquireDraftRequestId(payload({ objective: 'obj-39' }), now)).toBe(ids[39]);
  });

  test('draftRequestKey 字段序无关(稳定指纹)', () => {
    const a = draftRequestKey(payload());
    const b = draftRequestKey({
      objective: '继续k8s管理平台的开发',
      provider: 'claude_code',
      directory: '/data/proj',
      projectId: 'proj-1',
      deviceId: 'dev-1',
    });
    expect(a).toBe(b);
  });
});

/**
 * 手机 → server 的 provider wire 值回归。
 *
 * 这里曾经是三元链 + `else return 'codex'`：新增 provider 时漏掉分支会被
 * **静默降级成 codex**（用户选了内置内核，实际跑起外部 CLI），而类型检查
 * 拦不住。下面这组断言就是那道闸的运行时版本——尤其 agentcore 必须是
 * 'agentcore'，绝不能掉进 codex。
 */
import { providerWireValue } from '../src/store/slices/aiSessionSlice';

describe('providerWireValue', () => {
  it('maps every UI provider to its wire spelling', () => {
    expect(providerWireValue('claude_code')).toBe('claudecode');
    expect(providerWireValue('codex')).toBe('codex');
    expect(providerWireValue('opencode')).toBe('opencode');
  });

  it('keeps agentcore as agentcore (never silently degrades to codex)', () => {
    expect(providerWireValue('agentcore')).toBe('agentcore');
    expect(providerWireValue('agentcore')).not.toBe('codex');
  });
});

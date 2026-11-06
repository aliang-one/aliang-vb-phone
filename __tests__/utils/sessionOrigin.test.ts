import {
  agentcoreResumeTarget,
  deriveSessionOriginBadge,
  isTerminalPrefixedSessionId,
  sessionResumeTarget,
  terminalResumeTarget,
} from '../../src/utils/sessionOrigin';

describe('isTerminalPrefixedSessionId', () => {
  it('recognizes claude_ and codex_ prefixes', () => {
    expect(isTerminalPrefixedSessionId('claude_abc-123')).toBe(true);
    expect(isTerminalPrefixedSessionId('codex_abc-123')).toBe(true);
  });

  it('rejects other/absent ids', () => {
    expect(isTerminalPrefixedSessionId('sess_abc')).toBe(false);
    expect(isTerminalPrefixedSessionId('ai_import_123')).toBe(false);
    expect(isTerminalPrefixedSessionId('claudex_1')).toBe(false);
    expect(isTerminalPrefixedSessionId(undefined)).toBe(false);
  });
});

describe('terminalResumeTarget', () => {
  it('strips the claude_ prefix and maps to claude_code', () => {
    expect(terminalResumeTarget('claude_2f0a9b')).toEqual({
      provider: 'claude_code',
      nativeSessionId: '2f0a9b',
    });
  });

  it('strips the codex_ prefix and maps to codex', () => {
    expect(terminalResumeTarget('codex_0f9e8d')).toEqual({
      provider: 'codex',
      nativeSessionId: '0f9e8d',
    });
  });

  it('returns null for non-terminal ids', () => {
    expect(terminalResumeTarget('sess_abc')).toBeNull();
    expect(terminalResumeTarget(undefined)).toBeNull();
  });

  it('returns null when the prefix is bare (no native id left)', () => {
    expect(terminalResumeTarget('claude_')).toBeNull();
    expect(terminalResumeTarget('codex_')).toBeNull();
  });
});

describe('agentcoreResumeTarget', () => {
  // PhoneServer 铸的 agentcore 壳 id：ai_import_<sha1(deviceId:原生id)[0:18]>。
  const shellId = 'ai_import_c7e27e3a8f4b2d6e91';

  it('maps an agentcore shell card to its listed native session id', () => {
    expect(agentcoreResumeTarget('agentcore', shellId, 'j-abc123')).toEqual({
      provider: 'agentcore',
      nativeSessionId: 'j-abc123',
    });
  });

  it('trims the listed sourceSessionId', () => {
    expect(
      agentcoreResumeTarget('agentcore', shellId, '  j-abc123  ')
        ?.nativeSessionId,
    ).toBe('j-abc123');
  });

  it('returns null for a phone-created agentcore session (id is not an ai_import_ shell)', () => {
    // 服务端在会话绑定后会给手机会话回填 sourceSessionId（imported.ts 警告），
    // 所以 ai_<nanoid> 形态即使带上 sourceSessionId 也不是续聊壳。
    expect(agentcoreResumeTarget('agentcore', 'ai_abc123', 'j-abc123')).toBeNull();
  });

  it('returns null when the shell has no listed sourceSessionId', () => {
    expect(agentcoreResumeTarget('agentcore', shellId, undefined)).toBeNull();
    expect(agentcoreResumeTarget('agentcore', shellId, '')).toBeNull();
    expect(agentcoreResumeTarget('agentcore', shellId, '   ')).toBeNull();
  });

  it('returns null for non-agentcore providers', () => {
    expect(agentcoreResumeTarget('claude_code', shellId, 'j-abc123')).toBeNull();
    expect(agentcoreResumeTarget('codex', shellId, 'j-abc123')).toBeNull();
    expect(agentcoreResumeTarget(undefined, shellId, 'j-abc123')).toBeNull();
  });
});

describe('sessionResumeTarget', () => {
  it('prefers the terminal prefix shell (claude/codex unchanged)', () => {
    expect(
      sessionResumeTarget({
        id: 'claude_2f0a9b',
        provider: 'claude_code',
        sourceSessionId: 'ignored-uuid',
      }),
    ).toEqual({ provider: 'claude_code', nativeSessionId: '2f0a9b' });
    expect(
      sessionResumeTarget({ id: 'codex_0f9e8d', provider: 'codex' }),
    ).toEqual({ provider: 'codex', nativeSessionId: '0f9e8d' });
  });

  it('resolves an agentcore shell card via provider + listed sourceSessionId', () => {
    expect(
      sessionResumeTarget({
        id: 'ai_import_c7e27e3a8f4b2d6e91',
        provider: 'agentcore',
        sourceSessionId: 'j-abc123',
      }),
    ).toEqual({ provider: 'agentcore', nativeSessionId: 'j-abc123' });
  });

  it('does not light up for a phone-created agentcore session even when sourceSessionId is bound', () => {
    expect(
      sessionResumeTarget({
        id: 'ai_abc123',
        provider: 'agentcore',
        sourceSessionId: 'j-abc123',
      }),
    ).toBeNull();
  });

  it('returns null for ordinary sessions', () => {
    expect(sessionResumeTarget({ id: 'sess_1' })).toBeNull();
    expect(
      sessionResumeTarget({ id: 'sess_1', provider: 'agentcore' }),
    ).toBeNull();
  });
});

describe('deriveSessionOriginBadge', () => {
  it('maps wire origin values to badge kinds', () => {
    expect(deriveSessionOriginBadge('phone', 'sess_1')).toBe('phone');
    expect(deriveSessionOriginBadge('dashboard', 'sess_1')).toBe('dashboard');
    expect(deriveSessionOriginBadge('tui', 'ai_import_1')).toBe('terminal');
  });

  it('treats terminal-prefixed ids as terminal regardless of origin', () => {
    expect(deriveSessionOriginBadge(undefined, 'claude_abc')).toBe('terminal');
    expect(deriveSessionOriginBadge('managed', 'codex_abc')).toBe('terminal');
  });

  it('renders nothing for managed/empty/unknown origins', () => {
    expect(deriveSessionOriginBadge('managed', 'sess_1')).toBeNull();
    expect(deriveSessionOriginBadge(undefined, 'sess_1')).toBeNull();
    expect(deriveSessionOriginBadge('', 'sess_1')).toBeNull();
    expect(deriveSessionOriginBadge('external', undefined)).toBe('terminal');
  });
});

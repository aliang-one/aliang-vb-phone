import {
  deriveSessionOriginBadge,
  isTerminalPrefixedSessionId,
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

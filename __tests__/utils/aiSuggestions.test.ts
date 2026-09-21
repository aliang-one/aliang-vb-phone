import {
  MAX_AI_SUGGESTION_CHIPS,
  chipsFromCommandGenResult,
  mergeAiSuggestions,
  type AiSuggestionChip,
} from '../../src/utils/aiSuggestions';

describe('chipsFromCommandGenResult', () => {
  it('maps the new commands/dangerousFlags shape per command', () => {
    expect(
      chipsFromCommandGenResult({
        command: 'a',
        commands: ['a', 'b'],
        dangerous: false,
        dangerousFlags: [false, true],
      }),
    ).toEqual([
      { command: 'a', dangerous: false },
      { command: 'b', dangerous: true },
    ]);
  });

  it('falls back to [command] when commands is absent (old server)', () => {
    expect(
      chipsFromCommandGenResult({ command: 'git status --short', dangerous: false }),
    ).toEqual([{ command: 'git status --short', dangerous: false }]);
    expect(
      chipsFromCommandGenResult({ command: 'x', dangerous: true }),
    ).toEqual([{ command: 'x', dangerous: true }]);
  });

  it('ORs in the local isUnsafeSuggestion check', () => {
    expect(
      chipsFromCommandGenResult({
        commands: ['rm -rf /tmp/vibe-test'],
        dangerous: false,
        dangerousFlags: [false],
      }),
    ).toEqual([{ command: 'rm -rf /tmp/vibe-test', dangerous: true }]);
  });

  it('returns [] for an empty result', () => {
    expect(chipsFromCommandGenResult({})).toEqual([]);
  });
});

describe('mergeAiSuggestions', () => {
  const chip = (command: string, dangerous = false): AiSuggestionChip => ({ command, dangerous });

  it('puts the incoming batch first, then previous chips', () => {
    expect(mergeAiSuggestions([chip('old1'), chip('old2')], [chip('new1')])).toEqual([
      chip('new1'),
      chip('old1'),
      chip('old2'),
    ]);
  });

  it('dedupes case-insensitively and trims', () => {
    expect(mergeAiSuggestions([chip('LS -LA')], [chip('  ls -la ')]).map(c => c.command)).toEqual([
      'ls -la',
    ]);
  });

  it('caps the total at MAX_AI_SUGGESTION_CHIPS (6), newest wins', () => {
    const prev = Array.from({ length: 6 }, (_, i) => chip(`old${i}`));
    const merged = mergeAiSuggestions(prev, [chip('fresh')]);
    expect(merged.length).toBe(MAX_AI_SUGGESTION_CHIPS);
    expect(merged[0].command).toBe('fresh');
    expect(merged.map(c => c.command)).not.toContain('old5');
  });

  it('drops empty commands', () => {
    expect(mergeAiSuggestions([], [chip('  '), chip('ok')])).toEqual([chip('ok')]);
  });
});

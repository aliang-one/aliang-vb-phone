import {
  DANGEROUS_COMMANDS,
  isUnsafeSuggestion,
  buildTerminalSuggestions,
} from '../../src/utils/terminalSuggestions';

describe('terminalSuggestions exports', () => {
  it('exports DANGEROUS_COMMANDS regex', () => {
    expect(DANGEROUS_COMMANDS).toBeInstanceOf(RegExp);
    expect(DANGEROUS_COMMANDS.test('rm -rf /')).toBe(true);
    expect(DANGEROUS_COMMANDS.test('ls -la')).toBe(false);
  });

  it('exports isUnsafeSuggestion (flags dangerous + interactive)', () => {
    expect(isUnsafeSuggestion('rm -rf src')).toBe(true);
    expect(isUnsafeSuggestion('sudo rm -rf x')).toBe(true);
    expect(isUnsafeSuggestion('vim file')).toBe(true); // interactive
    expect(isUnsafeSuggestion('git status --short')).toBe(false);
  });

  it('still exports buildTerminalSuggestions (no regression)', () => {
    expect(typeof buildTerminalSuggestions).toBe('function');
    expect(buildTerminalSuggestions({ directory: '/repo' }).length).toBeGreaterThan(0);
  });
});

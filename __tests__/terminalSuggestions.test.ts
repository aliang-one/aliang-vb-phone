import { isUnsafeSuggestion } from '../src/utils/terminalSuggestions';

describe('isUnsafeSuggestion', () => {
  it('flags interactive commands', () => {
    expect(isUnsafeSuggestion('vim src/a.ts')).toBe(true);
    expect(isUnsafeSuggestion('ssh host')).toBe(true);
  });

  it('flags dangerous commands', () => {
    expect(isUnsafeSuggestion('rm -rf /tmp/x')).toBe(true);
    expect(isUnsafeSuggestion('sudo rm -rf /')).toBe(true);
    expect(isUnsafeSuggestion('shutdown now')).toBe(true);
  });

  it('flags secret markers', () => {
    expect(isUnsafeSuggestion('curl https://x?token=abc')).toBe(true);
    expect(isUnsafeSuggestion('cat .env password=hunter2')).toBe(true);
  });

  it('allows safe commands', () => {
    expect(isUnsafeSuggestion('git status --short')).toBe(false);
    expect(isUnsafeSuggestion('ls -la')).toBe(false);
    expect(isUnsafeSuggestion('npm test -- --runInBand')).toBe(false);
    expect(isUnsafeSuggestion('vimrc')).toBe(false); // 锚点:^vim+空白,不会误伤
  });
});

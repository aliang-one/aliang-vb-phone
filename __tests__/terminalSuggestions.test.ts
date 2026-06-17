import { buildTerminalSuggestions } from '../src/utils/terminalSuggestions';

describe('terminalSuggestions', () => {
  it('prioritizes recent safe command history and dedupes case-insensitively', () => {
    expect(
      buildTerminalSuggestions({
        directory: '~/repo',
        history: [
          command('git status --short', '2026-06-17T10:00:03.000Z'),
          command('Git Status --short', '2026-06-17T10:00:02.000Z'),
          command('npm test -- --runInBand', '2026-06-17T10:00:01.000Z'),
        ],
      }),
    ).toEqual([
      'git status --short',
      'npm test -- --runInBand',
      'npm run lint',
      'pwd',
    ]);
  });

  it('sorts merged session and device history by recency before fallback commands', () => {
    expect(
      buildTerminalSuggestions({
        directory: '~/repo',
        history: [
          command('npm run lint', '2026-06-17T10:00:01.000Z'),
          command('git diff --stat', '2026-06-17T10:00:03.000Z'),
          command('pwd', '2026-06-17T10:00:02.000Z'),
        ],
        max: 3,
      }),
    ).toEqual(['git diff --stat', 'pwd', 'npm run lint']);
  });

  it('filters interactive, destructive, and redacted command history', () => {
    expect(
      buildTerminalSuggestions({
        directory: '~/repo',
        history: [
          command('vim src/App.tsx'),
          command('rm -rf node_modules'),
          command('curl -H "Authorization: Bearer <redacted>" https://x.test'),
          command('ls -la'),
        ],
      })[0],
    ).toBe('ls -la');
  });
});

function command(commandText: string, createdAt = '2026-06-17T10:00:00.000Z') {
  return {
    id: commandText,
    terminalSessionId: 'term-1',
    deviceId: 'device-1',
    command: commandText,
    timestamp: createdAt,
    createdAt,
  };
}

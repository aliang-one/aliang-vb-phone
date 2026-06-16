import {
  decodeTerminalData,
  stripTerminalControlCodes,
  terminalDisplayLines,
  terminalDisplayText,
  terminalDisplayUpdate,
} from '../src/utils/terminalOutput';

describe('terminalOutput', () => {
  it('decodes base64 terminal payloads as utf8 text', () => {
    expect(decodeTerminalData('bHMgLWxhCg==', 'base64')).toBe('ls -la\n');
  });

  it('strips ansi, osc, and non-printing control codes', () => {
    expect(
      stripTerminalControlCodes(
        '\x1b[?2004h\x1b[32mok\x1b[0m\r\n\x1b]0;title\x07done\x08',
      ),
    ).toBe('ok\ndone');
  });

  it('returns display-safe lines for command executor fallback output', () => {
    expect(
      terminalDisplayLines('\x1b[31mfirst\x1b[0m\r\nsecond\n\n', 'text'),
    ).toEqual(['first', 'second']);
    expect(terminalDisplayText('bHMgLWxhCmRvbmUK', 'base64')).toBe(
      'ls -la\ndone\n',
    );
  });

  it('detects screen repaint output from watch-like commands', () => {
    expect(
      terminalDisplayUpdate('\x1b[H\x1b[2JEvery 2.0s: date\n12:00:01\n'),
    ).toMatchObject({
      mode: 'replaceScreen',
      lines: ['Every 2.0s: date', '12:00:01'],
    });
  });

  it('projects cursor-addressed top output onto the current screen frame', () => {
    const firstFrame = terminalDisplayUpdate(
      '\x1b[Htop - 10:00:01\nTasks: 20 total\nPID COMMAND\n1 node\n',
    );
    expect(firstFrame).toMatchObject({
      mode: 'replaceScreen',
      lines: ['top - 10:00:01', 'Tasks: 20 total', 'PID COMMAND', '1 node'],
    });

    expect(
      terminalDisplayUpdate(
        '\x1b[H\x1b[2Ktop - 10:00:02\n\x1b[2KTasks: 21 total\n\x1b[2KPID COMMAND\n\x1b[2K2 zsh\n',
        'text',
        firstFrame.lines,
      ),
    ).toMatchObject({
      mode: 'replaceScreen',
      lines: ['top - 10:00:02', 'Tasks: 21 total', 'PID COMMAND', '2 zsh'],
    });
  });

  it('detects carriage-return progress updates as last-line rewrites', () => {
    expect(
      terminalDisplayUpdate('Downloading 10%\rDownloading 20%'),
    ).toMatchObject({
      mode: 'rewriteLastLine',
      lines: ['Downloading 20%'],
    });
  });

  it('does not treat zsh prompt repaint cleanup as a screen replacement', () => {
    expect(
      terminalDisplayUpdate(
        '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                               \r \r',
      ),
    ).toMatchObject({
      mode: 'append',
      lines: [],
    });

    expect(
      terminalDisplayUpdate(
        '\r\x1b[0m\x1b[27m\x1b[24m\x1b[J(base) mac@MacBookPro ~/project$ \x1b[K\x1b[?2004h',
      ),
    ).toMatchObject({
      mode: 'append',
      lines: ['(base) mac@MacBookPro ~/project$'],
    });
  });
});

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

  it('detects carriage-return progress updates as last-line rewrites', () => {
    expect(
      terminalDisplayUpdate('Downloading 10%\rDownloading 20%'),
    ).toMatchObject({
      mode: 'rewriteLastLine',
      lines: ['Downloading 20%'],
    });
  });
});

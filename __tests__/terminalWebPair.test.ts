import { apiPost } from '../src/api/client';
import {
  approveTerminalWebPair,
  extractTerminalWebPair,
  TERMINAL_WEB_PAIR_HOST,
} from '../src/api/terminalWebPair';

jest.mock('../src/api/client', () => ({
  apiPost: jest.fn(),
}));

const mockedPost = apiPost as jest.MockedFunction<typeof apiPost>;

describe('extractTerminalWebPair', () => {
  it('extracts pid/s from the canonical QR URL', () => {
    expect(
      extractTerminalWebPair('https://terminal.aliang.one/pair#pid=ABC&s=xyz'),
    ).toEqual({ pairingId: 'ABC', secret: 'xyz' });
  });

  it('tolerates an explicit default port and a query string', () => {
    expect(
      extractTerminalWebPair(
        'https://terminal.aliang.one:443/pair?x=1#pid=ABC&s=xyz',
      ),
    ).toEqual({ pairingId: 'ABC', secret: 'xyz' });
  });

  it('accepts hash params in any order', () => {
    expect(
      extractTerminalWebPair('https://terminal.aliang.one/pair#s=B&pid=A'),
    ).toEqual({ pairingId: 'A', secret: 'B' });
  });

  it('decodes percent-encoded secrets', () => {
    expect(
      extractTerminalWebPair(
        'https://terminal.aliang.one/pair#pid=A&s=a%2Bb%3Dc',
      ),
    ).toEqual({ pairingId: 'A', secret: 'a+b=c' });
  });

  it('normalizes an uppercase host to the same host', () => {
    // URL lowercases hostname, so case tricks can't bypass the whitelist.
    expect(
      extractTerminalWebPair('https://TERMINAL.ALIANG.ONE/pair#pid=A&s=B'),
    ).toEqual({ pairingId: 'A', secret: 'B' });
  });

  it('tolerates http scheme (dev pages)', () => {
    expect(
      extractTerminalWebPair('http://terminal.aliang.one/pair#pid=A&s=B'),
    ).toEqual({ pairingId: 'A', secret: 'B' });
  });

  it('trims surrounding whitespace', () => {
    expect(
      extractTerminalWebPair('  https://terminal.aliang.one/pair#pid=A&s=B\n'),
    ).toEqual({ pairingId: 'A', secret: 'B' });
  });

  it('rejects a URL without a hash', () => {
    expect(
      extractTerminalWebPair('https://terminal.aliang.one/pair'),
    ).toBeUndefined();
  });

  it('rejects a hash missing s', () => {
    expect(
      extractTerminalWebPair('https://terminal.aliang.one/pair#pid=A'),
    ).toBeUndefined();
  });

  it('rejects a hash with an empty value', () => {
    expect(
      extractTerminalWebPair('https://terminal.aliang.one/pair#pid=A&s='),
    ).toBeUndefined();
  });

  it('rejects the empty string', () => {
    expect(extractTerminalWebPair('')).toBeUndefined();
    expect(extractTerminalWebPair('   ')).toBeUndefined();
  });

  describe('rejects spoofed payloads', () => {
    it('rejects a foreign host', () => {
      expect(
        extractTerminalWebPair('https://evil.com/pair#pid=A&s=B'),
      ).toBeUndefined();
    });

    it('rejects a suffix-trick host', () => {
      expect(
        extractTerminalWebPair(
          'https://terminal.aliang.one.evil.com/pair#pid=A&s=B',
        ),
      ).toBeUndefined();
    });

    it('rejects a subdomain of the pair host', () => {
      expect(
        extractTerminalWebPair(
          'https://x.terminal.aliang.one/pair#pid=A&s=B',
        ),
      ).toBeUndefined();
    });

    it('rejects a scan-login sc_ code', () => {
      expect(extractTerminalWebPair('sc_abcdef1234')).toBeUndefined();
    });

    it('rejects a bare non-URL pid/s string', () => {
      expect(extractTerminalWebPair('pid=A&s=B')).toBeUndefined();
    });

    it('rejects pid/s passed in the query string', () => {
      // 规格 §5 安全不变量:secret 只走 # 片段(不进服务器访问日志),
      // 查询串形态的 pid/s 一律不认。
      expect(
        extractTerminalWebPair('https://terminal.aliang.one/pair?pid=A&s=B'),
      ).toBeUndefined();
    });
  });

  it('exposes the host constant the QR pages live on', () => {
    expect(TERMINAL_WEB_PAIR_HOST).toBe('terminal.aliang.one');
  });
});

describe('approveTerminalWebPair', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts to the approve endpoint with snake_case fields', async () => {
    mockedPost.mockResolvedValue({ ok: true });

    await approveTerminalWebPair({
      pairingId: 'pair_1',
      secret: 'a+b=c',
      terminalId: 'term_1',
    });

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/terminal-web/pair/approve',
      {
        pairing_id: 'pair_1',
        secret: 'a+b=c',
        terminal_id: 'term_1',
      },
    );
  });

  it('passes the response through untouched', async () => {
    mockedPost.mockResolvedValue({ ok: true });

    await expect(
      approveTerminalWebPair({
        pairingId: 'p',
        secret: 's',
        terminalId: 't',
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('propagates API errors (e.g. 404 expired pairing) unchanged', async () => {
    const error = new Error('pairing_not_found');
    mockedPost.mockRejectedValue(error);

    await expect(
      approveTerminalWebPair({ pairingId: 'p', secret: 's', terminalId: 't' }),
    ).rejects.toBe(error);
  });
});

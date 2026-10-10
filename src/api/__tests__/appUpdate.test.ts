/**
 * fetchUpdateCheck — 服务端响应消毒层。
 * 锁:404 静默、非字符串/非法版本静默、changelog 截断+控制字符剥离、
 * download_url 白名单(https 自有域/商店 scheme,其余回退空串)、
 * 布尔宽松归一("true" 认强)。
 */
const mockedAccountGet = jest.fn();
jest.mock('../accountClient', () => ({
  accountGet: (...args: unknown[]) => mockedAccountGet(...args),
}));

// client.ts 拖拽本地服务发现链,测试里只给它一个最小 ApiResponseError。
jest.mock('../client', () => {
  class ApiResponseError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiResponseError };
});

import {
  fetchUpdateCheck,
  sanitizeChangelog,
  sanitizeDownloadUrl,
} from '../appUpdate';
import { ApiResponseError } from '../client';

beforeEach(() => {
  mockedAccountGet.mockReset();
});

describe('fetchUpdateCheck', () => {
  it('404(未配置该软件行)→ null 静默', async () => {
    mockedAccountGet.mockRejectedValue(
      new ApiResponseError('no downloads found', 404),
    );
    await expect(fetchUpdateCheck('ios', 'v1.0.6')).resolves.toBeNull();
    // 必须显式带 software 参数 + baseUrl 直连官网(accountClient 才消费 baseUrl)
    const [path, options] = mockedAccountGet.mock.calls[0];
    expect(path).toContain('/api/public/downloads/check');
    expect(path).toContain('software=aliang-vibe-phone');
    expect(path).toContain('platform=ios');
    expect((options as { baseUrl: string }).baseUrl).toBe('https://www.aliang.one');
  });

  it('signal 透传给底层调用(死线到点可真正取消请求)', async () => {
    mockedAccountGet.mockResolvedValue({ latest_version: 'v1.0.7' });
    const controller = new AbortController();
    await fetchUpdateCheck('ios', 'v1.0.6', controller.signal);
    const [, options] = mockedAccountGet.mock.calls[0];
    expect((options as { signal?: AbortSignal }).signal).toBe(controller.signal);
  });

  it('latest_version 非字符串/非法格式 → null 静默(不抛)', async () => {
    mockedAccountGet.mockResolvedValue({ latest_version: 123, force_update: true });
    await expect(fetchUpdateCheck('ios', 'v1.0.6')).resolves.toBeNull();
    mockedAccountGet.mockResolvedValue({ latest_version: 'not-a-version' });
    await expect(fetchUpdateCheck('ios', 'v1.0.6')).resolves.toBeNull();
  });

  it('force_update 序列化成字符串 "true" 也认强', async () => {
    mockedAccountGet.mockResolvedValue({
      latest_version: 'v1.0.7',
      force_update: 'true',
    });
    const result = await fetchUpdateCheck('ios', 'v1.0.6');
    expect(result?.serverForceFlag).toBe(true);
    mockedAccountGet.mockResolvedValue({
      latest_version: 'v1.0.7',
      force_update: 1,
    });
    const soft = await fetchUpdateCheck('ios', 'v1.0.6');
    expect(soft?.serverForceFlag).toBe(false);
  });

  it('download_url 不合白名单 → 空串(UI 回退兜底落地页)', async () => {
    mockedAccountGet.mockResolvedValue({
      latest_version: 'v1.0.7',
      download_url: 'https://evil.example.com/apk',
    });
    expect((await fetchUpdateCheck('ios', 'v1.0.6'))?.downloadUrl).toBe('');
  });
});

describe('sanitizeDownloadUrl', () => {
  it('放行 https 自有域与商店 scheme', () => {
    expect(sanitizeDownloadUrl('https://www.aliang.one/download')).toBe(
      'https://www.aliang.one/download',
    );
    expect(sanitizeDownloadUrl('https://aliang.one/x')).toBe('https://aliang.one/x');
    expect(sanitizeDownloadUrl('https://dl.aliang.one:8443/a.ipa')).toBe(
      'https://dl.aliang.one:8443/a.ipa',
    );
    expect(sanitizeDownloadUrl('itms-apps://apps.apple.com/app/id123')).toBe(
      'itms-apps://apps.apple.com/app/id123',
    );
    expect(sanitizeDownloadUrl('market://details?id=com.aliang')).toBe(
      'market://details?id=com.aliang',
    );
  });

  it('拒绝非自有域/明文 http/伪协议/超长', () => {
    expect(sanitizeDownloadUrl('https://evil.com/apk')).toBe('');
    expect(sanitizeDownloadUrl('https://evil-aliang.one/x')).toBe(''); // 前缀伪装
    expect(sanitizeDownloadUrl('https://aliang.one.evil.com/x')).toBe('');
    expect(sanitizeDownloadUrl('http://www.aliang.one/x')).toBe('');
    expect(sanitizeDownloadUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeDownloadUrl('intent://x#Intent;scheme=http;end')).toBe('');
    expect(sanitizeDownloadUrl(`https://www.aliang.one/${'a'.repeat(3000)}`)).toBe('');
    expect(sanitizeDownloadUrl(42 as unknown as string)).toBe('');
  });
});

describe('sanitizeChangelog', () => {
  it('超 8KB 截断并加省略号', () => {
    const out = sanitizeChangelog('a'.repeat(9000));
    expect(out.length).toBe(8193);
    expect(out.endsWith('…')).toBe(true);
  });

  it('剥离控制字符与 BiDi 覆写符(防视觉欺骗)', () => {
    const out = sanitizeChangelog('ok\u0000\u001F‮evil‮⁦x⁩');
    expect(out).toBe('okevilx');
  });

  it('非字符串/空串安全', () => {
    expect(sanitizeChangelog(undefined)).toBe('');
    expect(sanitizeChangelog(123 as unknown as string)).toBe('');
    expect(sanitizeChangelog('')).toBe('');
  });
});

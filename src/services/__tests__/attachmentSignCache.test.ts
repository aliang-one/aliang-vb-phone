// Task 19：签名缓存的三条硬契约。
//   1. 同一 tick 里多个气泡的请求合并成一次批量调用；
//   2. 本地已有文件（自己刚发的）不签名；
//   3. 签名失败不抛给渲染层，只记「失败」让气泡换占位文案。
jest.mock('../../api/attachments', () => ({
  signAttachments: jest.fn(),
}));

import { signAttachments } from '../../api/attachments';
import {
  attachmentUrlFailed,
  clearAttachmentSignCache,
  ensureAttachmentUrls,
  getSignedUrl,
  registerLocalAssetPath,
  signedUrlRefreshDelay,
  subscribeAttachmentUrls,
} from '../attachmentSignCache';

const signMock = signAttachments as jest.Mock;

const ok = (ids: string[], expiresInSeconds = 900) => ({
  urls: Object.fromEntries(
    ids.map(id => [
      id,
      {
        url: `https://cos.example/${id}?q-sign-algorithm=sha1`,
        expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      },
    ]),
  ),
  expires_in: expiresInSeconds,
});

/** 让排队的微任务批次跑完。 */
const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve());

beforeEach(() => {
  jest.clearAllMocks();
  clearAttachmentSignCache();
});

describe('批量签名', () => {
  it('同一 tick 的多个 id 合并成一次请求', async () => {
    signMock.mockImplementation((ids: string[]) => Promise.resolve(ok(ids)));

    ensureAttachmentUrls(['a1']);
    ensureAttachmentUrls(['a2', 'a3']);
    await flushMicrotasks();

    expect(signMock).toHaveBeenCalledTimes(1);
    expect(signMock).toHaveBeenCalledWith(['a1', 'a2', 'a3']);
    expect(getSignedUrl('a1')).toContain('q-sign-algorithm');
    expect(getSignedUrl('a3')).toContain('q-sign-algorithm');
  });

  it('已有有效缓存 → 不再请求', async () => {
    signMock.mockImplementation((ids: string[]) => Promise.resolve(ok(ids)));

    ensureAttachmentUrls(['a1']);
    await flushMicrotasks();
    ensureAttachmentUrls(['a1']);
    await flushMicrotasks();

    expect(signMock).toHaveBeenCalledTimes(1);
  });

  it('提前 60 秒判失效并续签', async () => {
    // 第一次签名只剩 30 秒有效期：立刻视为需要刷新。
    signMock.mockImplementationOnce((ids: string[]) =>
      Promise.resolve(ok(ids, 30)),
    );
    ensureAttachmentUrls(['a1']);
    await flushMicrotasks();
    expect(getSignedUrl('a1')).toBeUndefined();

    signMock.mockImplementation((ids: string[]) => Promise.resolve(ok(ids)));
    ensureAttachmentUrls(['a1']);
    await flushMicrotasks();
    expect(signMock).toHaveBeenCalledTimes(2);
    expect(getSignedUrl('a1')).toBeDefined();
  });

  it('signedUrlRefreshDelay 给出到刷新点的毫秒数', async () => {
    signMock.mockImplementation((ids: string[]) => Promise.resolve(ok(ids, 600)));
    ensureAttachmentUrls(['a1']);
    await flushMicrotasks();

    const delay = signedUrlRefreshDelay('a1');
    expect(delay).toBeGreaterThan(500_000);
    expect(delay).toBeLessThanOrEqual(540_000);
  });
});

describe('本地文件短路', () => {
  it('注册了本地路径的 id 不进入签名队列', async () => {
    signMock.mockImplementation((ids: string[]) => Promise.resolve(ok(ids)));

    registerLocalAssetPath('local-1', '/tmp/attachments/local-1.jpg');
    ensureAttachmentUrls(['local-1']);
    await flushMicrotasks();

    expect(signMock).not.toHaveBeenCalled();
  });
});

describe('失败语义', () => {
  it('请求失败 → 不抛、标记失败、通知订阅者', async () => {
    signMock.mockRejectedValue(new Error('network down'));
    const listener = jest.fn();
    const unsubscribe = subscribeAttachmentUrls(listener);

    expect(() => ensureAttachmentUrls(['a1'])).not.toThrow();
    await flushMicrotasks();

    expect(attachmentUrlFailed('a1')).toBe(true);
    expect(getSignedUrl('a1')).toBeUndefined();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('服务端静默跳过未知 id（响应缺 key）→ 该 id 记为失败', async () => {
    // 发两个，只回一个：缺失的那个按「不可用」处理，不能一直转圈。
    signMock.mockImplementation(() => Promise.resolve(ok(['a1'])));

    ensureAttachmentUrls(['a1', 'ghost']);
    await flushMicrotasks();

    expect(getSignedUrl('a1')).toBeDefined();
    expect(attachmentUrlFailed('ghost')).toBe(true);
  });
});

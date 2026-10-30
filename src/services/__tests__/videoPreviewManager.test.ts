// videoPreviewManager:模块级 preview 会话注册表。
// 钉子:重复订阅回放最新阶段(不二次 start)、ready 秒附、显式 cancel 才撤
// 上传、失败清条目、在飞/ready 容量上限、ready TTL 过期重开。
import { resetVideoPreviewManagerForTests, subscribeVideoPreview } from '../videoPreviewManager';
import { createPreviewSession, PreviewCancelledError, type PreviewApi } from '../videoPreview';
import type { ServerFilePreview } from '../../api/projects';

const snap = (over: Partial<ServerFilePreview>): ServerFilePreview => ({
  request_id: 'pv_x',
  project_id: 'p1',
  mode: 'preview',
  state: 'uploading',
  uploaded_bytes: 0,
  total_bytes: 100,
  ...over,
});

const makeApi = (over: Partial<PreviewApi> = {}): PreviewApi => ({
  start: jest.fn().mockResolvedValue(snap({ request_id: 'pv_a', state: 'uploading' })),
  get: jest.fn().mockResolvedValue(snap({ request_id: 'pv_a', state: 'uploading' })),
  cancel: jest.fn().mockResolvedValue(snap({ state: 'cancelled' })),
  ...over,
});

// 每个用例一个共享 harness:createSession 全局计数(所有订阅共用),
// attach(path) 返回该次订阅的相位/错误记录与句柄。
const makeHarness = (api: PreviewApi, now?: () => number) => {
  const createSession = jest.fn(() => createPreviewSession(api));
  const attach = (path = 'a.mp4', projectId = 'p1') => {
    const calls: string[] = [];
    const errors: string[] = [];
    const handle = subscribeVideoPreview(
      projectId,
      path,
      {
        onPhase: p => calls.push(p.kind),
        onError: m => errors.push(m),
      },
      now ? { createSession, now } : { createSession },
    );
    return { calls, errors, detach: handle.detach, cancel: handle.cancel };
  };
  return { createSession, attach };
};

describe('videoPreviewManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetVideoPreviewManagerForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
    resetVideoPreviewManagerForTests();
  });

  it('首订阅:start 一次,onPhase(starting) 立即回调', () => {
    const api = makeApi();
    const { createSession, attach } = makeHarness(api);
    const h = attach();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(['starting']);
  });

  it('在飞中重复订阅:回放最新阶段,不二次 start', async () => {
    const api = makeApi(); // start→uploading;get 永远 uploading → 停在 uploading
    const { createSession, attach } = makeHarness(api);
    const first = attach();
    await jest.advanceTimersByTimeAsync(2100); // 轮询一轮 → uploading
    expect(first.calls).toEqual(['starting', 'uploading']);

    const second = attach();
    expect(createSession).toHaveBeenCalledTimes(1); // 同一条目
    expect(second.calls).toEqual(['uploading']); // 立刻回放最新阶段
  });

  it('ready 后 detach 重订阅:立即 ready+url,不重新 start', async () => {
    const api = makeApi({
      get: jest.fn()
        .mockResolvedValueOnce(snap({ request_id: 'pv_a', state: 'uploading' }))
        .mockResolvedValue(snap({ request_id: 'pv_a', state: 'ready', url: 'https://cos/v.mp4' })),
    });
    const { createSession, attach } = makeHarness(api);
    const first = attach();
    await jest.advanceTimersByTimeAsync(2100);
    await jest.advanceTimersByTimeAsync(2100);
    expect(first.calls[first.calls.length - 1]).toBe('ready');

    first.detach();
    const second = attach();
    expect(createSession).toHaveBeenCalledTimes(1); // 秒附,无新会话
    expect(second.calls).toEqual(['ready']);
  });

  it('显式 cancel:DELETE 服务端 + 清条目;重订阅重新 start', async () => {
    const api = makeApi();
    const { createSession, attach } = makeHarness(api);
    const first = attach();
    await jest.advanceTimersByTimeAsync(0); // start 落定,requestId 就位

    const cancelled = first.cancel();
    await jest.advanceTimersByTimeAsync(2100); // 让 start 的取消 rejection 落定
    await cancelled;
    expect(api.cancel).toHaveBeenCalledWith('p1', 'pv_a');

    attach();
    expect(createSession).toHaveBeenCalledTimes(2); // 条目已清,新会话
  });

  it('start 失败(非取消):广播 onError 并清条目', async () => {
    const api = makeApi({ start: jest.fn().mockRejectedValue(new Error('boom')) });
    const { createSession, attach } = makeHarness(api);
    const first = attach();
    await jest.advanceTimersByTimeAsync(0);
    expect(first.errors).toEqual(['boom']);

    const second = attach();
    expect(createSession).toHaveBeenCalledTimes(2); // 条目已清
    await jest.advanceTimersByTimeAsync(0); // 新会话的 rejection 落定
    expect(second.errors).toEqual(['boom']); // 新订阅同样收到失败
  });

  it('start 以取消态收场:不广播 onError,条目照常清理', async () => {
    const api = makeApi({ start: jest.fn().mockRejectedValue(new PreviewCancelledError()) });
    const { createSession, attach } = makeHarness(api);
    const first = attach();
    await jest.advanceTimersByTimeAsync(0);
    expect(first.errors).toEqual([]);
    attach();
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it('在飞上限 2:第 3 条订阅取消最旧在飞会话(DELETE)', async () => {
    const api = makeApi();
    const { createSession, attach } = makeHarness(api);
    attach('a.mp4');
    attach('b.mp4');
    await jest.advanceTimersByTimeAsync(0); // 各 start 落定,requestId 就位
    attach('c.mp4');
    // 最旧(a)被撤:api.cancel('p1','pv_a')
    expect(api.cancel).toHaveBeenCalledWith('p1', 'pv_a');
    // a 条目被清:重订阅 a → 新会话
    attach('a.mp4');
    expect(createSession).toHaveBeenCalledTimes(4);
  });

  it('ready TTL 过期(默认 90min):重订阅触发新 start', async () => {
    let nowMs = 1_000_000;
    const api = makeApi({
      get: jest.fn().mockResolvedValue(snap({ request_id: 'pv_a', state: 'ready', url: 'https://cos/v.mp4' })),
    });
    const { createSession, attach } = makeHarness(api, () => nowMs);
    attach();
    await jest.advanceTimersByTimeAsync(2100); // ready(本轮 get 直接 ready)
    expect(createSession).toHaveBeenCalledTimes(1);

    nowMs += 91 * 60_000; // 越过 90min TTL
    attach();
    expect(createSession).toHaveBeenCalledTimes(2); // 条目过期丢弃,重开会话
  });
});

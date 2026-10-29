// preview 编排:start→轮询→直链;取消语义;失败映射;竞态(start 返回前取消)。
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

describe('createPreviewSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uploading→ready:轮询拿直链,阶段回调按序汇报', async () => {
    const api: PreviewApi = {
      start: jest.fn().mockResolvedValue(snap({ request_id: 'pv_1', state: 'uploading' })),
      get: jest.fn()
        .mockResolvedValueOnce(snap({ request_id: 'pv_1', state: 'uploading', uploaded_bytes: 50 }))
        .mockResolvedValueOnce(snap({ request_id: 'pv_1', state: 'ready', url: 'https://cos/x' })),
      cancel: jest.fn().mockResolvedValue(snap({})),
    };
    const session = createPreviewSession(api);
    const phases: Array<string> = [];
    const done = session.start('p1', 'a.mp4', p => phases.push(p.kind));

    await jest.advanceTimersByTimeAsync(2100);
    await jest.advanceTimersByTimeAsync(2100);
    await expect(done).resolves.toEqual({
      kind: 'ready',
      url: 'https://cos/x',
      requestId: 'pv_1',
    });
    expect(phases[0]).toBe('starting');
    expect(phases).toContain('uploading');
    expect(phases[phases.length - 1]).toBe('ready');
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('取消:cancel() 后轮询抛 PreviewCancelledError,并 DELETE 服务端记录', async () => {
    const api: PreviewApi = {
      start: jest.fn().mockResolvedValue(snap({ request_id: 'pv_2', state: 'uploading' })),
      get: jest.fn().mockResolvedValue(snap({ request_id: 'pv_2', state: 'uploading' })),
      cancel: jest.fn().mockResolvedValue(snap({ state: 'cancelled' })),
    };
    const session = createPreviewSession(api);
    const done = session.start('p1', 'a.mp4');
    // 先挂上 rejects 断言再推进时钟:rejection 产生于 advance 期间,
    // 后挂会在中间产生 unhandled rejection。
    const assertion = expect(done).rejects.toBeInstanceOf(PreviewCancelledError);
    await jest.advanceTimersByTimeAsync(0);
    session.cancel();
    await jest.advanceTimersByTimeAsync(2100);
    await assertion;
    expect(api.cancel).toHaveBeenCalledWith('p1', 'pv_2');
  });

  it('服务端 failed → reject(reason);超时 → preview_timeout', async () => {
    const api: PreviewApi = {
      start: jest.fn().mockResolvedValue(snap({ request_id: 'pv_3', state: 'uploading' })),
      get: jest.fn().mockResolvedValue(snap({ request_id: 'pv_3', state: 'failed', reason: 'device_offline' })),
      cancel: jest.fn().mockResolvedValue(snap({})),
    };
    const session = createPreviewSession(api);
    const done = session.start('p1', 'a.mp4');
    const assertion = expect(done).rejects.toThrow('device_offline');
    await jest.advanceTimersByTimeAsync(2100);
    await assertion;
  });

  it('start 返回前已取消:补发 cancel 并以取消态收场', async () => {
    const api: PreviewApi = {
      start: jest.fn().mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve(snap({ request_id: 'pv_4', state: 'uploading' })), 1000);
      })),
      get: jest.fn(),
      cancel: jest.fn().mockResolvedValue(snap({ state: 'cancelled' })),
    };
    const session = createPreviewSession(api);
    const done = session.start('p1', 'a.mp4');
    const assertion = expect(done).rejects.toBeInstanceOf(PreviewCancelledError);
    await jest.advanceTimersByTimeAsync(0);
    session.cancel();
    await jest.advanceTimersByTimeAsync(1100);
    await assertion;
    expect(api.cancel).toHaveBeenCalledWith('p1', 'pv_4');
  });
});

import React, { useEffect } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  useAiCommandSuggestions,
  type UseAiCommandSuggestionsOptions,
  type UseAiCommandSuggestionsResult,
} from '../src/hooks/useAiCommandSuggestions';
import { dispatchCommandGenEvent } from '../src/services/commandGenEvents';
import { ApiResponseError } from '../src/api/client';

jest.useFakeTimers();

jest.mock('../src/hooks/useVoiceStt', () => ({
  useVoiceStt: () => ({
    status: 'idle',
    liveCaption: '',
    errorMessage: '',
    start: jest.fn().mockResolvedValue(true),
    stop: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn(),
  }),
}));

jest.mock('../src/api/commandGen', () => ({ generateCommand: jest.fn() }));
import { generateCommand } from '../src/api/commandGen';
const genMock = generateCommand as jest.Mock;

let latest: UseAiCommandSuggestionsResult | null = null;
let screen: ReactTestRenderer.ReactTestRenderer;

const Probe = ({ options }: { options: UseAiCommandSuggestionsOptions }) => {
  const res = useAiCommandSuggestions(options);
  latest = res;
  useEffect(() => {
    latest = res;
  });
  return null;
};

const OPTIONS: UseAiCommandSuggestionsOptions = {
  deviceId: 'dev-1',
  cwd: '/tmp/proj',
  sessionId: 'term_t1',
};

const renderProbe = async () => {
  await act(async () => {
    screen = ReactTestRenderer.create(<Probe options={OPTIONS} />);
  });
};

const speak = (event: Parameters<typeof dispatchCommandGenEvent>[0]) =>
  act(() => {
    dispatchCommandGenEvent(event);
  });

beforeEach(() => jest.clearAllMocks());
afterEach(() =>
  act(async () => {
    screen.unmount();
    latest = null;
  }),
);

describe('useAiCommandSuggestions 断连恢复(commandGen WS 推结果)', () => {
  it('POST 被掐断后进入恢复态,经 WS runFinished 恢复结果,不报错也不重发请求', async () => {
    genMock.mockImplementation(
      () =>
        new Promise((_, rej) =>
          setTimeout(() => rej(new TypeError('Network request failed')), 200),
        ),
    );
    await renderProbe();
    act(() => {
      latest!.submitText('帮我把这个服务跑起来');
    });
    expect(latest!.phase).toBe('generating');
    speak({ type: 'commandGen.runStarted', runId: 'r1' });
    speak({ type: 'commandGen.step', runId: 'r1', seq: 0, kind: 'tool_call', toolName: 'list_dir' });
    expect(latest!.progress).toMatchObject({ currentTool: 'list_dir', stepsDone: 0 });
    await act(async () => {
      jest.advanceTimersByTime(200); // POST 死(云端代理掐空闲连接)
    });
    expect(latest!.phase).toBe('recovering');
    expect(genMock).toHaveBeenCalledTimes(1); // 不自动重发,避免重复烧一遍 run
    speak({
      type: 'commandGen.runFinished',
      runId: 'r1',
      status: 'converged',
      finalCommand: 'npm run server',
      dangerous: false,
    });
    expect(latest!.phase).toBe('idle');
    expect(latest!.errorText).toBe('');
    expect(latest!.chips.map(c => c.command)).toContain('npm run server');
  });

  it('runFinished 先于 POST 断连到达 → 恢复态立即用已收结果收尾', async () => {
    genMock.mockImplementation(
      () =>
        new Promise((_, rej) =>
          setTimeout(() => rej(new TypeError('Network request failed')), 50),
        ),
    );
    await renderProbe();
    act(() => {
      latest!.submitText('看看状态');
    });
    act(() => {
      dispatchCommandGenEvent({ type: 'commandGen.runStarted', runId: 'r4' });
      dispatchCommandGenEvent({
        type: 'commandGen.runFinished',
        runId: 'r4',
        status: 'converged',
        finalCommand: 'echo hi',
        dangerous: false,
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    expect(latest!.phase).toBe('idle');
    expect(latest!.chips.some(c => c.command === 'echo hi')).toBe(true);
  });

  it('恢复窗口内 WS 也无事件 → 30s 看门狗落地为错误态', async () => {
    genMock.mockImplementation(
      () =>
        new Promise((_, rej) =>
          setTimeout(() => rej(new TypeError('Network request failed')), 10),
        ),
    );
    await renderProbe();
    act(() => {
      latest!.submitText('看看状态');
    });
    speak({ type: 'commandGen.runStarted', runId: 'r2' });
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    expect(latest!.phase).toBe('recovering');
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(latest!.phase).toBe('error');
  });

  it('服务端明确回错(限流等 ApiResponseError)不进恢复态,直接报错', async () => {
    genMock.mockImplementation(
      () =>
        new Promise((_, rej) =>
          setTimeout(
            () => rej(new ApiResponseError('rate_limited', 429, 'rate_limited')),
            10,
          ),
        ),
    );
    await renderProbe();
    act(() => {
      latest!.submitText('看看状态');
    });
    speak({ type: 'commandGen.runStarted', runId: 'r3' });
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    expect(latest!.phase).toBe('error');
  });

  it('恢复期步事件继续喂进度;reset() 丢弃悬挂恢复,可立刻重新开始', async () => {
    genMock.mockImplementation(
      () =>
        new Promise((_, rej) =>
          setTimeout(() => rej(new TypeError('Network request failed')), 10),
        ),
    );
    await renderProbe();
    act(() => {
      latest!.submitText('看看状态');
    });
    speak({ type: 'commandGen.runStarted', runId: 'r5' });
    speak({ type: 'commandGen.step', runId: 'r5', seq: 1, kind: 'tool_result', toolName: 'list_dir' });
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    expect(latest!.phase).toBe('recovering');
    speak({ type: 'commandGen.step', runId: 'r5', seq: 2, kind: 'tool_call', toolName: 'read_file' });
    expect(latest!.progress).toMatchObject({ stepsDone: 1, currentTool: 'read_file' });
    act(() => {
      latest!.reset();
    });
    expect(latest!.phase).toBe('idle');
    act(() => {
      latest!.submitText('再试一次');
    });
    expect(latest!.phase).toBe('generating');
    expect(genMock).toHaveBeenCalledTimes(2);
  });
});

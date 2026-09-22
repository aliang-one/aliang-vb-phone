/**
 * usePublishedVibeRun — 聊天屏对"被查看会话"的发布节流门。
 *
 * 流式期间每个 100ms flush 都会给被查看会话新对象身份(useVibeRun 用
 * Object.is 比较),3700 行的屏幕组件体因此以 ≤10Hz 全量重跑。transcript
 * 派生链路早已用 useThrottledValue 收敛到 5Hz,但屏幕体本身没有。此 hook
 * 把"发布"也节流到同一节拍:活跃(queued/running/cancelling)时 ≤5Hz,
 * 非活跃/终止立即发布(settle、失败、等待审批的翻面零延迟)。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../../../store/controlCenterStore', () => {
  const store = Object.assign(jest.fn(), {
    getState: jest.fn(),
    setState: jest.fn(),
    subscribe: jest.fn(),
  });
  return {
    useControlCenterStore: store,
    // 真实 useVibeRun 的 selector 语义(vibeRuns.find + Object.is 比较)。
    useVibeRun: (sessionId: string | undefined) =>
      store((state: { vibeRuns: Array<{ id: string }> }) =>
        sessionId
          ? state.vibeRuns.find(run => run.id === sessionId)
          : undefined,
      ),
  };
});

import { useControlCenterStore } from '../../../store/controlCenterStore';
import {
  usePublishedVibeRun,
  LIVE_SESSION_PUBLISH_MS,
} from '../usePublishedVibeRun';
import type { VibeCodingRun } from '../../../data/platformModels';

const mockedStore = useControlCenterStore as unknown as jest.Mock;

const makeRun = (over: Partial<VibeCodingRun>): VibeCodingRun =>
  ({
    id: 'a',
    title: 'A',
    status: 'running',
    risk: 'medium',
    model: 'glm-5.3',
    modelConfigVersion: 1,
    updatedAt: '',
    transcript: [],
    events: [],
    structuredEvents: [],
    suggestions: [],
    branch: '',
    currentStep: '',
    objective: '',
    directory: '',
    projectId: '',
    ...over,
  }) as VibeCodingRun;

/** Minimal store stub: vibeRuns array + useSyncExternalStore plumbing. */
const seedRuns = (runs: VibeCodingRun[]) => {
  let listeners: Array<() => void> = [];
  const state = { vibeRuns: runs };
  mockedStore.mockImplementation((selector: (s: typeof state) => unknown) => {
    const useSyncExternalStore = React.useSyncExternalStore;
    // Selector runs on every store tick; re-render when its result changes.
    const subscribe = (cb: () => void) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter(l => l !== cb);
      };
    };
    return useSyncExternalStore(
      subscribe,
      () => selector(state),
      () => selector(state),
    );
  });
  return {
    update(next: VibeCodingRun[]) {
      state.vibeRuns = next;
      listeners.forEach(l => l());
    },
  };
};

let renderCount = 0;
let lastPublished: VibeCodingRun | undefined;

const Host: React.FC<{ sessionId: string | undefined }> = ({ sessionId }) => {
  renderCount += 1;
  lastPublished = usePublishedVibeRun(sessionId);
  return <Text>{lastPublished?.status ?? 'none'}</Text>;
};

describe('usePublishedVibeRun', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    renderCount = 0;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('活跃会话:store 身份翻转被合流,LIVE_SESSION_PUBLISH_MS 内不发布', () => {
    const store = seedRuns([makeRun({ id: 'a', status: 'running' })]);
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Host sessionId="a" />);
    });
    expect(lastPublished?.status).toBe('running');

    // 100ms flush:新身份、内容变化(step 更新)。
    act(() => {
      store.update([makeRun({ id: 'a', status: 'running', currentStep: 'step-2' })]);
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    // 未到发布窗口:屏幕仍看到旧对象。
    expect(lastPublished?.currentStep).toBe('');

    act(() => {
      jest.advanceTimersByTime(LIVE_SESSION_PUBLISH_MS);
    });
    // 窗口到:最新值发布。
    expect(lastPublished?.currentStep).toBe('step-2');
    renderer.unmount();
  });

  test('非活跃会话:身份翻转立即发布(0ms 门)', () => {
    const store = seedRuns([makeRun({ id: 'a', status: 'idle' })]);
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Host sessionId="a" />);
    });

    act(() => {
      store.update([makeRun({ id: 'a', status: 'idle', currentStep: 'done-x' })]);
      jest.advanceTimersByTime(0);
    });
    expect(lastPublished?.currentStep).toBe('done-x');
    renderer.unmount();
  });

  test('settle 翻面:running→idle 立即发布,不拖尾 200ms', () => {
    const store = seedRuns([makeRun({ id: 'a', status: 'running' })]);
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Host sessionId="a" />);
    });

    // 回合结束:settle 广播把 status 翻成 idle。
    act(() => {
      store.update([makeRun({ id: 'a', status: 'idle', currentStep: 'final' })]);
      jest.advanceTimersByTime(0);
    });
    expect(lastPublished?.status).toBe('idle');
    expect(lastPublished?.currentStep).toBe('final');
    renderer.unmount();
  });

  test('订阅不存在的会话:稳定返回 undefined,不抖动', () => {
    seedRuns([makeRun({ id: 'b' })]);
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Host sessionId="a" />);
    });
    expect(lastPublished).toBeUndefined();
    renderer.unmount();
  });
});

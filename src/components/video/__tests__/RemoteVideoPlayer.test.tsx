// Spike 验证:RemoteVideoPlayer 包装 react-native-video v7(player/view 分离)。
// v7 是 Nitro/Fabric 原生视图,jest 里由 jest.setup.js 全局 stub;
// 这里只验证我们的包装层:props 透传、player 创建、onError 事件接线。
// React 19 下 react-test-renderer 的挂载/更新必须包 act(),否则被调度不执行。
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { RemoteVideoPlayer } from '../RemoteVideoPlayer';

const rnvMock = () =>
  jest.requireMock('react-native-video') as {
    useVideoPlayer: jest.Mock;
  };
const mockState = () =>
  (global as Record<string, unknown>).__rnvVideoMock as {
    mockPlayer: { addEventListener: jest.Mock; __emit: (e: string, p?: unknown) => void };
    renderedProps: Array<Record<string, unknown>>;
  };

const mount = (ui: React.ReactElement) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(ui);
  });
  return renderer;
};

beforeEach(() => {
  rnvMock().useVideoPlayer.mockClear();
  mockState().renderedProps.length = 0;
});

it('用 uri 创建 player,并把 player/controls/resizeMode 透传给 VideoView', () => {
  const renderer = mount(
    <RemoteVideoPlayer uri="https://cos.example.com/dl/a.mp4" />,
  );

  expect(rnvMock().useVideoPlayer).toHaveBeenCalledWith({
    uri: 'https://cos.example.com/dl/a.mp4',
  });
  const viewProps = mockState().renderedProps[0];
  expect(viewProps?.player).toBe(mockState().mockPlayer);
  expect(viewProps?.controls).toBe(true);
  expect(viewProps?.resizeMode).toBe('contain');

  renderer.unmount();
});

it('player onError 事件触发组件 onError 回调', () => {
  const onError = jest.fn();
  const renderer = mount(
    <RemoteVideoPlayer uri="https://cos.example.com/bad.mp4" onError={onError} />,
  );

  act(() => {
    mockState().mockPlayer.__emit('onError', { message: 'unsupported codec' });
  });
  expect(onError).toHaveBeenCalledWith('unsupported codec');

  renderer.unmount();
});

it('status 进入 error 态同样触发 onError 回调', () => {
  const onError = jest.fn();
  const renderer = mount(
    <RemoteVideoPlayer uri="https://cos.example.com/bad.mp4" onError={onError} />,
  );

  act(() => {
    mockState().mockPlayer.__emit('onStatusChange', 'error');
  });
  expect(onError).toHaveBeenCalledWith('player entered error state');

  renderer.unmount();
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { TopAppBar } from '../src/components/layout/TopAppBar';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: jest.fn(),
    navigate: jest.fn(),
  }),
}));

// create() 必须包在 act() 里且 .root 在 act 完成后取(React 19 并发渲染,
// act 内首帧未提交),仓库惯例同 ProjectPortsScreen.test。
const render = (ui: React.ReactElement) => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{
          theme: utilityMinimalist,
          mode: 'dark',
          setMode: () => {},
          isDark: true,
        }}>
        {ui}
      </ThemeContext.Provider>,
    );
  });
  return renderer.root;
};

// 顶栏标题/副标题(设备名等)过长时必须单行省略,不挤占右侧状态区。
describe('TopAppBar long-text truncation', () => {
  const longDeviceName = 'MacBook-Pro-of-a-very-long-device-name-that-keeps-going';

  const findTextWithContent = (
    root: ReactTestRenderer.ReactTestInstance,
    content: string,
  ) =>
    root
      .findAllByType(Text)
      .find(node => {
        const children = node.props.children;
        return typeof children === 'string' && children === content;
      });

  it('truncates an over-long subtitle (device name) to one line with ellipsis', () => {
    const root = render(
      <TopAppBar
        title="my-project"
        subtitle={longDeviceName}
        onBack={() => {}}
        rightAction={<View />}
      />,
    );
    const subtitleNode = findTextWithContent(root, longDeviceName);
    expect(subtitleNode).toBeDefined();
    expect(subtitleNode!.props.numberOfLines).toBe(1);
    expect(subtitleNode!.props.ellipsizeMode).toBe('tail');
  });

  it('truncates the title to one line with ellipsis', () => {
    const longTitle = 'an-extremely-long-project-or-session-title-goes-here-too';
    const root = render(
      <TopAppBar
        title={longTitle}
        subtitle="device"
        onBack={() => {}}
        rightAction={<View />}
      />,
    );
    const titleNode = findTextWithContent(root, longTitle);
    expect(titleNode).toBeDefined();
    expect(titleNode!.props.numberOfLines).toBe(1);
    expect(titleNode!.props.ellipsizeMode).toBe('tail');
  });

  it('constrains the left block to shrink and keeps the right cluster at fixed width', () => {
    const root = render(
      <TopAppBar
        title="my-project"
        subtitle={longDeviceName}
        onBack={() => {}}
        rightAction={<View testID="right-cluster" />}
      />,
    );
    const flatten = (node: ReactTestRenderer.ReactTestInstance) => {
      const style = node.props.style;
      const flat: Record<string, unknown> = {};
      const walk = (s: unknown) => {
        if (!s) return;
        if (Array.isArray(s)) {
          s.forEach(walk);
          return;
        }
        Object.assign(flat, s as Record<string, unknown>);
      };
      walk(style);
      return flat;
    };
    const rightCluster = root.findByProps({ testID: 'right-cluster' });
    const rightWrapper = rightCluster.parent;
    expect(rightWrapper).toBeDefined();
    expect(flatten(rightWrapper!).flexShrink).toBe(0);

    const titleNode = findTextWithContent(root, 'my-project');
    const titleBlock = titleNode!.parent;
    expect(titleBlock).toBeDefined();
    expect(flatten(titleBlock!).flexShrink).toBe(1);
  });
});

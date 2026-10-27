/**
 * 默认模型卡:四项(provider/model/effort/context)各自独立全局默认的
 * UI 契约(2026-10-28 用户拍板,配套删掉独立的「默认上下文」卡):
 *   - provider 可以不设(「未设置」芯片),未设保存 → null;
 *   - model/effort 留空保存 → null(该项回内置默认);
 *   - context_window 随保存始终下发(它是这张卡唯一的设置入口);
 *   - 切 provider 芯片不再顺手清掉 effort(逐字段独立)。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Pressable, Text, TextInput, TouchableOpacity } from 'react-native';
import { UserModelDefaultCard } from '../UserModelDefaultCard';
import { putUserModelDefault } from '../../../api/modelConfig';

const mockUserDefault: Record<string, unknown> = {
  provider: null,
  model: null,
  effort: null,
  context_window: null,
};

jest.mock('../../../api/modelConfig', () => ({
  putUserModelDefault: jest.fn(),
}));

jest.mock('../../../hooks/useModelOptions', () => ({
  refreshModelOptions: jest.fn(),
  catalogEffortOptions: () => [
    { label: '默认', value: '' },
    { label: 'high', value: 'high' },
  ],
  useModelOptions: () => ({
    providerCatalog: [],
    userDefault: mockUserDefault,
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

jest.mock('../../shared/GlassPanel', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    GlassPanel: (props: { children?: React.ReactNode }) =>
      React.createElement(View, null, props.children),
  };
});
jest.mock('../../shared/GlowButton', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    GlowButton: (props: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
    }) =>
      React.createElement(
        Pressable,
        {
          testID: 'save-btn',
          onPress: props.disabled ? undefined : props.onPress,
        },
        React.createElement(Text, null, props.title),
      ),
  };
});
jest.mock('../../shared/ContextWindowSlider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ContextWindowSlider: () => React.createElement(View, { testID: 'ctx-slider' }),
  };
});

const putMock = putUserModelDefault as jest.Mock;

const renderCard = async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<UserModelDefaultCard />);
  });
  return renderer;
};

const textButton = (renderer: TestRenderer.ReactTestRenderer, label: string) =>
  [
    ...renderer.root.findAllByType(TouchableOpacity),
    ...renderer.root.findAllByType(Pressable),
  ]
    .find(p =>
      p.findAllByType(Text).some(t => String(t.props.children) === label),
    );

const modelInput = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findByType(TextInput);

// 保存键:GlowButton stub 的复合 Pressable 在 RN preset 下 findAllByType
// 匹配不到,按 testID 才稳。
const saveButton = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(
    node =>
      node.props?.testID === 'save-btn' &&
      typeof node.props?.onPress === 'function',
  )[0];

// 卡默认折叠;按 a11y 标签找 header 按钮展开。
const expandCard = async (renderer: TestRenderer.ReactTestRenderer) => {
  const header = renderer.root.findAll(
    node =>
      node.props?.accessibilityLabel === '展开默认模型配置' &&
      typeof node.props?.onPress === 'function',
  )[0];
  await act(async () => {
    header.props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockUserDefault, {
    provider: null,
    model: null,
    effort: null,
    context_window: null,
  });
  putMock.mockImplementation(input =>
    Promise.resolve({ ...input, context_window: input.context_window ?? null }),
  );
});

describe('默认模型卡:逐字段独立全局默认', () => {
  it('provider 未设置时出现「未设置」芯片;保存 payload 四项独立(model 留空→null,context 恒下发)', async () => {
    const renderer = await renderCard();
    await expandCard(renderer);
    expect(textButton(renderer, '未设置')).toBeTruthy();

    await act(async () => {
      modelInput(renderer).props.onChangeText('glm-5.2');
    });
    await act(async () => {
      await saveButton(renderer).props.onPress();
    });

    expect(putMock).toHaveBeenCalledWith({
      provider: null,
      model: 'glm-5.2',
      effort: null,
      context_window: 200_000,
    });

    act(() => renderer.unmount());
  });

  it('已有 effort 时切 provider 芯片,effort 草稿不被清掉(逐字段独立)', async () => {
    Object.assign(mockUserDefault, { provider: null, effort: 'high' });
    const renderer = await renderCard();
    await expandCard(renderer);

    await act(async () => {
      textButton(renderer, 'Codex')!.props.onPress();
    });
    await act(async () => {
      await saveButton(renderer).props.onPress();
    });

    expect(putMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'codex', effort: 'high' }),
    );

    act(() => renderer.unmount());
  });
});

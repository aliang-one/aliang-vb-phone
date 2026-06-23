import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProjectModelSelectionCard } from '../src/components/devices/ProjectModelOverrideCard';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { putProjectModelConfig } from '../src/api/modelConfig';

jest.mock('../src/api/modelConfig', () => ({
  putProjectModelConfig: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/hooks/useModelOptions', () => ({
  useModelOptions: () => ({
    providerCatalog: [
      {
        provider: 'codex',
        models: [],
        efforts: [
          { label: '默认', value: '' },
          { label: 'xhigh', value: 'xhigh' },
        ],
      },
      {
        provider: 'claude_code',
        models: [],
        efforts: [
          { label: '默认', value: '' },
          { label: 'max', value: 'max' },
        ],
      },
    ],
    serverDefault: { provider: null, model: null, effort: null },
  }),
  catalogEffortOptions: (
    provider: 'codex' | 'claude_code',
    catalog: Array<{
      provider: 'codex' | 'claude_code';
      efforts: Array<{ label: string; value: string }>;
    }>,
  ) => catalog.find(item => item.provider === provider)?.efforts ?? [],
}));

const wrap = (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{
          theme: utilityMinimalist,
          mode: 'light',
          setMode: jest.fn(),
          isDark: false,
        }}
      >
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          }}
        >
          {ui}
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return renderer!;
};

const chipByLabel = (root: ReactTestRenderer.ReactTestRenderer, label: string) =>
  root.root.findAllByType(TouchableOpacity).find(button =>
    button
      .findAllByType(Text)
      .some(node => node.props.children === label),
  );

describe('ProjectModelSelectionCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves independent model and effort selections per provider tab', async () => {
    const root = wrap(<ProjectModelSelectionCard projectId="project-1" />);

    act(() => {
      root.root
        .findByProps({ testID: 'project-model-input-codex' })
        .props.onChangeText('gpt-5.2');
    });
    act(() => {
      chipByLabel(root, 'xhigh')!.props.onPress();
    });
    act(() => {
      root.root
        .findByProps({ testID: 'project-model-provider-claude_code' })
        .props.onPress();
    });
    act(() => {
      root.root
        .findByProps({ testID: 'project-model-input-claude_code' })
        .props.onChangeText('claude-sonnet-4-6');
    });
    act(() => {
      chipByLabel(root, 'max')!.props.onPress();
    });

    await act(async () => {
      await root.root.findByProps({ testID: 'project-model-save' }).props.onPress();
    });

    expect(putProjectModelConfig).toHaveBeenCalledWith('project-1', {
      provider: null,
      model: null,
      effort: null,
      model_config: {
        codex: { model: 'gpt-5.2', effort: 'xhigh' },
        claude_code: { model: 'claude-sonnet-4-6', effort: 'max' },
      },
    });
  });
});

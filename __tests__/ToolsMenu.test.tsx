import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Switch, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ToolsMenu } from '../src/components/vibecoding/ToolsMenu';
import type { AgentCommandInfo } from '../src/data/platformModels';
import { GOAL_UI_ENABLED } from '../src/config/featureFlags';

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

const textsIn = (node: ReactTestRenderer.ReactTestInstance) =>
  node.findAllByType(Text).map(t => String(t.props.children));

const chipByLabel = (root: ReactTestRenderer.ReactTestRenderer, label: string) =>
  root.root.findAllByType(TouchableOpacity).find(c =>
    textsIn(c).some(t => t === label),
  );

const claudeCommands: AgentCommandInfo[] = [
  { name: 'clear', description: '清空上下文', scope: 'builtin' },
  { name: 'compact', description: '压缩历史', scope: 'builtin' },
  { name: 'mycmd', description: '项目自定义', argHint: '<file>', scope: 'project' },
  {
    name: 'review-pr',
    description: '审查 PR',
    argHint: '<number>',
    scope: 'project',
    kind: 'skill',
  },
];

const defaultProps = (overrides: Partial<React.ComponentProps<typeof ToolsMenu>> = {}) => ({
  onClose: jest.fn(),
  model: 'Claude Code',
  provider: 'claude_code' as const,
  effort: '',
  commands: claudeCommands,
  onSaveSettings: jest.fn().mockResolvedValue(undefined),
  onInsertCommand: jest.fn(),
  ...overrides,
});

// GOAL_UI_ENABLED 关闭时 goal 开关整块不渲染;下面三条是开启该 flag 后的行为契约,
// 挂起而不删除,恢复 flag 后自动重新跑起来。
const goalIt = GOAL_UI_ENABLED ? it : it.skip;

const findByTestID = (root: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  root.root.findByProps({ testID });

describe('ToolsMenu', () => {
  it('renders the agent label and command rows for Claude Code', () => {
    const root = wrap(<ToolsMenu {...defaultProps()} />);
    const texts = root.root.findAllByType(Text).map(t => String(t.props.children));
    expect(texts.some(t => t.includes('Claude Code'))).toBe(true);
    // One tappable command row per discovered command.
    expect(() => findByTestID(root, 'tools-cmd-clear')).not.toThrow();
    expect(() => findByTestID(root, 'tools-cmd-compact')).not.toThrow();
    expect(() => findByTestID(root, 'tools-cmd-mycmd')).not.toThrow();
    expect(() => findByTestID(root, 'tools-cmd-review-pr')).not.toThrow();
    expect(texts.some(t => t === 'Skills')).toBe(true);
    expect(texts.some(t => t === '内置命令')).toBe(true);
  });

  // GOAL_UI_ENABLED 关闭:面板里不再出现 goal 开关(新建 goal 的入口)。
  // 下面三条是开启该 flag 后的行为契约,暂时 skip,恢复时一并取消 skip。
  it('does not render the Goal toggle while the goal UI is disabled', () => {
    const root = wrap(<ToolsMenu {...defaultProps()} />);
    expect(() => findByTestID(root, 'tools-goal-toggle')).toThrow();
  });

  goalIt('switches into Goal draft mode from the same panel as model and effort', () => {
    const onGoalModeChange = jest.fn();
    const onClose = jest.fn();
    const root = wrap(
      <ToolsMenu {...defaultProps({ onGoalModeChange, onClose })} />,
    );
    act(() => findByTestID(root, 'tools-goal-toggle').props.onValueChange(true));
    expect(onGoalModeChange).toHaveBeenCalledWith('draft');
    expect(onClose).not.toHaveBeenCalled();
    expect(root.root.findAllByType(TextInput).length).toBeGreaterThan(0);
  });

  goalIt('can switch an unsent Goal draft back off without closing tools', () => {
    const onGoalModeChange = jest.fn();
    const onClose = jest.fn();
    const root = wrap(
      <ToolsMenu {...defaultProps({ goalMode: 'draft', onGoalModeChange, onClose })} />,
    );
    act(() => findByTestID(root, 'tools-goal-toggle').props.onValueChange(false));
    expect(onGoalModeChange).toHaveBeenCalledWith('ordinary');
    expect(onClose).not.toHaveBeenCalled();
  });

  goalIt('keeps the Goal toggle on and locked inside a created Goal session', () => {
    const onGoalModeChange = jest.fn();
    const root = wrap(
      <ToolsMenu {...defaultProps({ goalMode: 'active', onGoalModeChange })} />,
    );
    const goalToggle = findByTestID(root, 'tools-goal-toggle');
    expect(goalToggle.type).toBe(Switch);
    expect(goalToggle.props.disabled).toBe(true);
    expect(goalToggle.props.value).toBe(true);
  });

  it('hides Skills that are not user-invocable', () => {
    const root = wrap(
      <ToolsMenu
        {...defaultProps({
          commands: [
            ...claudeCommands,
            { name: 'background-only', kind: 'skill', userInvocable: false },
          ],
        })}
      />,
    );
    expect(() => findByTestID(root, 'tools-cmd-background-only')).toThrow();
  });

  it('inserts a command as editable text (with leading slash + arg hint) and closes', () => {
    const onClose = jest.fn();
    const onInsertCommand = jest.fn();
    const root = wrap(
      <ToolsMenu
        {...defaultProps({ onClose, onInsertCommand })}
      />,
    );
    act(() => {
      findByTestID(root, 'tools-cmd-mycmd').props.onPress();
    });
    // argHint is appended; slash is prepended.
    expect(onInsertCommand).toHaveBeenCalledWith('/mycmd <file>');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the Codex label and the empty state when no commands are reported', () => {
    const root = wrap(
      <ToolsMenu
        {...defaultProps({ provider: 'codex', commands: [] })}
      />,
    );
    const texts = root.root.findAllByType(Text).map(t => String(t.props.children));
    expect(texts.some(t => t.includes('Codex'))).toBe(true);
    // Honest empty state — the phone is a pure renderer of agent data.
    expect(texts.some(t => t.includes('暂未上报'))).toBe(true);
    expect(() => findByTestID(root, 'tools-cmd-clear')).toThrow();
  });

  it('renders provider-aware effort presets (codex ladder vs claude ladder)', () => {
    // Codex ladder: low/medium/high/xhigh (no max, no ultracode).
    const codexRoot = wrap(<ToolsMenu {...defaultProps({ provider: 'codex' })} />);
    expect(chipByLabel(codexRoot, 'xhigh')).toBeTruthy();
    expect(chipByLabel(codexRoot, 'max')).toBeUndefined();
    expect(chipByLabel(codexRoot, 'ultracode')).toBeUndefined();

    // Claude ladder: low/medium/high/xhigh/max/ultracode (xhigh + max + ultracode all present).
    const claudeRoot = wrap(<ToolsMenu {...defaultProps({ provider: 'claude_code' })} />);
    expect(chipByLabel(claudeRoot, 'xhigh')).toBeTruthy();
    expect(chipByLabel(claudeRoot, 'max')).toBeTruthy();
    expect(chipByLabel(claudeRoot, 'ultracode')).toBeTruthy();
  });

  it('persists a CLEAN model name and separate effort on save', async () => {
    const onSaveSettings = jest.fn().mockResolvedValue(undefined);
    const root = wrap(
      <ToolsMenu
        {...defaultProps({
          provider: 'claude_code',
          model: 'Claude Code',
          onSaveSettings,
        })}
      />,
    );
    act(() => {
      chipByLabel(root, 'glm-5.2')!.props.onPress();
    });
    act(() => {
      chipByLabel(root, 'xhigh')!.props.onPress();
    });
    await act(async () => {
      await chipByLabel(root, '保存')!.props.onPress();
    });
    // Model is sent CLEAN (no -xhigh suffix); effort is a separate field.
    expect(onSaveSettings).toHaveBeenCalledWith({
      model: 'glm-5.2',
      effort: 'xhigh',
    });
  });

  it('initializes drafts from a stored model+intensity string and seeds effort', () => {
    // Legacy baked model "glm-5.2-xhigh" -> base "glm-5.2" pre-fills the model
    // input AND seeds the effort draft to "xhigh" (active effort chip).
    const root = wrap(
      <ToolsMenu
        {...defaultProps({ provider: 'codex', model: 'glm-5.2-xhigh' })}
      />,
    );
    // 上下文滑杆也是 TextInput，按 testID 取模型输入框，别按类型取。
    const modelInput = findByTestID(root, 'tools-model-input');
    expect(modelInput.props.value).toBe('glm-5.2');
    // The xhigh effort chip is the active (seeded) one.
    expect(() => findByTestID(root, 'tools-effort-xhigh')).not.toThrow();
  });

  it('shows current and next profiles while keeping Goal settings read-only', () => {
    const onSaveSettings = jest.fn();
    const root = wrap(
      <ToolsMenu
        {...defaultProps({
          activeExecutionLabel: 'model=gpt-old · effort=medium · v2',
          effectiveLabel: 'model=gpt-new · effort=high',
          settingsEditable: false,
          onSaveSettings,
        })}
      />,
    );
    const texts = root.root.findAllByType(Text).map(item => String(item.props.children));
    expect(texts).toContain('本轮实际');
    expect(texts).toContain('下轮配置');
    expect(texts.some(item => item.includes('Goal 的执行配置在创建时固定'))).toBe(true);
    expect(root.root.findAllByType(TextInput)).toHaveLength(0);
    expect(chipByLabel(root, '保存')).toBeUndefined();
    expect(onSaveSettings).not.toHaveBeenCalled();
  });

  it('greys out effort chips the device does not support (supportedEfforts prop)', () => {
    const root = wrap(
      <ToolsMenu
        {...defaultProps({
          provider: 'claude_code',
          supportedEfforts: ['low', 'high'],
        })}
      />,
    );
    // Unsupported ladder tiers are disabled.
    expect(findByTestID(root, 'tools-effort-ultracode').props.disabled).toBe(true);
    expect(findByTestID(root, 'tools-effort-max').props.disabled).toBe(true);
    expect(findByTestID(root, 'tools-effort-xhigh').props.disabled).toBe(true);
    expect(findByTestID(root, 'tools-effort-medium').props.disabled).toBe(true);
    // Supported tiers + 默认 stay enabled.
    expect(findByTestID(root, 'tools-effort-high').props.disabled).toBeFalsy();
    expect(findByTestID(root, 'tools-effort-low').props.disabled).toBeFalsy();
    expect(findByTestID(root, 'tools-effort-default').props.disabled).toBeFalsy();
  });

  it('all effort chips enabled when supportedEfforts is not supplied', () => {
    const root = wrap(<ToolsMenu {...defaultProps({ provider: 'claude_code' })} />);
    expect(findByTestID(root, 'tools-effort-ultracode').props.disabled).toBeFalsy();
    expect(findByTestID(root, 'tools-effort-max').props.disabled).toBeFalsy();
  });

  it('clamps the saved effort to the device-supported ladder', async () => {
    const onSaveSettings = jest.fn().mockResolvedValue(undefined);
    const root = wrap(
      <ToolsMenu
        {...defaultProps({
          provider: 'claude_code',
          // Session carries ultracode from before the CLI was downgraded.
          effort: 'ultracode',
          supportedEfforts: ['low', 'high'],
          onSaveSettings,
        })}
      />,
    );
    // Dirty the form via a model chip so the save button activates.
    act(() => {
      chipByLabel(root, 'glm-5.2')!.props.onPress();
    });
    await act(async () => {
      chipByLabel(root, '保存')!.props.onPress();
    });
    // ultracode → (max/xhigh unsupported) → high along the global ladder.
    expect(onSaveSettings).toHaveBeenCalledWith({
      model: 'glm-5.2',
      effort: 'high',
    });
  });
});

describe('ToolsMenu · 本会话上下文窗口', () => {
  // findByProps 会先撞到复合组件那一层（没有 accessibilityValue），
  // 取真正带无障碍值的那个宿主节点。
  const sliderValue = (root: ReactTestRenderer.ReactTestRenderer) =>
    root.root.findAll(
      node =>
        node.props?.testID === 'tools-context-slider' &&
        typeof node.props?.accessibilityValue?.text === 'string',
    )[0].props.accessibilityValue as { text: string };

  it('未设置时按默认 200k 显示（与 server 默认一致）', () => {
    const root = wrap(<ToolsMenu {...defaultProps()} />);
    expect(sliderValue(root).text).toBe('200k');
  });

  it('传入会话已存的 contextWindow 时按它显示', () => {
    const root = wrap(<ToolsMenu {...defaultProps({ contextWindow: 500_000 })} />);
    expect(sliderValue(root).text).toBe('500k');
  });

  it('只改模型 → 保存不带 contextWindow（不把默认值盖进会话）', async () => {
    const onSaveSettings = jest.fn().mockResolvedValue(undefined);
    const root = wrap(<ToolsMenu {...defaultProps({ onSaveSettings })} />);

    act(() => {
      findByTestID(root, 'tools-model-input').props.onChangeText('glm-5.2');
    });
    await act(async () => {
      await chipByLabel(root, '保存')!.props.onPress();
    });

    const payload = onSaveSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty('model', 'glm-5.2');
    expect(payload).not.toHaveProperty('contextWindow');
  });

  it('改了就随保存一起提交（K 输入框 → token 数）', async () => {
    const onSaveSettings = jest.fn().mockResolvedValue(undefined);
    const root = wrap(<ToolsMenu {...defaultProps({ onSaveSettings })} />);

    const input = findByTestID(root, 'tools-context-slider-input');
    act(() => {
      input.props.onChangeText('400');
    });
    act(() => {
      input.props.onSubmitEditing();
    });
    expect(sliderValue(root).text).toBe('400k');

    await act(async () => {
      await chipByLabel(root, '保存')!.props.onPress();
    });

    expect(onSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ contextWindow: 400_000 }),
    );
  });
});

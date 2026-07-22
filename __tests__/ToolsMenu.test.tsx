import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Switch, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ToolsMenu } from '../src/components/vibecoding/ToolsMenu';
import type { AgentCommandInfo } from '../src/data/platformModels';

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

  it('switches into Goal draft mode from the same panel as model and effort', () => {
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

  it('can switch an unsent Goal draft back off without closing tools', () => {
    const onGoalModeChange = jest.fn();
    const onClose = jest.fn();
    const root = wrap(
      <ToolsMenu {...defaultProps({ goalMode: 'draft', onGoalModeChange, onClose })} />,
    );
    act(() => findByTestID(root, 'tools-goal-toggle').props.onValueChange(false));
    expect(onGoalModeChange).toHaveBeenCalledWith('ordinary');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the Goal toggle on and locked inside a created Goal session', () => {
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
    const modelInput = root.root.findByType(TextInput);
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
});

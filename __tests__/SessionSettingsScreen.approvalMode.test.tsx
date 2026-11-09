import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

/**
 * 会话审批挡位只读展示(approval_mode)。
 *
 * 概念区分(勿混淆):approval_mode 是**内核审批挡位**(''/'ask_all'/'bypass_all',
 * 手机端只读,undefined=默认推荐),≠ 已有的 approvalScheme(allow_all/ask_all/
 * read_only 会话权限策略,创建页可编辑)。文案用 sessionSettings.approval* 新键,
 * 绝不复用 create.permissions.approval.*。
 */
const mockSession: Record<string, unknown> = {
  id: 'sess-1',
  deviceId: 'dev-1',
  provider: 'claude_code',
  model: 'glm-5.2',
  effort: 'high',
  effectiveModelConfig: {
    provider: 'claude_code',
    model: 'glm-5.2',
    effort: 'high',
    contextWindow: 200_000,
    source: { model: 'session', effort: 'session' },
  },
  approvalMode: undefined,
};

const mockDevices = [{ id: 'dev-1', name: 'MacBook', tools: [] as unknown[] }];
const mockUpdateAgentSession = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/store/controlCenterStore', () => ({
  useControlCenterStore: (selector: (state: unknown) => unknown) =>
    selector({
      vibeRuns: [mockSession],
      devices: mockDevices,
      projects: [],
      updateAgentSession: mockUpdateAgentSession,
    }),
  useDevice: (deviceId: string | undefined) =>
    deviceId ? mockDevices.find(device => device.id === deviceId) : undefined,
  useVibeRun: (sessionId: string | undefined) =>
    sessionId ? (mockSession.id === sessionId ? mockSession : undefined) : undefined,
}));

jest.mock('../src/hooks/useModelOptions', () => ({
  useModelOptions: () => ({
    providerCatalog: { codex: null, claude_code: null, opencode: null },
    userDefault: { provider: null, model: null, effort: null },
    refresh: jest.fn(),
  }),
  catalogEffortOptions: () => [
    { label: '默认', value: '' },
    { label: 'low', value: 'low' },
    { label: 'high', value: 'high' },
  ],
}));

jest.mock('../src/hooks/useRecentModelOptions', () => ({
  useRecentModelOptions: () => ({
    modelOptions: [{ label: 'GLM-5.2', value: 'glm-5.2' }],
    rememberModel: jest.fn(),
  }),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ params: { sessionId: 'sess-1' } }),
}));

import { SessionSettingsScreen } from '../src/screens/vibecoding/SessionSettingsScreen';

const theme = utilityMinimalist;

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeContext.Provider
    value={{ theme, mode: 'light', setMode: jest.fn(), isDark: false }}
  >
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

const wrap = async (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Providers>{ui}</Providers>);
    await Promise.resolve();
  });
  return renderer!;
};

const approvalChipByTestID = (
  root: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) => root.root.findAll(node => node.props?.testID === testID)[0];

/** 拍平某节点所有 style(含数组嵌套)后取到的完整样式对象集合。 */
const flatStyles = (node: ReactTestRenderer.ReactTestInstance) => {
  const flat: Array<Record<string, unknown>> = [];
  const walk = (style: unknown) => {
    if (!style) return;
    if (Array.isArray(style)) {
      style.forEach(walk);
      return;
    }
    if (typeof style === 'object') flat.push(style as Record<string, unknown>);
  };
  walk(node.props?.style);
  return flat;
};

const textsIn = (node: ReactTestRenderer.ReactTestInstance) =>
  node.findAllByType(Text).map(t => String(t.props.children));

const allTexts = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAllByType(Text).map(t => String(t.props.children));

describe('SessionSettingsScreen 审批挡位只读区块(approval_mode ≠ approvalScheme)', () => {
  afterEach(() => {
    mockSession.approvalMode = undefined;
  });

  it('approvalMode=bypass_all → 「放过所有」chip 高亮,且区块只读无编辑入口', async () => {
    mockSession.approvalMode = 'bypass_all';
    const root = await wrap(<SessionSettingsScreen />);
    const texts = allTexts(root);
    // 小标题与三个 chip 文案在场(zh 档,i18n 与 approvalScheme 文案显式区分;
    // 序号「3.」对齐同页 1.模型/2.工作强度 的既有惯例)。
    expect(texts).toContain('3. 审批挡位 APPROVAL');
    expect(texts).toContain('默认推荐');
    expect(texts).toContain('每次询问');
    expect(texts).toContain('放过所有');

    const activeChip = approvalChipByTestID(root, 'approval-chip-bypass_all');
    expect(activeChip).toBeTruthy();
    // 高亮 = 主色描边 + 主色文字(与 effort chip 同款视觉)。
    const chipStyles = flatStyles(activeChip!);
    expect(chipStyles.some(s => s.borderColor === theme.colors.primary)).toBe(true);
    const chipText = activeChip!.findAllByType(Text)[0];
    expect(flatStyles(chipText).some(s => s.color === theme.colors.primary)).toBe(true);
    // 非选中 chip 不高亮(描边用 outlineVariant,与 effort chip 同款视觉)。
    const askChip = approvalChipByTestID(root, 'approval-chip-ask_all');
    expect(
      flatStyles(askChip!).some(s => s.borderColor === theme.colors.outlineVariant),
    ).toBe(true);

    // 只读:三个 chip 都是 View(非 TouchableOpacity),无 onPress/disabled 编辑位。
    for (const testID of [
      'approval-chip-default',
      'approval-chip-ask_all',
      'approval-chip-bypass_all',
    ]) {
      const chip = approvalChipByTestID(root, testID);
      expect(chip).toBeTruthy();
      expect(chip!.type).toBe(View);
      expect(chip!.props.onPress).toBeUndefined();
      expect(chip!.props.disabled).toBeUndefined();
    }
    // 保险:全树没有任何 TouchableOpacity 承载审批文案(没有隐藏的编辑入口)。
    const editableApproval = root.root
      .findAllByType(TouchableOpacity)
      .filter(node => {
        const labels = textsIn(node);
        return ['默认推荐', '每次询问', '放过所有'].some(l => labels.includes(l));
      });
    expect(editableApproval).toHaveLength(0);
  });

  it('approvalMode 缺省(undefined)→ 「默认推荐」chip 高亮', async () => {
    const root = await wrap(<SessionSettingsScreen />);
    const activeChip = approvalChipByTestID(root, 'approval-chip-default');
    expect(activeChip).toBeTruthy();
    expect(
      flatStyles(activeChip!).some(s => s.borderColor === theme.colors.primary),
    ).toBe(true);
    expect(
      flatStyles(activeChip!.findAllByType(Text)[0]).some(
        s => s.color === theme.colors.primary,
      ),
    ).toBe(true);
    // 其余两档不高亮(描边 outlineVariant)。
    for (const testID of ['approval-chip-ask_all', 'approval-chip-bypass_all']) {
      const chip = approvalChipByTestID(root, testID);
      expect(
        flatStyles(chip!).some(s => s.borderColor === theme.colors.outlineVariant),
      ).toBe(true);
    }
  });

  it("approvalMode=''(显式默认推荐)→ 同样「默认推荐」高亮(三态保留:不得与缺键混淆后被困旧挡位)", async () => {
    mockSession.approvalMode = '';
    const root = await wrap(<SessionSettingsScreen />);
    const activeChip = approvalChipByTestID(root, 'approval-chip-default');
    expect(activeChip).toBeTruthy();
    expect(
      flatStyles(activeChip!).some(s => s.borderColor === theme.colors.primary),
    ).toBe(true);
    expect(
      flatStyles(approvalChipByTestID(root, 'approval-chip-bypass_all')!).some(
        s => s.borderColor === theme.colors.outlineVariant,
      ),
    ).toBe(true);
    mockSession.approvalMode = undefined;
  });

  it('只读 hint 在场(指向桌面端 composer 权限模式面板的说明文案)', async () => {
    const root = await wrap(<SessionSettingsScreen />);
    expect(allTexts(root)).toContain(
      '审批挡位在桌面端聊天输入框的「权限模式」面板切换，手机端只读展示。',
    );
  });

  it('effectiveLabel 拼接含审批片段(undefined→默认推荐文案)', async () => {
    const root = await wrap(<SessionSettingsScreen />);
    const labels = allTexts(root);
    const effectiveLine = labels.find(t => typeof t === 'string' && t.includes('model='));
    expect(effectiveLine).toBeTruthy();
    expect(effectiveLine!).toContain('· approval=默认推荐');
  });
});

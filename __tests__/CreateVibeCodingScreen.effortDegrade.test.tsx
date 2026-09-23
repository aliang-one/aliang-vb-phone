import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

// --- Mocks ---

// Effort-degrade coverage for the create flow. The device's tool entry carries
// the agent-reported effort list (new `efforts` field); the screen must grey
// out unsupported effort chips and auto-degrade the selection along the
// global ladder before it ever reaches draftConfig.
const mockDevices: Array<{
  id: string;
  name: string;
  status: string;
  online: boolean;
  tools: unknown[];
  projectIds: string[];
  authorizedDirectories: string[];
}> = [
  {
    id: 'dev-1',
    name: 'MacBook',
    status: 'online',
    online: true,
    tools: [],
    projectIds: [],
    authorizedDirectories: ['~/repo'],
  },
];
const mockProjects: unknown[] = [];
jest.mock('../src/store/controlCenterStore', () => ({
  useControlCenterStore: (selector: (state: unknown) => unknown) =>
    selector({
      devices: mockDevices,
      projects: mockProjects,
    }),
}));

const mockUserDefault: Record<string, unknown> = {
  provider: null,
  model: null,
  effort: null,
};
jest.mock('../src/hooks/useModelOptions', () => ({
  useModelOptions: () => ({
    providerCatalog: { codex: null, claude_code: null, opencode: null },
    userDefault: mockUserDefault,
    refresh: jest.fn(),
  }),
  // Full claude ladder so ultracode/max chips exist to be greyed out.
  catalogEffortOptions: () => [
    { label: '默认', value: '' },
    { label: 'low', value: 'low' },
    { label: 'medium', value: 'medium' },
    { label: 'high', value: 'high' },
    { label: 'xhigh', value: 'xhigh' },
    { label: 'max', value: 'max' },
    { label: 'ultracode', value: 'ultracode' },
  ],
}));

jest.mock('../src/hooks/useRecentModelOptions', () => ({
  useRecentModelOptions: () => ({
    modelOptions: [{ label: 'GLM-5.2', value: 'glm-5.2' }],
    rememberModel: jest.fn(),
  }),
}));

const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    replace: mockReplace,
    goBack: jest.fn(),
    navigate: jest.fn(),
    push: jest.fn(),
  }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: (_cb: () => void) => undefined,
}));

import { CreateVibeCodingScreen } from '../src/screens/vibecoding/CreateVibeCodingScreen';

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
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

const touchByTestID = (
  root: ReactTestRenderer.ReactTestInstance,
  testID: string,
) =>
  root.findAllByType(TouchableOpacity).find(c => c.props?.testID === testID);

const tap = (root: ReactTestRenderer.ReactTestInstance, testID: string) => {
  const btn = touchByTestID(root, testID);
  act(() => {
    (btn as { props: { onPress?: () => void } } | undefined)?.props?.onPress?.();
  });
};

/** Press the START VIBECODING GlowButton (found by its label text). */
const pressStart = (root: ReactTestRenderer.ReactTestInstance) => {
  const startTouch = root
    .findAllByType(TouchableOpacity)
    .find(c =>
      c.findAllByType(Text).some(t => String(t.props.children).includes('START VIBECODING')),
    );
  act(() => {
    (startTouch as { props: { onPress?: () => void } })?.props?.onPress?.();
  });
};

/** Start 后若弹出了确认 sheet,点其中的确认类按钮(场景化二选一存在)。 */
const confirmSheetIfOpen = (root: ReactTestRenderer.ReactTestInstance) => {
  const btn =
    touchByTestID(root, 'sheet-btn-confirm') ??
    touchByTestID(root, 'sheet-btn-start-anyway');
  if (btn) act(() => { btn.props.onPress?.(); });
};

const isChipSelected = (
  root: ReactTestRenderer.ReactTestInstance,
  testID: string,
) =>
  Boolean(touchByTestID(root, testID)?.props?.accessibilityState?.selected);

const chipOpacity = (
  root: ReactTestRenderer.ReactTestInstance,
  testID: string,
) => {
  const chip = touchByTestID(root, testID);
  const style = chip?.props?.style;
  const flat = Array.isArray(style) ? style : [style];
  const opacity = flat
    .map((s: { opacity?: number } | null | undefined) => s?.opacity)
    .find(v => v !== undefined);
  return opacity as number | undefined;
};

describe('CreateVibeCodingScreen effort degrade by device capability', () => {
  let root: ReactTestRenderer.ReactTestRenderer;

  beforeEach(() => {
    mockReplace.mockReset();
    Object.keys(mockUserDefault).forEach(k => delete mockUserDefault[k]);
    Object.assign(mockUserDefault, { provider: null, model: null, effort: null });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    mockDevices[0].tools = [];
  });

  it('unsupported effort chips are disabled at 0.35 opacity; supported + 默认 stay enabled', async () => {
    mockDevices[0].tools = [
      { id: 'claude', available: true, version: '2.1.156', efforts: ['low', 'high'] },
    ];
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'provider-chip-claude_code');
    // Ladder values not reported by the device are disabled + dimmed.
    const ultracode = touchByTestID(root.root, 'effort-chip-ultracode');
    expect(ultracode?.props.disabled).toBe(true);
    expect(chipOpacity(root.root, 'effort-chip-ultracode')).toBe(0.35);
    expect(touchByTestID(root.root, 'effort-chip-max')?.props.disabled).toBe(true);
    expect(touchByTestID(root.root, 'effort-chip-xhigh')?.props.disabled).toBe(true);
    expect(touchByTestID(root.root, 'effort-chip-medium')?.props.disabled).toBe(true);
    // Supported tiers + the 默认 (inherit) chip remain tappable.
    expect(touchByTestID(root.root, 'effort-chip-high')?.props.disabled).toBeFalsy();
    expect(touchByTestID(root.root, 'effort-chip-low')?.props.disabled).toBeFalsy();
    expect(touchByTestID(root.root, 'effort-chip-')?.props.disabled).toBeFalsy();
    // Enabled chips keep full opacity (mirrors the provider-chip pattern).
    expect(chipOpacity(root.root, 'effort-chip-high')).toBe(1);
  });

  it('all effort chips enabled when the agent has not reported efforts', async () => {
    mockDevices[0].tools = [{ id: 'claude', available: true }];
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'provider-chip-claude_code');
    expect(touchByTestID(root.root, 'effort-chip-ultracode')?.props.disabled).toBeFalsy();
    expect(touchByTestID(root.root, 'effort-chip-max')?.props.disabled).toBeFalsy();
    expect(chipOpacity(root.root, 'effort-chip-ultracode')).toBe(1);
  });

  it('auto-degrades the selected effort when the device capability arrives', async () => {
    // Capability 未上报前不设障:ultracode 可选且被选中。
    mockDevices[0].tools = [{ id: 'claude', available: true }];
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'provider-chip-claude_code');
    tap(root.root, 'effort-chip-ultracode');
    expect(isChipSelected(root.root, 'effort-chip-ultracode')).toBe(true);
    // Agent 上报 efforts=[low,high](快照/WS device.updated)→ 自动降级到 high。
    mockDevices[0].tools = [
      { id: 'claude', available: true, version: '2.1.156', efforts: ['low', 'high'] },
    ];
    await act(async () => {
      root.update(
        <Providers>
          <CreateVibeCodingScreen />
        </Providers>,
      );
    });
    expect(isChipSelected(root.root, 'effort-chip-high')).toBe(true);
    expect(isChipSelected(root.root, 'effort-chip-ultracode')).toBe(false);
    expect(touchByTestID(root.root, 'effort-chip-ultracode')?.props.disabled).toBe(true);
  });

  it('falls back to 默认 when no requested-able tier is supported', async () => {
    mockDevices[0].tools = [{ id: 'claude', available: true, efforts: ['custom_level'] }];
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'provider-chip-claude_code');
    // 所有阶梯档均不支持 → 唯一可点的非默认档是 custom(不在 catalog,不渲染),
    // 已选的空 effort(默认)保持可用。
    expect(touchByTestID(root.root, 'effort-chip-')?.props.disabled).toBeFalsy();
    // catalog 里所有阶梯 chip 全部置灰。
    for (const tier of ['ultracode', 'max', 'xhigh', 'high', 'medium', 'low']) {
      expect(touchByTestID(root.root, `effort-chip-${tier}`)?.props.disabled).toBe(true);
    }
  });

  it('draftConfig.effort is clamped to the supported ladder on create', async () => {
    // Capability 未上报时选中 ultracode,随后上报 efforts=[low,high]:
    // effect 降级 + startSession 组 draftConfig 前的钳制共同保证下发 high。
    mockDevices[0].tools = [{ id: 'claude', available: true }];
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'provider-chip-claude_code');
    tap(root.root, 'effort-chip-ultracode');
    mockDevices[0].tools = [
      { id: 'claude', available: true, version: '2.1.156', efforts: ['low', 'high'] },
    ];
    await act(async () => {
      root.update(
        <Providers>
          <CreateVibeCodingScreen />
        </Providers>,
      );
    });
    expect(isChipSelected(root.root, 'effort-chip-high')).toBe(true);
    tap(root.root, 'model-chip-glm-5.2'); // model+effort 都有值 → 直通
    pressStart(root.root);
    confirmSheetIfOpen(root.root);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const params = mockReplace.mock.calls[0][1];
    expect(params.draftConfig.provider).toBe('claude_code');
    expect(params.draftConfig.effort).toBe('high');
  });
});

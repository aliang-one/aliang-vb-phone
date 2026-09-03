import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

// --- Mocks ---

// controlCenterStore: feed a single online device + no projects so the screen
// renders in custom-path mode (no directory picker branching needed).
// capabilities/tunnelAvailable are optional so the port-mapping tests can opt
// the device into (or out of) tunnel capability per test.
const mockDevices: Array<{
  id: string;
  name: string;
  status: string;
  online: boolean;
  tools: unknown[];
  projectIds: string[];
  authorizedDirectories: string[];
  capabilities?: string[];
  tunnelAvailable?: boolean;
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
/** Opt the mock device into tunnel port forwarding (online + both agent capabilities + server tunnel configured). */
const makeTunnelCapable = () => {
  mockDevices[0].capabilities = ['http_tunnel_v1', 'websocket_tunnel_v1'];
  mockDevices[0].tunnelAvailable = true;
};
const mockProjects: unknown[] = [];
let mockStoreState: Record<string, unknown> = {};
jest.mock('../src/store/controlCenterStore', () => ({
  useControlCenterStore: (selector: (state: unknown) => unknown) =>
    selector({
      devices: mockDevices,
      projects: mockProjects,
      ...mockStoreState,
    }),
  // AgentProvider type is exported from this module; re-export a no-op so the
  // import in the screen doesn't blow up.
}));

const mockUserDefault: Record<string, unknown> = { provider: null, model: null, effort: null };
// Module-level handle on the mocked refresh so tests can assert the
// useFocusEffect → refresh wiring actually fires (babel-plugin-jest-hoist
// allows referencing mock-prefixed identifiers inside the factory).
const mockRefresh = jest.fn();
jest.mock('../src/hooks/useModelOptions', () => ({
  useModelOptions: () => ({
    providerCatalog: { codex: null, claude_code: null, opencode: null },
    userDefault: mockUserDefault,
    refresh: mockRefresh,
  }),
  catalogEffortOptions: () => [
    { label: 'LOW', value: 'low' },
    { label: 'HIGH', value: 'high' },
  ],
}));

jest.mock('../src/hooks/useRecentModelOptions', () => ({
  useRecentModelOptions: () => ({
    modelOptions: [{ label: 'GPT-5', value: 'gpt-5' }],
    rememberModel: jest.fn(),
  }),
}));

// Navigation: capture navigation.replace/push args.
const mockReplace = jest.fn();
const mockPush = jest.fn();
// useFocusEffect mock: record the latest effect callback so tests can simulate
// returning to this screen (focus) by invoking it manually. (React's
// jest.mock hoisting blocks referencing the imported React binding inside the
// factory, so the callback is only recorded, never auto-run on mount.)
let lastFocusEffect: (() => void) | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    replace: mockReplace,
    goBack: jest.fn(),
    navigate: jest.fn(),
    push: mockPush,
  }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: (cb: () => void) => {
    lastFocusEffect = cb;
  },
}));

import { CreateVibeCodingScreen } from '../src/screens/vibecoding/CreateVibeCodingScreen';

// Module-level providers so root.update() can re-wrap without dropping
// ThemeContext/SafeAreaProvider (BottomSheet needs safe-area insets).
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

/** Find an element by testID (searches the whole tree). */
const getByTestID = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAll(el => el.props?.testID === testID);

/** Find the FIRST node (any type) with a testID; undefined when absent. */
const byTestID = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAll(el => typeof el === 'object' && el.props?.testID === testID)[0];

/** Find a TouchableOpacity by testID. */
const touchByTestID = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAllByType(TouchableOpacity).find(c => c.props?.testID === testID);

const tap = (root: ReactTestRenderer.ReactTestInstance | undefined, testID: string) => {
  const btn = root && touchByTestID(root, testID);
  act(() => {
    (btn as { props: { onPress?: () => void } } | undefined)?.props?.onPress?.();
  });
};

/** Press the START VIBECODING GlowButton (found by its label text). */
const pressStart = (r: ReactTestRenderer.ReactTestRenderer) => {
  const startTouch = r.root
    .findAllByType(TouchableOpacity)
    .find(c => c.findAllByType(Text).some(t => String(t.props.children).includes('START VIBECODING')));
  act(() => { (startTouch as { props: { onPress?: () => void } })?.props?.onPress?.(); });
};
/** Start 后若弹出了确认 sheet,点其中的确认类按钮(场景化二选一存在)。 */
const confirmSheetIfOpen = (r: ReactTestRenderer.ReactTestRenderer) => {
  const btn = touchByTestID(r.root, 'sheet-btn-confirm') ?? touchByTestID(r.root, 'sheet-btn-start-anyway');
  if (btn) act(() => { btn.props.onPress?.(); });
};

/** Concatenate all Text children under a node into a single string. */
const textUnder = (node: ReactTestRenderer.ReactTestInstance): string =>
  node
    .findAllByType(Text)
    .map(t => {
      const c = t.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('');

// jest.setup pins i18n locale to 'zh', so the assertion strings below are Chinese.

describe('CreateVibeCodingScreen permissions section', () => {
  let root: ReactTestRenderer.ReactTestRenderer;

  beforeEach(() => {
    mockReplace.mockReset();
    // Reset per-device tunnel fields so each test starts from a plain device.
    delete mockDevices[0].capabilities;
    delete mockDevices[0].tunnelAvailable;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
  });

  it('default state: approval=继承 selected, capabilities Read/Modify/Run all ON', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    const inheritChip = getByTestID(root.root, 'approval-chip-inherit')[0];
    expect(inheritChip).toBeTruthy();
    // Selected chip carries the active style marker (testID is on the TouchableOpacity).
    // Capability chips render with ON labels.
    const capRead = getByTestID(root.root, 'cap-read')[0];
    const capModify = getByTestID(root.root, 'cap-modify')[0];
    const capRun = getByTestID(root.root, 'cap-run')[0];
    expect(capRead).toBeTruthy();
    expect(capModify).toBeTruthy();
    expect(capRun).toBeTruthy();
    // Each capability row shows an ON indicator.
    expect(textUnder(capRead)).toContain('ON');
    expect(textUnder(capModify)).toContain('ON');
    expect(textUnder(capRun)).toContain('ON');
  });

  it('read-only chip snaps Modify+Run OFF and disables all three', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'approval-chip-read_only');
    // Read stays ON but locked (disabled row). Modify + Run flip OFF.
    const capRead = getByTestID(root.root, 'cap-read')[0];
    const capModify = getByTestID(root.root, 'cap-modify')[0];
    const capRun = getByTestID(root.root, 'cap-run')[0];
    expect(textUnder(capRead)).toContain('ON');
    expect(textUnder(capModify)).toContain('OFF');
    expect(textUnder(capRun)).toContain('OFF');
    // All three capability rows are disabled under read-only.
    expect(touchByTestID(root.root, 'cap-read')?.props.disabled).toBe(true);
    expect(touchByTestID(root.root, 'cap-modify')?.props.disabled).toBe(true);
    expect(touchByTestID(root.root, 'cap-run')?.props.disabled).toBe(true);
  });

  it('switching back from read-only re-enables capability toggles', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'approval-chip-read_only');
    expect(touchByTestID(root.root, 'cap-modify')?.props.disabled).toBe(true);
    // Tap a non-read-only chip (allow_all).
    tap(root.root, 'approval-chip-allow_all');
    expect(touchByTestID(root.root, 'cap-read')?.props.disabled).toBe(false);
    expect(touchByTestID(root.root, 'cap-modify')?.props.disabled).toBe(false);
    expect(touchByTestID(root.root, 'cap-run')?.props.disabled).toBe(false);
  });

  it('Create passes draftConfig with capability booleans + approvalScheme (non-inherit)', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    // Default approval=inherit → approvalScheme omitted. Toggle Modify OFF to
    // verify the boolean is forwarded.
    tap(root.root, 'cap-modify');
    tap(root.root, 'approval-chip-allow_all');
    // Tap START VIBECODING (GlowButton surfaces a TouchableOpacity titled with
    // the button label; find it by text and invoke onPress).
    const startTouch = root.root
      .findAllByType(TouchableOpacity)
      .find(c =>
        c.findAllByType(Text).some(t => String(t.props.children).includes('START VIBECODING')),
      );
    expect(startTouch).toBeTruthy();
    act(() => {
      (startTouch as { props: { onPress?: () => void } })?.props?.onPress?.();
    });
    // mock userDefault 为空 → 确认 sheet 弹出,点「仍用默认」走通原语义。
    confirmSheetIfOpen(root);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const [dest, params] = mockReplace.mock.calls[0];
    expect(dest).toBe('VibeCodingSession');
    expect(params.draftConfig).toMatchObject({
      approvalScheme: 'allow_all',
      canRead: true,
      canModify: false,
      canRun: true,
    });
  });

  it('inherit approval → draftConfig.approvalScheme is undefined', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    const startTouch = root.root
      .findAllByType(TouchableOpacity)
      .find(c =>
        c.findAllByType(Text).some(t => String(t.props.children).includes('START VIBECODING')),
      );
    act(() => {
      (startTouch as { props: { onPress?: () => void } })?.props?.onPress?.();
    });
    confirmSheetIfOpen(root);
    const params = mockReplace.mock.calls[0][1];
    expect(params.draftConfig.approvalScheme).toBeUndefined();
    expect(params.draftConfig.canRead).toBe(true);
    expect(params.draftConfig.canModify).toBe(true);
    expect(params.draftConfig.canRun).toBe(true);
  });

  it('renders disabled with blocker chip when device lacks tunnel capabilities', async () => {
    // Plain device (no capabilities/tunnelAvailable reported) → not tunnel-capable.
    root = await wrap(<CreateVibeCodingScreen />);
    const portToggle = touchByTestID(root.root, 'port-mapping-toggle');
    expect(portToggle).toBeTruthy();
    // Blocker chip names the failing gate (zh: 需升级 Agent).
    expect(textUnder(portToggle!)).toContain('需升级');
    // Non-interactive: the TouchableOpacity is disabled.
    expect(portToggle?.props.disabled).toBe(true);
  });

  it('port-mapping toggle disabled when device lacks tunnel capabilities (disabledHint shown)', async () => {
    // Variant: server tunnel IS configured (tunnelAvailable true) but the agent
    // reports no tunnel capabilities → the capability list is the failing gate.
    mockDevices[0].capabilities = [];
    mockDevices[0].tunnelAvailable = true;
    root = await wrap(<CreateVibeCodingScreen />);
    const portToggle = touchByTestID(root.root, 'port-mapping-toggle');
    expect(portToggle).toBeTruthy();
    expect(portToggle?.props.disabled).toBe(true);
    // Blocker chip names the capability gate (zh: 需升级 Agent).
    expect(textUnder(portToggle!)).toContain('需升级');
    // Disabled hint copy rendered instead of the on/off hint.
    const allText = root.root
      .findAllByType(Text)
      .map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c ?? '');
      })
      .join('|');
    expect(allText).toContain('设备不在线或隧道不可用');
  });

  it('disabled with tunnel blocker chip when server tunnel is not configured', async () => {
    mockDevices[0].capabilities = ['http_tunnel_v1', 'websocket_tunnel_v1'];
    mockDevices[0].tunnelAvailable = false;
    root = await wrap(<CreateVibeCodingScreen />);
    const portToggle = touchByTestID(root.root, 'port-mapping-toggle');
    expect(portToggle?.props.disabled).toBe(true);
    expect(textUnder(portToggle!)).toContain('隧道未配置');
  });

  it('tunnel-capable device: toggle flips ON and draftConfig carries exposePreviewPort=true', async () => {
    makeTunnelCapable();
    root = await wrap(<CreateVibeCodingScreen />);
    const before = touchByTestID(root.root, 'port-mapping-toggle');
    expect(before).toBeTruthy();
    expect(before?.props.disabled).toBe(false);
    expect(textUnder(before!)).toContain('关');
    tap(root.root, 'port-mapping-toggle');
    // Chip flipped to ON (re-query after re-render).
    const after = touchByTestID(root.root, 'port-mapping-toggle');
    expect(textUnder(after!)).toContain('开');
    // START VIBECODING (GlowButton surfaces a TouchableOpacity titled with the
    // button label; find it by text and invoke onPress).
    const startTouch = root.root
      .findAllByType(TouchableOpacity)
      .find(c =>
        c.findAllByType(Text).some(t => String(t.props.children).includes('START VIBECODING')),
      );
    expect(startTouch).toBeTruthy();
    act(() => {
      (startTouch as { props: { onPress?: () => void } })?.props?.onPress?.();
    });
    confirmSheetIfOpen(root);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const params = mockReplace.mock.calls[0][1];
    expect(params.draftConfig.exposePreviewPort).toBe(true);
  });

  it('tunnel-capable device: default OFF → draftConfig carries exposePreviewPort=false', async () => {
    makeTunnelCapable();
    root = await wrap(<CreateVibeCodingScreen />);
    // No toggle tap — the boolean must still be forwarded (false, not undefined).
    const startTouch = root.root
      .findAllByType(TouchableOpacity)
      .find(c =>
        c.findAllByType(Text).some(t => String(t.props.children).includes('START VIBECODING')),
      );
    act(() => {
      (startTouch as { props: { onPress?: () => void } })?.props?.onPress?.();
    });
    confirmSheetIfOpen(root);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const params = mockReplace.mock.calls[0][1];
    expect(params.draftConfig.exposePreviewPort).toBe(false);
  });

  it('section title renumbered to 7. PERMISSIONS (no 8.)', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    const allText = root.root
      .findAllByType(Text)
      .map(t => String(t.props.children))
      .join('|');
    expect(allText).toContain('7. PERMISSIONS');
    expect(allText).not.toContain('8. PERMISSIONS');
  });

  it('old decorative permissions array removed (no "Expose preview ports" toggle)', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    const allText = root.root
      .findAllByType(Text)
      .map(t => String(t.props.children))
      .join('|');
    // The old English toggle label must be gone.
    expect(allText).not.toContain('Run local commands with approval');
  });

  it('approval chip labels render translated text (i18n key wiring, not literal key paths)', async () => {
    // Regression guard: chip values are snake_case (allow_all/ask_all/read_only)
    // but the i18n keys are camelCase (allowAll/askAll/readOnly). A mismatch
    // renders the literal key path (e.g. createScreen.permissions.approval.allow_all)
    // instead of the translation. Assert the rendered zh labels appear and that
    // no raw key path leaks through.
    root = await wrap(<CreateVibeCodingScreen />);
    const allText = root.root
      .findAllByType(Text)
      .map(t => String(t.props.children))
      .join('|');
    expect(allText).toContain('继承');
    expect(allText).toContain('全部放行');
    expect(allText).toContain('逐项确认');
    expect(allText).toContain('只读');
    // Default approval=inherit → its hint must render, not the raw key path.
    expect(allText).toContain('沿用项目默认策略');
    // No snake_case key path should leak into the rendered tree.
    expect(allText).not.toContain('createScreen.permissions.approval.allow_all');
    expect(allText).not.toContain('createScreen.permissions.approval.allow_allHint');
  });
});

describe('CreateVibeCodingScreen model confirm sheet', () => {
  let root: ReactTestRenderer.ReactTestRenderer;
  beforeEach(() => {
    Object.keys(mockUserDefault).forEach(k => delete mockUserDefault[k]);
    Object.assign(mockUserDefault, { provider: null, model: null, effort: null });
    mockReplace.mockClear();
    mockPush.mockClear();
    mockRefresh.mockClear();
  });
  afterEach(() => {
    act(() => { root?.unmount(); });
    mockDevices[0].tools = [];
    delete mockDevices[0].capabilities;
    delete mockDevices[0].tunnelAvailable;
  });

  it('model/effort 均未指定:Start 打开确认 sheet,不直接 navigate', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    // Me 全空(mock 默认)→ 走 go-me 按钮组;sheet 在开 = 内容行可见
    expect(byTestID(root.root, 'sheet-model-value')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-start-anyway')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('model、effort 都手动指定:Start 直通 navigate(零打扰)', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'model-chip-gpt-5');
    tap(root.root, 'effort-chip-high');
    pressStart(root);
    expect(byTestID(root.root, 'sheet-model-value')).toBeUndefined();
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('任一未指定(选了 effort 未选 model)也弹 sheet', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'effort-chip-high');
    pressStart(root);
    expect(byTestID(root.root, 'sheet-model-value')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-start-anyway')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('确认开始:navigate 且 draftConfig 与原语义一致(model/effort 不带值)', async () => {
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    tap(root.root, 'sheet-btn-confirm');
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const [dest, params] = mockReplace.mock.calls[0];
    expect(dest).toBe('VibeCodingSession');
    expect(params.draftConfig.model).toBeUndefined();
    expect(params.draftConfig.effort).toBeUndefined();
  });

  it('返回修改:仅关 sheet,不 navigate,可再次 Start', async () => {
    // 种同 provider 的 Me 默认 → 走 confirm/back 按钮组
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-btn-back')).toBeTruthy();
    tap(root.root, 'sheet-btn-back');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeUndefined();
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeTruthy();
  });

  it('Me 空:按钮组为 去设置/仍用默认;去设置=push MainTabs Account 且先关 sheet', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeTruthy();
    tap(root.root, 'sheet-btn-go-me');
    expect(mockPush).toHaveBeenCalledWith('MainTabs', { screen: 'Account' });
    // sheet 内容已随 visible 门控立即收起
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeUndefined();
    expect(touchByTestID(root.root, 'sheet-btn-start-anyway')).toBeUndefined();
    // 仍用默认开始路径
    pressStart(root);
    tap(root.root, 'sheet-btn-start-anyway');
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('跨 provider:Me 默认(claude)对所选 codex 不适用 → 走 Me 空按钮组', async () => {
    // claude 在本设备不可用 → 预填不切 provider(见下方缺陷 B 用例),维持 codex;
    // Me 的 claude 默认对 codex 不适用 → CLI 默认 + 去设置按钮组。
    mockDevices[0].tools = [{ id: 'codex', available: true }, { id: 'claude_code', available: false }];
    Object.assign(mockUserDefault, { provider: 'claude_code', model: 'glm-5.2', effort: 'high' });
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeUndefined();
  });

  it('缺陷B:Me 默认 provider 可用时预填 provider 芯片', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    // 模拟 userDefault 异步到达:wrap 时 provider 为 null,再置值并重渲染
    Object.assign(mockUserDefault, { provider: 'claude_code', model: 'glm-5.2', effort: 'high' });
    await act(async () => { root.update(<Providers><CreateVibeCodingScreen /></Providers>); });
    expect(touchByTestID(root.root, 'provider-chip-claude_code')?.props.accessibilityState?.selected ?? false).toBe(true);
    pressStart(root);
    confirmSheetIfOpen(root);
    expect(mockReplace.mock.calls[0][1].draftConfig.provider).toBe('claude_code');
  });

  it('缺陷B:Me 默认 provider 不可用时不预填(维持 codex/自动切换)', async () => {
    // tools 恢复由本 describe 的 afterEach 兜底
    mockDevices[0].tools = [{ id: 'codex', available: true }, { id: 'claude_code', available: false }];
    Object.assign(mockUserDefault, { provider: 'claude_code' });
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    confirmSheetIfOpen(root);
    expect(mockReplace.mock.calls[0][1].draftConfig.provider).toBe('codex');
  });

  it('缺陷B:用户手动点过 provider 芯片后,Me 预填不覆盖', async () => {
    Object.assign(mockUserDefault, { provider: null });
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'provider-chip-codex'); // 触碰即 providerTouchedRef=true
    Object.assign(mockUserDefault, { provider: 'opencode' });
    await act(async () => { root.update(<Providers><CreateVibeCodingScreen /></Providers>); });
    pressStart(root);
    confirmSheetIfOpen(root);
    expect(mockReplace.mock.calls[0][1].draftConfig.provider).toBe('codex');
  });

  it('缺陷B:预填自动切 provider 时清空已选 model/effort(防跨 provider 残留)', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    // Me 默认尚未到达时用户已选了 codex 的 model 芯片
    tap(root.root, 'model-chip-gpt-5');
    tap(root.root, 'effort-chip-high');
    // Me 默认到达:provider=claude_code 可用 → 自动切 provider 并清空选择
    Object.assign(mockUserDefault, { provider: 'claude_code', model: 'glm-5.2', effort: 'high' });
    await act(async () => { root.update(<Providers><CreateVibeCodingScreen /></Providers>); });
    pressStart(root);
    confirmSheetIfOpen(root);
    expect(mockReplace.mock.calls[0][1].draftConfig.provider).toBe('claude_code');
    // model/effort 已被清空 → draftConfig 不携带(而不是带着 gpt-5/high 投给 claude)
    expect(mockReplace.mock.calls[0][1].draftConfig.model).toBeUndefined();
    expect(mockReplace.mock.calls[0][1].draftConfig.effort).toBeUndefined();
  });

  it('从 Me 页返回(focus)后重拉默认值,弹窗反映新默认', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    // 保存前的旧缓存:空 → Me 空按钮组
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeTruthy();
    // Me 空按钮组没有「返回修改」按钮;真实路径是点「去设置」关 sheet 并 push
    // Account(Me 页),配置完返回。这里走同一路径。
    tap(root.root, 'sheet-btn-go-me');
    expect(mockPush).toHaveBeenCalledWith('MainTabs', { screen: 'Account' });
    // 用户在 Me 页保存了默认(mockUserDefault 更新),回到创建页触发 focus:
    // mock 的 useFocusEffect 记录的回调即刷新通路(refresh 本身是 jest.fn,
    // 默认值变化由 mockUserDefault 直接反映),root.update 让弹窗读到新默认。
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    await act(async () => {
      lastFocusEffect?.();
      root.update(<Providers><CreateVibeCodingScreen /></Providers>);
    });
    // The focus callback must actually invoke the refresh path (guards against
    // the wiring being deleted while the sheet still reads the mutated mock).
    expect(mockRefresh).toHaveBeenCalled();
    pressStart(root);
    // Me 默认现在适用 → 确认/返回按钮组(而非 Me 空引导)
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeUndefined();
  });
});

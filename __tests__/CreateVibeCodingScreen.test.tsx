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

jest.mock('../src/hooks/useModelOptions', () => ({
  useModelOptions: () => ({
    providerCatalog: { codex: null, claude_code: null, opencode: null },
    userDefault: { model: '', effort: '' },
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

// Navigation: capture navigation.replace args.
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    replace: mockReplace,
    goBack: jest.fn(),
    navigate: jest.fn(),
  }),
  useRoute: () => ({ params: {} }),
}));

import { CreateVibeCodingScreen } from '../src/screens/vibecoding/CreateVibeCodingScreen';

const wrap = async (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
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
    await Promise.resolve();
  });
  return renderer!;
};

/** Find an element by testID (searches the whole tree). */
const getByTestID = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAll(el => el.props?.testID === testID);

/** Find a TouchableOpacity by testID. */
const touchByTestID = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAllByType(TouchableOpacity).find(c => c.props?.testID === testID);

const tap = (root: ReactTestRenderer.ReactTestInstance | undefined, testID: string) => {
  const btn = root && touchByTestID(root, testID);
  act(() => {
    (btn as { props: { onPress?: () => void } } | undefined)?.props?.onPress?.();
  });
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
    const params = mockReplace.mock.calls[0][1];
    expect(params.draftConfig.approvalScheme).toBeUndefined();
    expect(params.draftConfig.canRead).toBe(true);
    expect(params.draftConfig.canModify).toBe(true);
    expect(params.draftConfig.canRun).toBe(true);
  });

  it('port-mapping toggle renders disabled with 即将支持 label when device has no tunnel fields', async () => {
    // Plain device (no capabilities/tunnelAvailable reported) → not tunnel-capable.
    root = await wrap(<CreateVibeCodingScreen />);
    const portToggle = touchByTestID(root.root, 'port-mapping-toggle');
    expect(portToggle).toBeTruthy();
    // Coming-soon label rendered (zh: 即将支持).
    expect(textUnder(portToggle!)).toContain('即将支持');
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

  it('tunnel-capable device: toggle flips ON and draftConfig carries exposePreviewPort=true', async () => {
    makeTunnelCapable();
    root = await wrap(<CreateVibeCodingScreen />);
    const before = touchByTestID(root.root, 'port-mapping-toggle');
    expect(before).toBeTruthy();
    expect(before?.props.disabled).toBe(false);
    expect(textUnder(before!)).toContain('OFF');
    tap(root.root, 'port-mapping-toggle');
    // Chip flipped to ON (re-query after re-render).
    const after = touchByTestID(root.root, 'port-mapping-toggle');
    expect(textUnder(after!)).toContain('ON');
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

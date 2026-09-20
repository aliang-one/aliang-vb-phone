import React from 'react';
import { Keyboard, type KeyboardEvent } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceTerminalScreen } from '../src/screens/devices/DeviceTerminalScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { TerminalSession } from '../src/store/types';
import { platformTransport } from '../src/services/platformTransport';

// Screen tests below swap the store's terminal actions for jest.fn mocks via
// setState — a PARTIAL merge, so the fakes would leak into the thunk describe.
// Capture the real actions before any test mutates the store.
const realAttachTerminalSession =
  useControlCenterStore.getState().attachTerminalSession;

const mockTerminalSendText = jest.fn();
const mockTerminalFocus = jest.fn();
const mockTerminalFit = jest.fn();
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockAutoRenderTerminal = true;
let lastEmulatorProps: {
  sessionId?: string;
  replayChunks?: string[];
  replayReady?: boolean;
  replayStatus?: 'live' | 'exited';
} | null = null;

let mockRouteParams: {
  deviceId: string;
  directory?: string;
  terminalId?: string;
  initialCommand?: string;
  newSession?: boolean;
} = {
  deviceId: 'device-1',
  directory: '~/project',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => false,
    navigate: mockNavigate,
    goBack: mockGoBack,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/components/terminal/TerminalEmulator', () => ({
  TerminalEmulator: (props: {
    sessionId: string;
    replayChunks?: string[];
    replayReady?: boolean;
    replayStatus?: 'live' | 'exited';
    terminalRef?: React.MutableRefObject<unknown>;
    onRendered?: () => void;
  }) => {
    const MockReact = require('react');
    const { View } = require('react-native');
    lastEmulatorProps = props;
    MockReact.useEffect(() => {
      if (mockAutoRenderTerminal) props.onRendered?.();
    }, []);
    if (props.terminalRef) {
      props.terminalRef.current = {
        sendText: mockTerminalSendText,
        focus: mockTerminalFocus,
        fit: mockTerminalFit,
      };
    }
    return MockReact.createElement(View, { testID: 'terminal-emulator' });
  },
}));

const DEVICE = {
  id: 'device-1',
  name: 'MacBook',
  status: 'online' as const,
  location: 'Desk',
  os: 'darwin',
  host: 'localhost',
  cpuLoad: 0,
  memLoad: 0,
  authorizedDirectories: ['~/project'],
  activePorts: [],
  projectIds: [],
  activeSessionIds: [],
  lastSeen: 'now',
  remoteTerminalEnabled: true,
  aiControlEnabled: true,
  capabilities: ['terminal'],
  tools: [],
  history: [],
};

const makeSession = (overrides: Partial<TerminalSession>): TerminalSession => ({
  id: 'term-1',
  deviceId: 'device-1',
  directory: '~/project',
  shell: 'zsh',
  status: 'running',
  lines: [],
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  ...overrides,
});

describe('DeviceTerminalScreen attach flow', () => {
  let keyboardListeners: Record<string, Array<(event?: KeyboardEvent) => void>>;
  let screen: ReactTestRenderer.ReactTestRenderer | null;
  let mockAttach: jest.Mock;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    keyboardListeners = {};
    screen = null;
    lastEmulatorProps = null;
    mockAutoRenderTerminal = true;
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/project',
    };
    jest.spyOn(Keyboard, 'dismiss').mockImplementation();
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
      const listener = callback as (event?: KeyboardEvent) => void;
      keyboardListeners[event] = [...(keyboardListeners[event] ?? []), listener];
      return {
        remove: jest.fn(() => {
          keyboardListeners[event] = (keyboardListeners[event] ?? []).filter(
            item => item !== listener,
          );
        }),
      } as never;
    });
    mockAttach = jest.fn().mockResolvedValue('term-1');
    let createCounter = 0;
    mockCreate = jest.fn().mockImplementation(
      (deviceId: string, directory?: string) => {
        // Mirror the real thunk: a created session lands in the store.
        createCounter += 1;
        const id = `term-created-${createCounter}`;
        useControlCenterStore.setState(state => ({
          terminalSessions: [
            makeSession({ id, directory: directory ?? '~/project' }),
            ...state.terminalSessions,
          ],
        }));
        return Promise.resolve(id);
      },
    );
    useControlCenterStore.setState({
      serverMode: true,
      devices: [{ ...DEVICE }],
      terminalSessions: [makeSession({})],
      createTerminalSession: mockCreate,
      attachTerminalSession: mockAttach,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = null;
    jest.restoreAllMocks();
  });

  const renderScreen = () => {
    screen = ReactTestRenderer.create(
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
          <DeviceTerminalScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
    return screen;
  };

  it('attaches when entering with a terminal id instead of creating', async () => {
    mockRouteParams = { deviceId: 'device-1', directory: '~/project', terminalId: 'term-1' };

    await act(async () => {
      screen = renderScreen();
    });

    expect(mockAttach).toHaveBeenCalledWith('term-1', {
      deviceId: 'device-1',
      rows: 24,
      cols: 80,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    // The session renders and stays interactive.
    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props
        .disabled,
    ).toBe(false);
  });

  it('attaches the most recent active session when no id is given', async () => {
    mockRouteParams = { deviceId: 'device-1', directory: '~/project' };
    useControlCenterStore.setState({
      terminalSessions: [
        makeSession({
          id: 'term-old',
          status: 'running',
          updatedAt: '2026-09-20T09:00:00.000Z',
        }),
        makeSession({
          id: 'term-newest',
          status: 'running',
          updatedAt: '2026-09-20T11:00:00.000Z',
        }),
      ],
    });

    await act(async () => {
      screen = renderScreen();
    });

    expect(mockAttach).toHaveBeenCalledWith('term-newest', {
      deviceId: 'device-1',
      rows: 24,
      cols: 80,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a fresh session when no id is given and none is active', async () => {
    mockRouteParams = { deviceId: 'device-1', directory: '~/project' };
    useControlCenterStore.setState({ terminalSessions: [] });

    await act(async () => {
      screen = renderScreen();
    });

    expect(mockCreate).toHaveBeenCalledWith('device-1', '~/project');
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('skips attach resolution for an explicit new-session entry', async () => {
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/project',
      newSession: true,
    };
    // An active session exists, but the entry explicitly asked for a fresh one.
    useControlCenterStore.setState({ terminalSessions: [makeSession({})] });

    await act(async () => {
      screen = renderScreen();
    });

    expect(mockCreate).toHaveBeenCalledWith('device-1', '~/project');
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('shows the ended bar, disables the composer and offers a new session when replay reports exited', async () => {
    mockRouteParams = { deviceId: 'device-1', directory: '~/project', terminalId: 'term-1' };
    useControlCenterStore.setState({
      terminalSessions: [
        makeSession({
          status: 'completed',
          replayChunks: ['before exit\r\n'],
          replayReady: true,
          replayStatus: 'exited',
        }),
      ],
    });

    await act(async () => {
      screen = renderScreen();
    });

    expect(mockAttach).toHaveBeenCalledWith('term-1', {
      deviceId: 'device-1',
      rows: 24,
      cols: 80,
    });
    // The ended strip with the explicit new-session entry is present.
    expect(
      screen!.root.findByProps({ testID: 'terminal-ended-bar' }),
    ).toBeTruthy();
    const newSessionButton = screen!.root.findByProps({
      testID: 'terminal-new-session',
    });
    expect(newSessionButton.props.accessibilityRole).toBe('button');
    expect(newSessionButton.props.disabled).toBe(false);
    // The composer is disabled (dead session must not send terminal.input).
    expect(
      screen!.root.findByProps({ testID: 'terminal-keyboard-focus' }).props
        .disabled,
    ).toBe(true);
    // History is still rendered by the emulator.
    expect(lastEmulatorProps?.replayStatus).toBe('exited');
    expect(lastEmulatorProps?.replayChunks).toEqual(['before exit\r\n']);
  });

  it('shows the dead-session empty state with a new session entry when closed without replay', async () => {
    mockRouteParams = { deviceId: 'device-1', directory: '~/project', terminalId: 'term-1' };
    useControlCenterStore.setState({
      terminalSessions: [makeSession({ status: 'completed' })],
    });

    await act(async () => {
      screen = renderScreen();
    });

    expect(mockAttach).toHaveBeenCalledWith('term-1', {
      deviceId: 'device-1',
      rows: 24,
      cols: 80,
    });
    // The hint replaces the emulator: no more typing into a dead pty.
    expect(screen!.root.findAllByProps({ testID: 'terminal-emulator' }).length).toBe(0);
    expect(screen!.root.findByProps({ testID: 'terminal-dead-hint' }).props.children).toBe(
      '会话已结束',
    );
    const newSessionButton = screen!.root.findByProps({
      testID: 'terminal-new-session',
    });
    expect(newSessionButton.props.disabled).toBe(false);
    expect(
      screen!.root.findAllByProps({ testID: 'terminal-keyboard-focus' }).length,
    ).toBe(0);
  });

  it('creates a new session from the new-session entry', async () => {
    mockRouteParams = { deviceId: 'device-1', directory: '~/project', terminalId: 'term-1' };
    useControlCenterStore.setState({
      terminalSessions: [makeSession({ status: 'completed' })],
    });

    await act(async () => {
      screen = renderScreen();
    });

    await act(async () => {
      screen!.root.findByProps({ testID: 'terminal-new-session' }).props.onPress();
    });

    expect(mockCreate).toHaveBeenCalledWith('device-1', '~/project');
    // The fresh session is NOT re-attached (created sessions skip attach).
    expect(mockAttach).toHaveBeenCalledTimes(1);
    expect(lastEmulatorProps?.sessionId).toBe('term-created-1');
  });
});

describe('attachTerminalSession store thunk', () => {
  beforeEach(() => {
    mockRouteParams = { deviceId: 'device-1', directory: '~/project' };
    useControlCenterStore.setState({
      serverMode: true,
      devices: [{ ...DEVICE }],
      terminalSessions: [makeSession({})],
      // Restore the real action (the screen describe above left a jest.fn in
      // its place via partial setState).
      attachTerminalSession: realAttachTerminalSession,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests the attach API and merges the returned snapshot', async () => {
    const attachApi = jest
      .spyOn(platformTransport, 'attachTerminalSession')
      .mockResolvedValue({
        session_id: 'term-1',
        kind: 'terminal' as const,
        user_id: 'user-1',
        device_id: 'device-1',
        status: 'active' as const,
        cwd: '~/project',
        shell: 'zsh',
        cols: 80,
        rows: 24,
        created_at: '2026-09-20T10:00:00.000Z',
        last_active_at: '2026-09-20T10:05:00.000Z',
      });

    const id = await useControlCenterStore
      .getState()
      .attachTerminalSession('term-1', { deviceId: 'device-1', rows: 30, cols: 100 });

    expect(id).toBe('term-1');
    expect(attachApi).toHaveBeenCalledWith('term-1', { rows: 30, cols: 100 });
    const stored = useControlCenterStore
      .getState()
      .terminalSessions.find(item => item.id === 'term-1');
    expect(stored?.status).toBe('running');
    expect(stored?.updatedAt).toBe('2026-09-20T10:05:00.000Z');
  });

  it('resets a stale replay buffer before attaching', async () => {
    jest.spyOn(platformTransport, 'attachTerminalSession').mockResolvedValue({
      session_id: 'term-1',
      kind: 'terminal' as const,
      user_id: 'user-1',
      device_id: 'device-1',
      status: 'active' as const,
      cwd: '~/project',
      cols: 80,
      rows: 24,
      created_at: '2026-09-20T10:00:00.000Z',
      last_active_at: '2026-09-20T10:05:00.000Z',
    });
    useControlCenterStore.setState({
      terminalSessions: [
        makeSession({
          replayChunks: ['stale\r\n'],
          replayReady: true,
          replayStatus: 'live',
        }),
      ],
    });

    await useControlCenterStore
      .getState()
      .attachTerminalSession('term-1', { deviceId: 'device-1' });

    const stored = useControlCenterStore
      .getState()
      .terminalSessions.find(item => item.id === 'term-1');
    expect(stored?.replayChunks).toEqual([]);
    expect(stored?.replayReady).toBe(false);
    expect(stored?.replayStatus).toBeUndefined();
  });

  it('registers an unknown session so early replay frames can buffer, and drops it when attach fails', async () => {
    const attachApi = jest
      .spyOn(platformTransport, 'attachTerminalSession')
      .mockRejectedValueOnce(new Error('terminal session not found'))
      .mockResolvedValueOnce({
        session_id: 'term-cold',
        kind: 'terminal' as const,
        user_id: 'user-1',
        device_id: 'device-1',
        status: 'active' as const,
        cwd: '~/elsewhere',
        cols: 80,
        rows: 24,
        created_at: '2026-09-20T10:00:00.000Z',
        last_active_at: '2026-09-20T10:05:00.000Z',
      });

    await expect(
      useControlCenterStore
        .getState()
        .attachTerminalSession('term-cold', { deviceId: 'device-1' }),
    ).rejects.toThrow('terminal session not found');
    // The placeholder is gone after a failed attach.
    expect(
      useControlCenterStore
        .getState()
        .terminalSessions.find(item => item.id === 'term-cold'),
    ).toBeUndefined();

    await useControlCenterStore
      .getState()
      .attachTerminalSession('term-cold', { deviceId: 'device-1' });

    expect(attachApi).toHaveBeenCalledTimes(2);
    const stored = useControlCenterStore
      .getState()
      .terminalSessions.find(item => item.id === 'term-cold');
    expect(stored).toBeTruthy();
    expect(stored?.deviceId).toBe('device-1');
    expect(stored?.directory).toBe('~/elsewhere');
  });

  it('requires a platform connection', async () => {
    useControlCenterStore.setState({ serverMode: false });
    await expect(
      useControlCenterStore
        .getState()
        .attachTerminalSession('term-1', { deviceId: 'device-1' }),
    ).rejects.toThrow('Platform connection is required');
  });
});

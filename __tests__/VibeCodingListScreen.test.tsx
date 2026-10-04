import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VibeCodingListScreen } from '../src/screens/vibecoding/VibeCodingListScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { Device, VibeCodingRun } from '../src/data/platformModels';
import { fetchGoals } from '../src/api/goals';

const mockNavigate = jest.fn();

jest.mock('../src/api/goals', () => ({ fetchGoals: jest.fn() }));
const mockFetchGoals = jest.mocked(fetchGoals);
const task = {
  goal_id: 'goal-1',
  ai_session_id: 'goal-session-1',
  objective: 'Build the app',
  state: 'active' as const,
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

jest.mock('../src/components/vibecoding/DeviceControlCard', () => ({
  DeviceControlCard: ({ device: item }: { device: Device }) => {
    const MockReact = require('react');
    const { View: MockView } = require('react-native');
    return MockReact.createElement(MockView, {
      testID: 'device-card',
      'data-device-id': item.id,
    });
  },
}));

jest.mock('../src/components/vibecoding/VibeSessionCard', () => ({
  VibeSessionCard: ({ session }: { session: VibeCodingRun }) => {
    const MockReact = require('react');
    const { View: MockView } = require('react-native');
    return MockReact.createElement(MockView, {
      testID: 'session-card',
      'data-session-id': session.id,
    });
  },
}));

describe('VibeCodingListScreen remote terminal shortcuts', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchGoals.mockReset().mockResolvedValue([]);
    useControlCenterStore.setState({
      serverMode: false,
      devices: [device('device-1', 'MacBook', 'online')],
      projects: [],
      vibeRuns: [],
      terminalSessions: [
        terminal('term-active', 'device-1', 'running', '~/project'),
        terminal('term-completed', 'device-1', 'completed', '~/old'),
      ],
      stopTerminal: jest.fn().mockResolvedValue(undefined),
      refreshFromServer: jest.fn().mockResolvedValue({ ok: true }),
      hydrateSessionHistory: jest.fn().mockResolvedValue(undefined),
      loadAiSessionHistory: jest.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = undefined;
  });

  const renderScreen = () =>
    ReactTestRenderer.create(
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
          <VibeCodingListScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );

  const pager = () =>
    screen!.root
      .findAllByType(ScrollView)
      .find(node => node.props.pagingEnabled)!;
  const pages = () =>
    React.Children.toArray(pager().props.children).filter(
      React.isValidElement,
    ) as React.ReactElement<{
      testID: string;
      style: { width: number };
    }>[];
  const requestedPage = () => {
    const calls = (pager().instance.scrollTo as jest.Mock).mock.calls;
    const offset = calls[calls.length - 1][0].x;
    const pageWidth = StyleSheet.flatten(pages()[0].props.style).width;
    return pages()[Math.round(offset / pageWidth)]?.props.testID;
  };
  const refreshGoals = async () => {
    const list = screen!.root
      .findAllByType(ScrollView)
      .find(node => node.props.refreshControl)!;
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });
  };

  it('shows only active remote terminals and resumes or closes the same PTY', async () => {
    act(() => {
      screen = renderScreen();
    });

    const textContent = screen!.root.findAllByType(Text).map(node => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children);
    });
    const joinedText = textContent.join('\n');
    expect(joinedText).toContain('REMOTE TERMINALS');
    expect(joinedText).toContain('1 ACTIVE');
    expect(joinedText).toContain('MacBook');
    expect(joinedText).toContain('project');
    expect(joinedText).toContain('zsh');
    expect(joinedText).toContain('$ git status --short');
    expect(joinedText).not.toContain('old');

    const resumeButton = findTerminalActionButton(screen!.root, 'RESUME');
    const closeButton = findTerminalActionButton(screen!.root, 'CLOSE');

    act(() => {
      resumeButton?.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('DeviceTerminal', {
      deviceId: 'device-1',
      terminalId: 'term-active',
      directory: '~/project',
    });

    await act(async () => {
      closeButton?.props.onPress();
    });
    expect(useControlCenterStore.getState().stopTerminal).toHaveBeenCalledWith(
      'term-active',
    );
  });

  it('disables remote terminal actions when the owning device is offline', () => {
    useControlCenterStore.setState({
      devices: [device('device-1', 'MacBook', 'offline')],
    });

    act(() => {
      screen = renderScreen();
    });

    expect(
      findTerminalActionButton(screen!.root, 'RESUME')?.props.disabled,
    ).toBe(true);
    expect(
      findTerminalActionButton(screen!.root, 'CLOSE')?.props.disabled,
    ).toBe(true);
  });

  it('opens a fresh terminal from the floating terminal action device picker', () => {
    act(() => {
      screen = renderScreen();
    });

    switchToTerminals(screen!.root);

    const newTerminalButton = findByTestId(screen!.root, 'new-term-fab')[0];
    expect(newTerminalButton).toBeDefined();

    act(() => {
      newTerminalButton!.props.onPressIn();
      newTerminalButton!.props.onPressOut();
      newTerminalButton!.props.onPress();
    });

    const deviceChoice = findByTestId(
      screen!.root,
      'new-term-device-device-1',
    )[0];
    act(() => {
      deviceChoice.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('DeviceTerminal', {
      deviceId: 'device-1',
      directory: '~/project',
      newSession: true,
    });
  });

  it('keeps the pager pages aligned with the visible tabs when there are no tasks', () => {
    act(() => {
      screen = renderScreen();
    });

    expect(pages().map(page => page.props.testID)).toEqual([
      'vibecoding-page',
      'terminals-page',
    ]);
  });

  it('targets the terminal content when tapping Terminals without tasks', () => {
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);
    expect(requestedPage()).toBe('terminals-page');
  });

  it('loads task visibility when devices become available without a manual refresh', async () => {
    mockFetchGoals.mockResolvedValue([task]);
    useControlCenterStore.setState({ serverMode: true, devices: [] });
    await act(async () => {
      screen = renderScreen();
    });
    expect(mockFetchGoals).not.toHaveBeenCalled();
    await act(async () => {
      useControlCenterStore.setState({
        devices: [device('device-1', 'MacBook', 'online')],
      });
    });
    expect(mockFetchGoals).toHaveBeenCalledWith({ deviceId: 'device-1' });
    expect(pages().map(page => page.props.testID)).toEqual([
      'vibecoding-page',
      'tasks-page',
      'terminals-page',
    ]);
  });

  it('keeps Terminals selected when a task is inserted before it', async () => {
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);
    mockFetchGoals.mockResolvedValue([task]);
    await refreshGoals();
    expect(requestedPage()).toBe('terminals-page');
    expect(findByTestId(screen!.root, 'new-term-fab').length).toBeGreaterThan(
      0,
    );
    expect(pages().map(page => page.props.testID)).toEqual([
      'vibecoding-page',
      'tasks-page',
      'terminals-page',
    ]);
  });

  it('does not reload tasks for device telemetry updates', async () => {
    useControlCenterStore.setState({ serverMode: true });
    await act(async () => {
      screen = renderScreen();
    });
    mockFetchGoals.mockClear();
    await act(async () => {
      useControlCenterStore.setState({
        devices: useControlCenterStore
          .getState()
          .devices.map(item => ({ ...item, cpuLoad: 42 })),
      });
    });
    expect(mockFetchGoals).not.toHaveBeenCalled();
  });

  it('does not restore Tasks from an old request after its device is removed', async () => {
    let resolveGoals!: (goals: Awaited<ReturnType<typeof fetchGoals>>) => void;
    mockFetchGoals.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveGoals = resolve;
        }),
    );
    useControlCenterStore.setState({ serverMode: true });
    await act(async () => {
      screen = renderScreen();
    });
    await act(async () => {
      useControlCenterStore.setState({ devices: [] });
    });
    await act(async () => {
      resolveGoals([task]);
    });
    expect(pages().map(page => page.props.testID)).toEqual([
      'vibecoding-page',
      'terminals-page',
    ]);
  });

  it('keeps Terminals selected when the last task disappears', async () => {
    act(() => {
      screen = renderScreen();
    });
    mockFetchGoals.mockResolvedValue([task]);
    await refreshGoals();
    switchToTerminals(screen!.root);
    mockFetchGoals.mockResolvedValue([]);
    await refreshGoals();
    expect(requestedPage()).toBe('terminals-page');
    expect(findByTestId(screen!.root, 'new-term-fab').length).toBeGreaterThan(
      0,
    );
    expect(pages().map(page => page.props.testID)).toEqual([
      'vibecoding-page',
      'terminals-page',
    ]);
  });

  it('ignores the old native offset while re-aligning after Tasks is inserted', async () => {
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);
    const pageWidth = StyleSheet.flatten(pages()[0].props.style).width;
    mockFetchGoals.mockResolvedValue([task]);
    await refreshGoals();
    // Native layout can still report the previous two-page offset before the
    // updated content width is available to scrollTo.
    act(() => {
      pager().props.onScroll({
        nativeEvent: { contentOffset: { x: pageWidth } },
      });
      pager().props.onContentSizeChange(pageWidth * 3, 600);
    });
    expect(requestedPage()).toBe('terminals-page');
    expect(findByTestId(screen!.root, 'new-term-fab').length).toBeGreaterThan(
      0,
    );
    act(() => {
      pager().props.onScroll({
        nativeEvent: { contentOffset: { x: pageWidth * 2 } },
      });
    });
    expect(findByTestId(screen!.root, 'new-term-fab').length).toBeGreaterThan(
      0,
    );
  });

  it('returns to Vibecoding when the selected Tasks page disappears', async () => {
    act(() => {
      screen = renderScreen();
    });
    mockFetchGoals.mockResolvedValue([task]);
    await refreshGoals();
    const tasksTab = screen!.root
      .findAllByType(TouchableOpacity)
      .find(button =>
        button
          .findAllByType(Text)
          .some(node => node.props.children === 'Tasks'),
      )!;
    act(() => {
      tasksTab.props.onPress();
    });
    mockFetchGoals.mockResolvedValue([]);
    await refreshGoals();
    expect(requestedPage()).toBe('vibecoding-page');
    expect(findByTestId(screen!.root, 'new-term-fab')).toHaveLength(0);
  });

  it('updates the selected tab from swipes over the same page order', () => {
    act(() => {
      screen = renderScreen();
    });
    const pageWidth = StyleSheet.flatten(pages()[0].props.style).width;
    act(() => {
      pager().props.onScrollBeginDrag();
    });
    act(() => {
      pager().props.onScroll({
        nativeEvent: { contentOffset: { x: pageWidth } },
      });
    });
    expect(pages()[1].props.testID).toBe('terminals-page');
    expect(findByTestId(screen!.root, 'new-term-fab').length).toBeGreaterThan(
      0,
    );
    act(() => {
      pager().props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 0 } },
      });
    });
    expect(findByTestId(screen!.root, 'new-term-fab')).toHaveLength(0);
  });
});

function findTerminalActionButton(
  root: ReactTestRenderer.ReactTestInstance,
  label: string,
) {
  const labelNode = root
    .findAllByType(Text)
    .find(node => node.props.children === label);
  const actionRail = labelNode?.parent;
  const buttons = actionRail?.findAllByType(TouchableOpacity) ?? [];

  return label === 'RESUME' ? buttons[0] : buttons[1];
}

function findByTestId(root: ReactTestRenderer.ReactTestInstance, id: string) {
  return root.findAllByProps({ testID: id });
}

function switchToTerminals(root: ReactTestRenderer.ReactTestInstance) {
  const tab = root
    .findAllByType(TouchableOpacity)
    .find(button =>
      button
        .findAllByType(Text)
        .some(node => node.props.children === 'Terminals'),
    );
  act(() => {
    tab?.props.onPress();
  });
}

function device(id: string, name: string, status: Device['status']): Device {
  return {
    id,
    name,
    status,
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
}

function terminal(
  id: string,
  deviceId: string,
  status: ReturnType<
    typeof useControlCenterStore.getState
  >['terminalSessions'][number]['status'],
  directory: string,
) {
  return {
    id,
    deviceId,
    directory,
    shell: 'zsh',
    status,
    lines: [],
    createdAt: '2026-06-17T10:00:00.000Z',
    updatedAt: '2026-06-17T10:00:00.000Z',
    lastCommand: status === 'running' ? 'git status --short' : undefined,
    lastCommandAt:
      status === 'running' ? '2026-06-17T10:00:00.000Z' : undefined,
  };
}

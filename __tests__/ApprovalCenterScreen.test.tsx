import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApprovalCenterScreen } from '../src/screens/operations/ApprovalCenterScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: mockGoBack,
    navigate: jest.fn(),
  }),
}));

jest.mock('../src/components/vibecoding/ApprovalQuickPolicySheet', () => {
  const MockReact = require('react');
  const { TouchableOpacity: MockTouchableOpacity } = require('react-native');
  return {
    ApprovalQuickPolicySheet: (props: {
      open: boolean;
      onApplied?: (mode: 'allow_all') => void;
    }) =>
      props.open
        ? MockReact.createElement(MockTouchableOpacity, {
            testID: 'apply-allow-all',
            onPress: () => props.onApplied?.('allow_all'),
          })
        : null,
  };
});

describe('ApprovalCenterScreen', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;
  const resolveApproval = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    resolveApproval.mockClear();
    useControlCenterStore.setState({
      devices: [
        {
          id: 'device-1',
          name: 'MacBook',
          status: 'online',
          location: 'Desk',
          os: 'darwin',
          host: 'localhost',
          cpuLoad: 0,
          memLoad: 0,
          authorizedDirectories: [],
          activePorts: [],
          projectIds: ['project-1'],
          activeSessionIds: ['session-1'],
          lastSeen: 'now',
          remoteTerminalEnabled: true,
          aiControlEnabled: true,
          capabilities: [],
          tools: [],
          history: [],
        },
      ],
      projects: [
        {
          id: 'project-1',
          deviceId: 'device-1',
          name: 'Vibe Phone',
          path: '~/vibe_on_phone',
          language: 'TypeScript',
          status: 'active',
          branch: 'main',
          lastDeploy: 'now',
          description: '',
          detectedPorts: [],
        },
      ],
      approvals: [
        {
          id: 'approval-1',
          kind: 'tool',
          title: 'Run MCP tool',
          summary: 'The assistant needs permission.',
          deviceId: 'device-1',
          projectId: 'project-1',
          sessionId: 'session-1',
          toolName: 'mcp__serena__find_symbol',
          risk: 'medium',
          status: 'pending',
          createdAt: '2026-07-15T08:00:00.000Z',
        },
      ],
      resolveApproval,
    });
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = undefined;
  });

  it('opens policy actions and approves the current request after applying one', async () => {
    await act(async () => {
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
            <ApprovalCenterScreen />
          </SafeAreaProvider>
        </ThemeContext.Provider>,
      );
    });

    act(() => {
      screen!.root
        .findByProps({ testID: 'approval-more-approval-1' })
        .props.onPress();
    });

    await act(async () => {
      screen!.root.findByProps({ testID: 'apply-allow-all' }).props.onPress();
      await Promise.resolve();
    });

    expect(resolveApproval).toHaveBeenCalledWith(
      'approval-1',
      'approved',
      undefined,
    );
  });
});

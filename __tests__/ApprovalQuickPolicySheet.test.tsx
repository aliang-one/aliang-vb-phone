import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

// --- Mocks (module-level, jest.mock is hoisted; vars prefixed `mock` allowed) ---

// Render BottomSheet children directly — the unit under test is the quick-policy
// logic (fetch / apply / callbacks), not the sheet's Modal + reanimated chrome.
jest.mock('../src/components/shared/BottomSheet', () => {
  const React = require('react');
  return {
    BottomSheet: (props: { open: boolean; children: React.ReactNode }) =>
      props.open
        ? React.createElement(React.Fragment, null, props.children)
        : null,
  };
});

const mockFetchPolicy = jest.fn();
const mockUpdateProject = jest.fn();
const mockAddMcpPrefix = jest.fn();
jest.mock('../src/api/projects', () => ({
  fetchProjectApprovalPolicy: (...args: unknown[]) => mockFetchPolicy(...args),
  addMcpAutoApprovePrefix: (...args: unknown[]) => mockAddMcpPrefix(...args),
}));
jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    updateProject: (...args: unknown[]) => mockUpdateProject(...args),
  },
}));

import { ApprovalQuickPolicySheet } from '../src/components/vibecoding/ApprovalQuickPolicySheet';

const BALANCED_POLICY = {
  scheme: 'balanced' as const,
  version: 0,
  hash: 'sha256:b',
  rules: [],
  default_decision: 'require_approval' as const,
};

const wrap = async (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}
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
    // Flush the open → load() → fetchProjectApprovalPolicy promise chain.
    await Promise.resolve();
  });
  return renderer!;
};

/** Find a row TouchableOpacity by the title text it renders. */
const rowByTitle = (root: ReactTestRenderer.ReactTestRenderer, title: string) =>
  root.root.findAllByType(TouchableOpacity).find(c =>
    c.findAllByType(Text).some(t => String(t.props.children) === title));

const tap = (root: ReactTestRenderer.ReactTestRenderer, title: string) => {
  const btn = rowByTitle(root, title);
  act(() => {
    (btn as { props: { onPress?: () => void } } | undefined)?.props?.onPress?.();
  });
};

describe('ApprovalQuickPolicySheet', () => {
  let root: ReactTestRenderer.ReactTestRenderer;

  beforeEach(() => {
    mockFetchPolicy.mockReset();
    mockUpdateProject.mockReset();
    mockUpdateProject.mockResolvedValue({ ok: true });
    mockAddMcpPrefix.mockReset();
    mockAddMcpPrefix.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
  });

  it('switches to allow_all and fires onApplied (zh: 全部放行)', async () => {
    mockFetchPolicy.mockResolvedValue({ ...BALANCED_POLICY });
    const onApplied = jest.fn();
    root = await wrap(
      <ApprovalQuickPolicySheet
        projectId="p1"
        open
        onClose={jest.fn()}
        onApplied={onApplied}
      />,
    );
    // Sanity: the three zh presets rendered.
    expect(rowByTitle(root, '全部放行')).toBeTruthy();
    expect(rowByTitle(root, '通用放行')).toBeTruthy();
    expect(rowByTitle(root, '逐次审批')).toBeTruthy();

    await act(async () => {
      tap(root, '全部放行');
      await Promise.resolve();
    });
    expect(mockUpdateProject).toHaveBeenCalledWith('p1', {
      approval_policy: { scheme: 'allow_all' },
    });
    expect(onApplied).toHaveBeenCalledWith('allow_all');
  });

  it('switches to custom + custom_default_decision=auto_approve (zh: 通用放行)', async () => {
    mockFetchPolicy.mockResolvedValue({ ...BALANCED_POLICY });
    const onApplied = jest.fn();
    root = await wrap(
      <ApprovalQuickPolicySheet
        projectId="p1"
        open
        onClose={jest.fn()}
        onApplied={onApplied}
      />,
    );
    await act(async () => {
      tap(root, '通用放行');
      await Promise.resolve();
    });
    expect(mockUpdateProject).toHaveBeenCalledWith('p1', {
      approval_policy: { scheme: 'custom', custom_default_decision: 'auto_approve' },
    });
    expect(onApplied).toHaveBeenCalledWith('common_auto');
  });

  it('restores balanced and does NOT fire onApplied (zh: 逐次审批)', async () => {
    mockFetchPolicy.mockResolvedValue({
      scheme: 'custom',
      version: 1,
      hash: 'sha256:c',
      rules: [],
      default_decision: 'auto_approve',
    });
    const onApplied = jest.fn();
    const onClose = jest.fn();
    root = await wrap(
      <ApprovalQuickPolicySheet
        projectId="p1"
        open
        onClose={onClose}
        onApplied={onApplied}
      />,
    );
    await act(async () => {
      tap(root, '逐次审批');
      await Promise.resolve();
    });
    expect(mockUpdateProject).toHaveBeenCalledWith('p1', {
      approval_policy: { scheme: 'balanced' },
    });
    expect(onApplied).not.toHaveBeenCalled();
    // balanced just applies + closes the sheet.
    expect(onClose).toHaveBeenCalled();
  });

  it('derives the active preset from the resolved policy', async () => {
    // allow_all policy → 全部放行 row is the selected radio.
    mockFetchPolicy.mockResolvedValue({
      scheme: 'allow_all',
      version: 0,
      hash: 'sha256:a',
      rules: [],
      default_decision: 'auto_approve',
    });
    root = await wrap(
      <ApprovalQuickPolicySheet projectId="p1" open onClose={jest.fn()} />,
    );
    const allowAllRow = rowByTitle(root, '全部放行')!;
    expect(allowAllRow.props.accessibilityState.selected).toBe(true);
    const commonRow = rowByTitle(root, '通用放行')!;
    expect(commonRow.props.accessibilityState.selected).toBe(false);
  });

  it('shows MCP server + all-MCP tiers when toolName is an MCP tool', async () => {
    mockFetchPolicy.mockResolvedValue({ ...BALANCED_POLICY });
    root = await wrap(
      <ApprovalQuickPolicySheet
        projectId="p1"
        open
        onClose={jest.fn()}
        toolName="mcp__serena__find_symbol"
      />,
    );
    // zh: mcpTier.title = "放行 {{label}}" → "放行 mcp__serena__*"
    expect(rowByTitle(root, '放行 mcp__serena__*')).toBeTruthy();
    // zh: mcpAll.title = "放行所有 MCP 工具"
    expect(rowByTitle(root, '放行所有 MCP 工具')).toBeTruthy();
  });

  it('adds the server MCP prefix and fires onApplied on tap', async () => {
    mockFetchPolicy.mockResolvedValue({ ...BALANCED_POLICY });
    const onApplied = jest.fn();
    root = await wrap(
      <ApprovalQuickPolicySheet
        projectId="p1"
        open
        onClose={jest.fn()}
        onApplied={onApplied}
        toolName="mcp__serena__find_symbol"
      />,
    );
    await act(async () => {
      tap(root, '放行 mcp__serena__*');
      await Promise.resolve();
    });
    expect(mockAddMcpPrefix).toHaveBeenCalledWith('p1', 'mcp__serena__');
    expect(mockUpdateProject).not.toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalledWith('mcp');
  });

  it('does NOT show MCP tiers for a non-MCP tool (Bash)', async () => {
    mockFetchPolicy.mockResolvedValue({ ...BALANCED_POLICY });
    root = await wrap(
      <ApprovalQuickPolicySheet projectId="p1" open onClose={jest.fn()} toolName="Bash" />,
    );
    expect(rowByTitle(root, '放行所有 MCP 工具')).toBeFalsy();
  });

  it('highlights an MCP tier already active on the project', async () => {
    mockFetchPolicy.mockResolvedValue({
      ...BALANCED_POLICY,
      mcp_auto_approve_prefixes: ['mcp__serena__'],
    });
    root = await wrap(
      <ApprovalQuickPolicySheet
        projectId="p1"
        open
        onClose={jest.fn()}
        toolName="mcp__serena__find_symbol"
      />,
    );
    const serverRow = rowByTitle(root, '放行 mcp__serena__*')!;
    expect(serverRow.props.accessibilityState.selected).toBe(true);
  });
});

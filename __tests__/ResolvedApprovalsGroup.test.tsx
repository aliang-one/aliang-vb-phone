import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ResolvedApprovalsGroup } from '../src/components/vibecoding/ResolvedApprovalsGroup';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import type { ApprovalRequest } from '../src/store/types';

const approval = (id: string): ApprovalRequest => ({
  id,
  kind: 'tool',
  title: `Approval ${id}`,
  summary: 'Resolved approval',
  deviceId: 'device-1',
  risk: 'low',
  status: 'approved',
  createdAt: '2026-06-22T00:00:00.000Z',
  resolvedAt: '2026-06-22T00:01:00.000Z',
});

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

const texts = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAllByType(Text).map(item => String(item.props.children));

describe('ResolvedApprovalsGroup', () => {
  it('collapses from the bottom of a long resolved approval list', () => {
    const root = wrap(
      <ResolvedApprovalsGroup
        approvals={[approval('1'), approval('2'), approval('3')]}
        renderCard={item => <Text>{item.title}</Text>}
      />,
    );

    expect(texts(root)).not.toContain('Approval 1');

    act(() => {
      root.root.findByProps({ testID: 'resolved-approvals-toggle' }).props.onPress();
    });
    expect(texts(root)).toContain('Approval 1');
    expect(texts(root)).toContain('▴ 收起');

    act(() => {
      root.root
        .findByProps({ testID: 'resolved-approvals-collapse-bottom' })
        .props.onPress();
    });
    expect(texts(root)).not.toContain('Approval 1');
  });
});

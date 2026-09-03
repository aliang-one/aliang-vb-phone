import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, TouchableOpacity } from 'react-native';
import { PortMappingCard } from '../src/components/devices/PortMappingCard';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import type { PortMapping } from '../src/api/portMappings';

function mapping(overrides: Partial<PortMapping> = {}): PortMapping {
  return {
    id: 'mapping-1',
    slug: 'abc123',
    user_id: 'user-1',
    device_id: 'device-1',
    target_host: '127.0.0.1',
    target_port: 3000,
    upstream_scheme: 'http',
    status: 'active',
    created_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    short_url: 'https://t.example.com/abc123',
    ...overrides,
  };
}

function renderCard(props: Parameters<typeof PortMappingCard>[0]) {
  return ReactTestRenderer.create(
    <ThemeContext.Provider
      value={{
        theme: utilityMinimalist,
        mode: 'light',
        setMode: jest.fn(),
        isDark: false,
      }}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        }}>
        <PortMappingCard {...props} />
      </SafeAreaProvider>
    </ThemeContext.Provider>,
  );
}

const allText = (root: ReactTestRenderer.ReactTestInstance): string =>
  root
    .findAllByType(Text)
    .map(node => {
      const children = node.props.children;
      if (typeof children === 'string') return children;
      if (Array.isArray(children)) {
        return children.filter(child => typeof child === 'string').join('');
      }
      return '';
    })
    .join('\n');

const noopProps = {
  copied: false,
  revoking: false,
  onCopy: jest.fn(),
  onOpen: jest.fn(),
  onRevoke: jest.fn(),
};

describe('PortMappingCard', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = undefined;
    jest.clearAllMocks();
  });

  it('renders the project tag chip and session source label when tagged', () => {
    act(() => {
      screen = renderCard({
        ...noopProps,
        mapping: mapping({
          tag: {
            project_id: 'project-1',
            project_name: 'X 项目',
            source: 'session_preview',
            created_at: new Date().toISOString(),
          },
        }),
      });
    });

    const text = allText(screen!.root);
    expect(text).toContain('X 项目');
    expect(text).toContain('会话自动');
  });

  it('renders no source row when the mapping is untagged', () => {
    act(() => {
      screen = renderCard({ ...noopProps, mapping: mapping() });
    });

    const text = allText(screen!.root);
    expect(text).not.toContain('会话自动');
    expect(text).not.toContain('项目内新建');
    expect(text).not.toContain('手动新建');
  });

  it('renders active status chip and target host:port', () => {
    act(() => {
      screen = renderCard({ ...noopProps, mapping: mapping() });
    });

    const text = allText(screen!.root);
    expect(text).toContain('使用中');
    // i18n template '{{host}}:{{port}}' with target 127.0.0.1:443.
    expect(text).toContain(`127.0.0.1:${mapping().target_port}`);
  });

  it('wires the three actions to onCopy / onOpen / onRevoke', () => {
    act(() => {
      screen = renderCard({ ...noopProps, mapping: mapping() });
    });

    const buttons = screen!.root.findAllByType(TouchableOpacity);
    expect(buttons).toHaveLength(3);

    act(() => {
      buttons[0].props.onPress();
    });
    expect(noopProps.onCopy).toHaveBeenCalledTimes(1);

    act(() => {
      buttons[1].props.onPress();
    });
    expect(noopProps.onOpen).toHaveBeenCalledTimes(1);

    act(() => {
      buttons[2].props.onPress();
    });
    expect(noopProps.onRevoke).toHaveBeenCalledTimes(1);
  });
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useSessionStore } from '../stores/useSettingsStore';
import { RingMeter } from '../src/components/visual/RingMeter';

jest.mock('../src/services/localNotifications', () => ({
  displayNotification: jest.fn().mockResolvedValue({ ok: true }),
  getNotificationPermissionStatus: jest.fn().mockResolvedValue('granted'),
  openNotificationSettings: jest.fn().mockResolvedValue(true),
  requestPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('@react-navigation/native', () => {
  const ReactActual = require('react');
  return {
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactActual.useEffect(() => cb(), []);
    },
    useRoute: () => ({ params: {} }),
  };
});

jest.mock('../src/i18n/useLocale', () => ({
  useLocale: () => ({ locale: 'en', setLocale: jest.fn() }),
}));

// 挂重的无关子组件打桩,让本套件聚焦 usage 四环布局(RingMeter 保持真实现)。
jest.mock('../src/components/vibecoding/UsageSummaryCard', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { UsageSummaryCard: () => R.createElement(View, null) };
});
jest.mock('../src/components/account/UserModelDefaultCard', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { UserModelDefaultCard: () => R.createElement(View, null) };
});

import { SettingsScreen } from '../src/screens/settings/SettingsScreen';

const flattenStyle = (style: unknown): Record<string, unknown> => {
  const flat: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (!s) return;
    if (Array.isArray(s)) {
      s.forEach(walk);
      return;
    }
    Object.assign(flat, s as Record<string, unknown>);
  };
  walk(style);
  return flat;
};

const renderScreen = () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          }}>
          <SettingsScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return renderer;
};

// usage 四环必须单行排布(原来 48% 宽 + wrap 折成两行):
// 1) 恰好 4 个 RingMeter;2) 四环同尺寸且随屏宽收敛(4×size ≤ 可用宽);
// 3) cell flex:1 等分、行容器不换行。
describe('Me 页 usage 四环单行布局', () => {
  beforeEach(() => {
    useSessionStore.setState({
      accountData: {
        profile: { balance: 10 },
        subscriptions: [],
        usageStats: {
          total_tokens: 12345,
          total_actual_cost: 0.05,
          total_requests: 42,
        },
        loadedAt: '2026-09-23T00:00:00.000Z',
      } as never,
    });
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {});
  });

  it('renders the four rings in a single unwrapped row, sized to fit', () => {
    act(() => {
      Dimensions.set({ window: { width: 390, height: 844 } as never });
    });
    const root = renderScreen().root;

    const rings = root.findAllByType(RingMeter);
    expect(rings).toHaveLength(4);

    // 390 - 页面左右内边距32 - 面板左右内边距32 = 326;每环 ≤ 326/4 ≈ 81。
    const sizes = new Set(rings.map(r => r.props.size));
    expect(sizes.size).toBe(1);
    const size = rings[0].props.size as number;
    expect(size).toBeLessThanOrEqual(Math.floor((390 - 64) / 4));

    // cell 等分(flex:1)而非 48% 定宽 → 永不折行。
    for (const ring of rings) {
      const cell = flattenStyle(ring.parent!.props.style);
      expect(cell.flex).toBe(1);
      expect(cell.width).toBeUndefined();
    }

    // 行容器不换行。
    const row = flattenStyle(rings[0].parent!.parent!.props.style);
    expect(row.flexWrap).not.toBe('wrap');
  });

  it('shrinks the rings further on narrow screens instead of wrapping', () => {
    act(() => {
      Dimensions.set({ window: { width: 320, height: 568 } as never });
    });
    const root = renderScreen().root;

    const rings = root.findAllByType(RingMeter);
    expect(rings).toHaveLength(4);
    const size = rings[0].props.size as number;
    expect(size).toBeLessThanOrEqual(Math.floor((320 - 64) / 4));
    expect(size).toBeGreaterThanOrEqual(56); // 下限:环内文字仍可读
  });
});

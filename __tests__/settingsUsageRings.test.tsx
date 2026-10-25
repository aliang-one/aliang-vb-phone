import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useSessionStore } from '../stores/useSettingsStore';
import { useControlCenterStore } from '../src/store/controlCenterStore';
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

// 收集整棵树里的纯文本(Text children),用于断言计费/套餐面是否出现。
// Text 的 children 可能是字符串,也可能是混排数组(如 `$3.50 / $100.00` 由
// `$`+表达式拼成)——数组分支把本节点内的原始值按序拼回完整字符串。
const collectTexts = (root: ReactTestRenderer.ReactTestInstance): string[] => {
  const out: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestInstance) => {
    const children = node.props.children;
    if (typeof children === 'string' || typeof children === 'number') {
      out.push(String(children));
    } else if (Array.isArray(children)) {
      const joined = children
        .map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
        .join('');
      if (joined) out.push(joined);
    }
    for (const child of node.children) {
      if (child && typeof child === 'object') {
        walk(child as ReactTestRenderer.ReactTestInstance);
      }
    }
  };
  walk(root);
  return out;
};

// 一条带完整 group 信息的订阅(套餐名/类型/月上限都会被 Me 页渲染)。
const subscriptionFixture = {
  id: 'sub-1',
  user_id: 'u1',
  group_id: 'g1',
  starts_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2027-01-01T00:00:00.000Z',
  status: 'active',
  monthly_usage_usd: 3.5,
  group: {
    id: 'g1',
    name: 'PRO_GROUP_X',
    platform: 'claude',
    rate_multiplier: 1,
    subscription_type: 'monthly',
    status: 'active',
    monthly_limit_usd: 100,
  },
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
    // 本组用例验证「门户开关打开时」的四环布局;显式打开开关(生产由 server
    // snapshot features 下发,默认隐藏)。
    useControlCenterStore.setState({
      platformFeatures: { accountPortalVisible: true },
    });
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

  // 账号门户开关(server 下发)关闭 = 审核安全默认:Account/Usage/套餐 区块连同
  // 四环整体不渲染,避免计费/套餐面暴露给 App Store 审核。
  it('keeps the account/usage sections hidden when the portal flag is off', () => {
    act(() => {
      useControlCenterStore.setState({
        platformFeatures: { accountPortalVisible: false },
      });
      useSessionStore.setState({
        accountData: {
          profile: { balance: 10 },
          subscriptions: [subscriptionFixture],
          usageStats: {
            total_tokens: 12345,
            total_actual_cost: 0.05,
            total_requests: 42,
          },
          loadedAt: '2026-09-23T00:00:00.000Z',
        } as never,
      });
      Dimensions.set({ window: { width: 390, height: 844 } as never });
    });
    const root = renderScreen().root;

    // Usage 四环只存在于被门控的 usage 区块——隐藏即 0。
    expect(root.findAllByType(RingMeter)).toHaveLength(0);

    // 套餐面同样必须消失:套餐名、月用量/上限、头部套餐类型 chip 全不出现。
    const texts = collectTexts(root).join('\n');
    expect(texts).not.toContain('PRO_GROUP_X');
    expect(texts).not.toContain('$3.50 / $100.00');
    expect(texts).not.toContain('MONTHLY');
  });

  // 对照组:开关打开时同一份订阅数据正常渲染(证明隐藏是门控所致而非数据缺失)。
  it('renders subscription rows and the plan chip when the portal flag is on', () => {
    act(() => {
      useControlCenterStore.setState({
        platformFeatures: { accountPortalVisible: true },
      });
      useSessionStore.setState({
        accountData: {
          profile: { balance: 10 },
          subscriptions: [subscriptionFixture],
          usageStats: {
            total_tokens: 12345,
            total_actual_cost: 0.05,
            total_requests: 42,
          },
          loadedAt: '2026-09-23T00:00:00.000Z',
        } as never,
      });
      Dimensions.set({ window: { width: 390, height: 844 } as never });
    });
    const root = renderScreen().root;

    expect(root.findAllByType(RingMeter)).toHaveLength(4);
    const texts = collectTexts(root).join('\n');
    expect(texts).toContain('PRO_GROUP_X');
    expect(texts).toContain('$3.50 / $100.00');
    expect(texts).toContain('MONTHLY');
  });
});

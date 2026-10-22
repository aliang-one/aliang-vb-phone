/**
 * TerminalCardMenuSheet — 有效期(燃尽条 + 续期)+ 删除移底。
 * BottomSheet/GlowButton 整体 stub(参照 UpdateAvailableSheet.test.tsx 惯例),
 * 只锁本组件自己的逻辑:燃尽条/剩余时长随 expiresAt 渲染、无过期文案、死会话
 * 不出面板、离线禁续期、续期回调与失败反馈、菜单行顺序(删除固定最底);
 * i18n 文本真键断言(防键名错位渲染裸 key)。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { TerminalCardMenuSheet } from '../TerminalCardMenuSheet';
import { serverTerminalSessionToClient } from '../../../store/internals';
import type { TerminalSession } from '../../../store/types';

jest.mock('../../shared/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BottomSheet: (props: {
      open: boolean;
      children?: React.ReactNode;
      testID?: string;
    }) => (props.open ? React.createElement(View, { testID: 'bottom-sheet-stub' }, props.children) : null),
  };
});

const HOUR = 3_600_000;

const makeTerminal = (over: Partial<TerminalSession> = {}): TerminalSession => ({
  id: 'term-1',
  deviceId: 'device-1',
  directory: '~/proj',
  shell: 'zsh',
  status: 'running',
  lines: [],
  createdAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});

const now = Date.now();

const renderSheet = (
  terminal: TerminalSession,
  props: Partial<React.ComponentProps<typeof TerminalCardMenuSheet>> = {},
) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <TerminalCardMenuSheet
        open
        onClose={() => undefined}
        terminal={terminal}
        onDelete={() => undefined}
        onScan={() => undefined}
        {...props}
      />,
    );
  });
  return renderer;
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('TerminalCardMenuSheet 有效期面板', () => {
  it('有窗口 → 燃尽条 + 剩余时长(真实 i18n 文本),续期三档齐全', () => {
    const terminal = makeTerminal({
      ttlGrantedAt: new Date(now - 3 * HOUR).toISOString(),
      expiresAt: new Date(now + 21 * HOUR).toISOString(), // 窗口 24h,剩 21h → 87.5%
    });
    const renderer = renderSheet(terminal, { onRenew: jest.fn() });

    const panel = renderer.root.findByProps({ testID: 'terminal-menu-lifetime' });
    expect(panel).toBeTruthy();
    // 剩余时长是真实 i18n 文本(zh: "剩余 21 小时 0 分"),不是裸 key。
    const remaining = String(
      renderer.root.findByProps({ testID: 'terminal-menu-lifetime-remaining' })
        .props.children,
    );
    expect(remaining).toContain('剩余');
    expect(remaining).toContain('21');

    const burn = renderer.root.findByProps({
      testID: 'terminal-menu-lifetime-burn',
    });
    expect(burn).toBeTruthy();
    // 内层 fill 宽度按剩余比例渲染(87.5% → 88%,四舍五入)。
    const fill = burn.props.children as { props: { width: string } };
    expect(fill.props.width).toBe('88%');

    expect(renderer.root.findByProps({ testID: 'terminal-menu-renew-1' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'terminal-menu-renew-6' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'terminal-menu-renew-24' })).toBeTruthy();
  });

  it('无窗口 → 显示「未设置有效期」,不渲染燃尽条,续期仍可用', () => {
    const renderer = renderSheet(makeTerminal(), { onRenew: jest.fn() });
    const texts: string[] = [];
    renderer.root.findAllByType(Text).forEach(node => {
      const value = node.props.children;
      if (typeof value === 'string') texts.push(value);
    });
    expect(texts.some(value => value.includes('未设置有效期'))).toBe(true);
    expect(() =>
      renderer.root.findByProps({ testID: 'terminal-menu-lifetime-burn' }),
    ).toThrow();
    expect(renderer.root.findByProps({ testID: 'terminal-menu-renew-24' })).toBeTruthy();
  });

  it('死会话 → 不出有效期面板,续期按钮不渲染', () => {
    const renderer = renderSheet(
      makeTerminal({
        status: 'completed',
        expiresAt: new Date(now + HOUR).toISOString(),
        ttlGrantedAt: new Date(now - HOUR).toISOString(),
      }),
      { onRenew: jest.fn() },
    );
    expect(() =>
      renderer.root.findByProps({ testID: 'terminal-menu-lifetime' }),
    ).toThrow();
    expect(() =>
      renderer.root.findByProps({ testID: 'terminal-menu-renew-24' }),
    ).toThrow();
  });

  it('设备离线 → 续期禁用并提示,删除同样禁用', () => {
    const onRenew = jest.fn().mockResolvedValue(undefined);
    const renderer = renderSheet(
      makeTerminal({
        expiresAt: new Date(now + HOUR).toISOString(),
        ttlGrantedAt: new Date(now - HOUR).toISOString(),
      }),
      { onRenew, deleteDisabled: true },
    );
    const texts: string[] = [];
    renderer.root.findAllByType(Text).forEach(node => {
      const value = node.props.children;
      if (typeof value === 'string') texts.push(value);
    });
    expect(texts.some(value => value.includes('设备离线，无法续期'))).toBe(true);
    const chip = renderer.root.findByProps({ testID: 'terminal-menu-renew-24' });
    expect(chip.props.disabled).toBe(true);
    expect(renderer.root.findByProps({ testID: 'terminal-menu-delete' }).props.disabled).toBe(true);
  });

  it('点续期 → 以所选小时数回调;失败时给错误反馈', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    const renderer = renderSheet(
      makeTerminal({
        expiresAt: new Date(now + HOUR).toISOString(),
        ttlGrantedAt: new Date(now - HOUR).toISOString(),
      }),
      { onRenew: failing },
    );
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'terminal-menu-renew-6' })
        .props.onPress();
    });
    expect(failing).toHaveBeenCalledWith(6);
    expect(
      renderer.root.findByProps({ testID: 'terminal-menu-renew-error' }),
    ).toBeTruthy();

    const ok = jest.fn().mockResolvedValue(undefined);
    const renderer2 = renderSheet(
      makeTerminal({
        expiresAt: new Date(now + HOUR).toISOString(),
        ttlGrantedAt: new Date(now - HOUR).toISOString(),
      }),
      { onRenew: ok },
    );
    await act(async () => {
      renderer2.root
        .findByProps({ testID: 'terminal-menu-renew-24' })
        .props.onPress();
    });
    expect(ok).toHaveBeenCalledWith(24);
    expect(() =>
      renderer2.root.findByProps({ testID: 'terminal-menu-renew-error' }),
    ).toThrow();
  });

  it('删除固定在最底部(扫码/简介之后)', () => {
    const renderer = renderSheet(makeTerminal(), { onRenew: jest.fn() });
    const ids = renderer.root
      .findAllByType(TouchableOpacity)
      .map(node => node.props.testID)
      .filter(Boolean);
    expect(ids).toEqual([
      'terminal-menu-scan',
      'terminal-menu-info',
      'terminal-menu-delete',
    ]);
  });

  it('简介页带「有效期」行(无过期显示未设置)', () => {
    const renderer = renderSheet(makeTerminal(), { onRenew: jest.fn() });
    act(() => {
      renderer.root.findByProps({ testID: 'terminal-menu-info' }).props.onPress();
    });
    const texts: string[] = [];
    renderer.root.findAllByType(Text).forEach(node => {
      const value = node.props.children;
      if (typeof value === 'string') texts.push(value);
    });
    expect(texts.some(value => value === '有效期')).toBe(true);
    expect(texts.some(value => value.includes('未设置有效期'))).toBe(true);
  });
});

describe('serverTerminalSessionToClient 有效期映射', () => {
  it('snake_case 直透 expires_at/ttl_granted_at(都缺 = 无过期)', () => {
    const base = {
      session_id: 'srv-1',
      kind: 'terminal' as const,
      user_id: 'u1',
      device_id: 'dev-1',
      status: 'active' as const,
      cols: 80,
      rows: 24,
      created_at: new Date(now - HOUR).toISOString(),
      last_active_at: new Date(now).toISOString(),
    };
    const withWindow = serverTerminalSessionToClient({
      ...base,
      ttl_granted_at: new Date(now - 2 * HOUR).toISOString(),
      expires_at: new Date(now + 22 * HOUR).toISOString(),
    });
    expect(withWindow.expiresAt).toBe(
      new Date(now + 22 * HOUR).toISOString(),
    );
    expect(withWindow.ttlGrantedAt).toBe(
      new Date(now - 2 * HOUR).toISOString(),
    );

    const legacy = serverTerminalSessionToClient(base);
    expect(legacy.expiresAt).toBeUndefined();
    expect(legacy.ttlGrantedAt).toBeUndefined();
  });
});

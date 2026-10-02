/**
 * C5: terminal quota kill-reason humanization.
 *
 * Cross-repo contract (Go agent, agent_terminal.go killTerminalSession): a
 * quota kill arrives on the wire as `terminal.error` whose `error` text is
 * prefixed with one of:
 *   quota_unanswered: output quota exhausted (unanswered checkpoint %d bytes) — …
 *   quota_hard_cap:    output quota exhausted (hard cap %d bytes) — …
 *   quota_denied:      output quota challenge denied by user
 *
 * These tests cover the full phone-side chain, one hop per block:
 *   wire frame → normalized transport event (`reason`)
 *   → store (`TerminalSession.exitReason`)
 *   → DeviceTerminalScreen humanized banner (`terminals:exitReason.*`),
 * with non-quota errors pinned to the existing generic copy (zero regression).
 */
import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// ── Wire-level socket capture (same shape as terminalQuotaTransport.test.ts):
// the REAL platformTransport runs against a mocked mobile socket, so the
// terminal.error frame normalization is exercised end-to-end below.
type SocketHandler = (message: Record<string, unknown>) => void;
let socketHandler: SocketHandler | undefined;
jest.mock('../src/services/websocket', () => ({
  connectMobileSocket: jest.fn((handler: SocketHandler) => {
    socketHandler = handler;
    return { connected: true };
  }),
  disconnectMobileSocket: jest.fn(() => {
    socketHandler = undefined;
  }),
  getActiveSocket: jest.fn(() => ({ connected: true, send: jest.fn() })),
}));

// ── Store-side transport mock (same shape as terminalQuotaStore.test.ts): the
// real store slice runs; only the socket send path is stubbed.
jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    loadDeviceTerminalCommands: jest.fn(),
    loadTerminalCommandHistory: jest.fn(),
    closeTerminalSession: jest.fn(),
    send: jest.fn(),
  },
}));

import { platformTransport } from '../src/services/platformTransport';
import type { PlatformTransportEvent } from '../src/services/platformTransport';
import { DeviceTerminalScreen } from '../src/screens/devices/DeviceTerminalScreen';
import { terminalQuotaExitKind } from '../src/utils/terminalExitReason';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { TerminalSession } from '../src/store/types';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import terminalsEn from '../src/i18n/locales/terminals/en.json';
import terminalsZh from '../src/i18n/locales/terminals/zh.json';

// The AI-suggest hook is stubbed (same rationale as DeviceTerminalScreen
// tests): these tests own the kill-reason banner, not STT/commandGen.
jest.mock('../src/hooks/useAiCommandSuggestions', () => ({
  useAiCommandSuggestions: () => ({
    phase: 'idle',
    chips: [],
    liveCaption: '',
    progress: null,
    errorText: '',
    textMode: false,
    voiceStatus: 'idle',
    startVoice: jest.fn(),
    stopVoice: jest.fn(),
    submitText: jest.fn(),
    retry: jest.fn(),
    clearChips: jest.fn(),
    dismissError: jest.fn(),
    openTextInput: jest.fn(),
    closeTextInput: jest.fn(),
    reset: jest.fn(),
  }),
}));

jest.mock('../src/components/terminal/TerminalEmulator', () => ({
  TerminalEmulator: ({ onRendered }: { onRendered?: () => void }) => {
    const MockReact = require('react');
    const { View } = require('react-native');
    MockReact.useEffect(() => {
      onRendered?.();
    }, []);
    return MockReact.createElement(View, { testID: 'terminal-emulator' });
  },
}));

let mockRouteParams: { deviceId: string; directory?: string; terminalId?: string } =
  { deviceId: 'device-1', directory: '~/project', terminalId: 'term-1' };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => false,
    navigate: jest.fn(),
    goBack: jest.fn(),
    setParams: jest.fn(),
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

const QUOTA_UNANSWERED_TEXT =
  'quota_unanswered: output quota exhausted (unanswered checkpoint 268435456 bytes) — for long-running noisy commands use: <cmd> > log 2>&1';
const QUOTA_HARD_CAP_TEXT =
  'quota_hard_cap: output quota exhausted (hard cap 536870912 bytes) — for long-running noisy commands use: <cmd> > log 2>&1';
const QUOTA_DENIED_TEXT = 'quota_denied: output quota challenge denied by user';
const FLOOD_TEXT =
  'terminal output flood limit exceeded (max 52428800 bytes per 10s)';

// ─────────────────────────────────────────────────────────────────────────
// Pure prefix→kind mapper
// ─────────────────────────────────────────────────────────────────────────
describe('terminalQuotaExitKind (prefix contract)', () => {
  it.each([
    [QUOTA_UNANSWERED_TEXT, 'quota_unanswered'],
    [QUOTA_HARD_CAP_TEXT, 'quota_hard_cap'],
    [QUOTA_DENIED_TEXT, 'quota_denied'],
  ] as const)('maps %s prefix to its kind', (reason, kind) => {
    expect(terminalQuotaExitKind(reason)).toBe(kind);
  });

  it('returns null for non-quota errors so the existing copy stays', () => {
    expect(terminalQuotaExitKind(FLOOD_TEXT)).toBeNull();
    expect(terminalQuotaExitKind('terminal session not found: term-1')).toBeNull();
  });

  it('returns null for absent or unknown quota reasons', () => {
    expect(terminalQuotaExitKind(undefined)).toBeNull();
    expect(terminalQuotaExitKind('')).toBeNull();
    // Future quota variants must fall back to the generic copy, not guess.
    expect(terminalQuotaExitKind('quota_future: …')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// i18n resources (en exists + zh carries the mandated advice)
// ─────────────────────────────────────────────────────────────────────────
describe('terminals:exitReason i18n resources', () => {
  const kinds = ['quota_unanswered', 'quota_hard_cap', 'quota_denied'] as const;

  it.each(kinds)('has a non-empty zh + en string for %s', kind => {
    expect(typeof terminalsZh.exitReason[kind]).toBe('string');
    expect((terminalsZh.exitReason[kind] as string).length).toBeGreaterThan(0);
    expect(typeof terminalsEn.exitReason[kind]).toBe('string');
    expect((terminalsEn.exitReason[kind] as string).length).toBeGreaterThan(0);
  });

  it('zh copy conveys the limit hit and the > log redirection advice', () => {
    expect(terminalsZh.exitReason.quota_unanswered).toContain('配额');
    expect(terminalsZh.exitReason.quota_unanswered).toContain('log 2>&1');
    expect(terminalsZh.exitReason.quota_hard_cap).toContain('log 2>&1');
    expect(terminalsZh.exitReason.quota_denied).toContain('终止');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Transport: terminal.error wire frame → normalized reason
// ─────────────────────────────────────────────────────────────────────────
describe('platformTransport terminal.error reason normalization', () => {
  const realTransport = (
    jest.requireActual as typeof jest.requireActual<{
      platformTransport: typeof platformTransport;
    }>
  )('../src/services/platformTransport').platformTransport;

  beforeEach(() => {
    socketHandler = undefined;
    jest.clearAllMocks();
  });

  afterEach(() => {
    realTransport.disconnect();
  });

  it('keeps the quota kill error text as `reason` on the normalized exit event', () => {
    const events: PlatformTransportEvent[] = [];
    realTransport.connect(event => {
      events.push(event);
    });
    const frame = {
      type: 'terminal.error',
      session_id: 'ts_1',
      error: QUOTA_UNANSWERED_TEXT,
    };
    act(() => {
      socketHandler?.(frame);
    });

    expect(events).toHaveLength(1);
    const exit = events[0] as Extract<
      PlatformTransportEvent,
      { type: 'terminal.exit' }
    >;
    expect(exit.type).toBe('terminal.exit');
    expect(exit.sessionId).toBe('ts_1');
    expect(exit.failed).toBe(true);
    expect(exit.reason).toBe(QUOTA_UNANSWERED_TEXT);
  });

  it('leaves reason unset for a plain terminal.exit frame', () => {
    const events: PlatformTransportEvent[] = [];
    realTransport.connect(event => {
      events.push(event);
    });
    act(() => {
      socketHandler?.({
        type: 'terminal.exit',
        session_id: 'ts_1',
        exit_code: 0,
      });
    });

    const exit = events[0] as Extract<
      PlatformTransportEvent,
      { type: 'terminal.exit' }
    >;
    expect(exit.failed).toBe(false);
    expect(exit.reason).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Store: exit reason lands on (and is cleared from) the session
// ─────────────────────────────────────────────────────────────────────────
describe('store exitReason bookkeeping', () => {
  const handle = (event: PlatformTransportEvent) => {
    useControlCenterStore.getState().handleTransportEvent(event);
  };

  const baseSession: TerminalSession = {
    id: 'term-1',
    deviceId: 'device-1',
    directory: '~/project',
    shell: 'zsh',
    status: 'running',
    lines: [],
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  };

  const sessionWith = (overrides: Partial<TerminalSession>) => ({
    ...baseSession,
    ...overrides,
  });

  beforeEach(() => {
    useControlCenterStore.setState({
      serverMode: true,
      terminalSessions: [sessionWith({})],
      pendingChallenges: [],
      events: [],
    });
  });

  const session = (): TerminalSession | undefined =>
    useControlCenterStore
      .getState()
      .terminalSessions.find(ts => ts.id === 'term-1');

  it('stores the raw reason verbatim on terminal.exit and marks the session failed', () => {
    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: true,
      reason: QUOTA_DENIED_TEXT,
      raw: {},
    });

    expect(session()?.status).toBe('failed');
    expect(session()?.exitReason).toBe(QUOTA_DENIED_TEXT);
  });

  it('drops the pending challenge for the killed session (C3 rule intact)', () => {
    useControlCenterStore.setState({
      pendingChallenges: [
        {
          challengeId: 'chal-1',
          sessionId: 'term-1',
          seq: 1,
          usedBytes: 1,
          killAtBytes: 2,
          maxBytes: 3,
        },
      ],
    });
    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: true,
      reason: QUOTA_UNANSWERED_TEXT,
      raw: {},
    });

    expect(useControlCenterStore.getState().pendingChallenges).toEqual([]);
  });

  it('clears a stale reason on a plain (non-error) exit', () => {
    // Corrected semantics (was: a plain exit wiped the reason directly — that
    // exactly reproduced the real Go double-frame bug below). Stale reasons
    // die at REBIRTH instead: created/resumed resets, so a clean reuse cycle
    // still ends with no reason.
    useControlCenterStore.setState({
      terminalSessions: [
        sessionWith({ status: 'failed', exitReason: QUOTA_DENIED_TEXT }),
      ],
    });
    handle({
      type: 'terminal.created',
      sessionId: 'term-1',
      raw: { resumed: true },
    });
    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: false,
      raw: {},
    });

    expect(session()?.status).toBe('completed');
    expect(session()?.exitReason).toBeUndefined();
  });

  it('introduces no reason on a plain exit of a fresh session', () => {
    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: false,
      raw: {},
    });

    expect(session()?.status).toBe('completed');
    expect(session()?.exitReason).toBeUndefined();
  });

  // Real Go kill sequence (agent_terminal.go): killTerminalSession emits the
  // terminal.error reason frame, then the process dies and the waitTerminal
  // goroutine emits a PLAIN terminal.exit (the waiter maps signal kills to
  // (exitCode, nil) — no error field). The bookkeeping frame must not erase
  // the kill reason the first frame just established.
  it('keeps the quota_unanswered kill reason across the follow-up plain exit frame (double frame)', () => {
    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: true,
      reason: QUOTA_UNANSWERED_TEXT,
      raw: {},
    });
    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: false,
      raw: { exit_code: -1 },
    });

    expect(session()?.status).toBe('completed');
    expect(session()?.exitReason).toBe(QUOTA_UNANSWERED_TEXT);
  });

  it('keeps the quota_denied kill reason across the follow-up plain exit frame', () => {
    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: true,
      reason: QUOTA_DENIED_TEXT,
      raw: {},
    });
    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: false,
      raw: { exit_code: -1 },
    });

    expect(session()?.exitReason).toBe(QUOTA_DENIED_TEXT);
  });

  it('clears the reason when the session is created/resumed again', () => {
    useControlCenterStore.setState({
      terminalSessions: [
        sessionWith({ status: 'failed', exitReason: QUOTA_HARD_CAP_TEXT }),
      ],
    });
    handle({
      type: 'terminal.created',
      sessionId: 'term-1',
      raw: { resumed: true },
    });

    expect(session()?.status).toBe('running');
    expect(session()?.exitReason).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Screen: humanized banner (zh, jest locks the locale)
// ─────────────────────────────────────────────────────────────────────────
describe('DeviceTerminalScreen quota exit-reason banner', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | null;

  const baseSession: TerminalSession = {
    id: 'term-1',
    deviceId: 'device-1',
    directory: '~/project',
    shell: 'zsh',
    status: 'failed',
    lines: [],
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  };

  const seedSession = (overrides: Partial<TerminalSession>) => {
    useControlCenterStore.setState({
      serverMode: true,
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
        },
      ],
      terminalSessions: [{ ...baseSession, ...overrides }],
      attachTerminalSession: jest.fn().mockResolvedValue('term-1'),
      createTerminalSession: jest.fn(),
      loadTerminalCommandHistory: jest.fn().mockResolvedValue(undefined),
    });
  };

  const renderScreen = async () => {
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
            <DeviceTerminalScreen />
          </SafeAreaProvider>
        </ThemeContext.Provider>,
      );
    });
    return screen!;
  };

  const allText = (root: ReactTestRenderer.ReactTestRenderer): string =>
    root.root
      .findAllByType(Text)
      .map(node => {
        const children = node.props.children;
        return Array.isArray(children)
          ? children.join('')
          : String(children ?? '');
      })
      .join(' ');

  const hasTestID = (
    root: ReactTestRenderer.ReactTestRenderer,
    testID: string,
  ): boolean =>
    root.root.findAllByProps({ testID }).length > 0;

  beforeEach(() => {
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/project',
      terminalId: 'term-1',
    };
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = null;
  });

  it('humanizes quota_unanswered on a killed-without-replay session (limit + unanswered + > log advice)', async () => {
    seedSession({ exitReason: QUOTA_UNANSWERED_TEXT });
    const root = await renderScreen();

    expect(hasTestID(root, 'terminal-exit-reason')).toBe(true);
    const text = allText(root);
    expect(text).toContain('输出已达配额上限');
    expect(text).toContain('未在期限内回应');
    expect(text).toContain('log 2>&1');
  });

  it('humanizes quota_hard_cap with the hard-ceiling copy', async () => {
    seedSession({ exitReason: QUOTA_HARD_CAP_TEXT });
    const root = await renderScreen();

    expect(hasTestID(root, 'terminal-exit-reason')).toBe(true);
    const text = allText(root);
    expect(text).toContain('硬性上限');
    expect(text).toContain('log 2>&1');
  });

  it('humanizes quota_denied as a user-chosen termination', async () => {
    seedSession({ exitReason: QUOTA_DENIED_TEXT });
    const root = await renderScreen();

    expect(hasTestID(root, 'terminal-exit-reason')).toBe(true);
    expect(allText(root)).toContain('您已选择终止');
  });

  it('keeps the existing generic copy for non-quota errors (regression guard)', async () => {
    seedSession({ exitReason: FLOOD_TEXT });
    const root = await renderScreen();

    expect(hasTestID(root, 'terminal-exit-reason')).toBe(false);
    // Placeholder dead-hint stays exactly as before.
    expect(hasTestID(root, 'terminal-dead-hint')).toBe(true);
    expect(allText(root)).toContain('会话已结束');
  });

  it('shows no banner while the session is alive', async () => {
    seedSession({ status: 'running', exitReason: undefined });
    const root = await renderScreen();

    expect(hasTestID(root, 'terminal-exit-reason')).toBe(false);
  });

  it('keeps the reason visible next to the ended-replay banner (re-attach after kill)', async () => {
    seedSession({
      status: 'completed',
      replayStatus: 'exited',
      replayReady: true,
      replayChunks: ['$ '],
      exitReason: QUOTA_UNANSWERED_TEXT,
    });
    const root = await renderScreen();

    expect(hasTestID(root, 'terminal-ended-bar')).toBe(true);
    expect(allText(root)).toContain('以下为历史输出');
    expect(hasTestID(root, 'terminal-exit-reason')).toBe(true);
    expect(allText(root)).toContain('输出已达配额上限');
  });

  it('shows the reason on a dead session that still has replay chunks (live-kill while watching)', async () => {
    seedSession({
      status: 'failed',
      replayStatus: 'live',
      replayReady: true,
      replayChunks: ['$ cargo build'],
      exitReason: QUOTA_HARD_CAP_TEXT,
    });
    const root = await renderScreen();

    expect(hasTestID(root, 'terminal-emulator')).toBe(true);
    expect(hasTestID(root, 'terminal-exit-reason')).toBe(true);
    expect(allText(root)).toContain('硬性上限');
  });

  // End-to-end double frame (the real Go kill sequence): the terminal.error
  // reason frame lands while the user is watching, then the waitTerminal
  // goroutine's plain terminal.exit bookkeeping frame follows. The banner
  // must survive the second frame — including the status flip to completed.
  it('keeps the humanized banner after the follow-up plain exit frame (double frame through the real store)', async () => {
    seedSession({ status: 'running' });
    const dispatch = (event: PlatformTransportEvent) => {
      act(() => {
        useControlCenterStore.getState().handleTransportEvent(event);
      });
    };
    dispatch({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: true,
      reason: QUOTA_UNANSWERED_TEXT,
      raw: {},
    });
    dispatch({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: false,
      raw: { exit_code: -1 },
    });

    const root = await renderScreen();

    expect(hasTestID(root, 'terminal-exit-reason')).toBe(true);
    expect(allText(root)).toContain('输出已达配额上限');
    // The bookkeeping frame's completed status keeps the generic dead-hint
    // path intact too (banner does not depend on status=failed).
    expect(allText(root)).toContain('会话已结束');
  });
});

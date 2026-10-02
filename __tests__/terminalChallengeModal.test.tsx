import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ChallengeModal, challengeBytesToMb } from '../src/components/ChallengeModal';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import type { TerminalQuotaChallenge } from '../src/store/types';

// Same transport mock shape as terminalQuotaStore.test.ts: the real store slice
// runs; only the socket send is stubbed so the respond message is observable.
jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    loadDeviceTerminalCommands: jest.fn(),
    loadTerminalSessionCommands: jest.fn(),
    closeTerminalSession: jest.fn(),
    send: jest.fn(),
  },
}));

const MB = 1024 * 1024;

function challenge(
  overrides: Partial<TerminalQuotaChallenge> = {},
): TerminalQuotaChallenge {
  return {
    challengeId: 'chal-1',
    sessionId: 'term-1',
    seq: 3,
    terminalName: 'zsh build',
    // 3.6 MB exercises the rounding contract: Math.round → 4 (not floor 3).
    usedBytes: 3.6 * MB,
    killAtBytes: 5 * MB,
    maxBytes: 8 * MB,
    ...overrides,
  };
}

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeContext.Provider
    value={{
      theme: utilityMinimalist,
      mode: 'light',
      setMode: jest.fn(),
      isDark: false,
    }}
  >
    {children}
  </ThemeContext.Provider>
);

const renderModal = () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Providers>
        <ChallengeModal />
      </Providers>,
    );
  });
  return renderer!;
};

const el = (
  root: ReactTestRenderer.ReactTestRenderer,
  testID: string,
): ReactTestRenderer.ReactTestInstance => root.root.findByProps({ testID });

const tap = (
  root: ReactTestRenderer.ReactTestRenderer,
  testID: string,
): void => {
  act(() => {
    el(root, testID).props.onPress();
  });
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

const sendMock = platformTransport.send as jest.Mock;

describe('ChallengeModal (terminal output quota)', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    sendMock.mockClear();
    useControlCenterStore.setState({ pendingChallenges: [] });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer!.unmount();
      });
      renderer = undefined;
    }
  });

  it('renders the head challenge: terminal name, rounded MB usage line, both buttons (zh)', () => {
    useControlCenterStore.setState({
      pendingChallenges: [challenge()],
    });
    renderer = renderModal();

    const text = allText(renderer);
    expect(text).toContain('zsh build');
    // Math.round(bytes / 1024 / 1024): 3.6 MB → 4.
    expect(text).toContain('已用 4 MB / 上限 5 MB');
    expect(el(renderer, 'quota-challenge-continue')).toBeTruthy();
    expect(el(renderer, 'quota-challenge-terminate')).toBeTruthy();
    expect(text).toContain('继续运行');
    expect(text).toContain('终止');
  });

  it('falls back to the generic terminal label when terminalName is absent', () => {
    useControlCenterStore.setState({
      pendingChallenges: [
        challenge({ challengeId: 'chal-x', terminalName: undefined }),
      ],
    });
    renderer = renderModal();

    expect(allText(renderer)).toContain('该终端');
  });

  it('继续 sends challenge.respond granted and optimistically dequeues', () => {
    useControlCenterStore.setState({
      pendingChallenges: [challenge()],
    });
    renderer = renderModal();

    tap(renderer, 'quota-challenge-continue');

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      type: 'challenge.respond',
      challengeId: 'chal-1',
      verdict: 'granted',
    });
    expect(useControlCenterStore.getState().pendingChallenges).toEqual([]);
  });

  it('终止 sends challenge.respond denied and optimistically dequeues', () => {
    useControlCenterStore.setState({
      pendingChallenges: [challenge()],
    });
    renderer = renderModal();

    tap(renderer, 'quota-challenge-terminate');

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      type: 'challenge.respond',
      challengeId: 'chal-1',
      verdict: 'denied',
    });
    expect(useControlCenterStore.getState().pendingChallenges).toEqual([]);
  });

  it('renders nothing while the queue is empty', () => {
    useControlCenterStore.setState({ pendingChallenges: [] });
    renderer = renderModal();

    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'quota-challenge-continue' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'quota-challenge-terminate' }),
    ).toHaveLength(0);
  });

  it('shows the second queued challenge right after the first is answered', () => {
    useControlCenterStore.setState({
      pendingChallenges: [
        challenge(),
        challenge({
          challengeId: 'chal-2',
          sessionId: 'term-2',
          terminalName: 'pnpm watch',
          usedBytes: 1 * MB,
          killAtBytes: 2 * MB,
        }),
      ],
    });
    renderer = renderModal();

    expect(allText(renderer)).toContain('zsh build');
    expect(allText(renderer)).not.toContain('pnpm watch');

    tap(renderer, 'quota-challenge-continue');
    expect(sendMock).toHaveBeenCalledWith({
      type: 'challenge.respond',
      challengeId: 'chal-1',
      verdict: 'granted',
    });
    // The second challenge takes over the modal without any extra interaction.
    expect(allText(renderer)).toContain('pnpm watch');
    expect(allText(renderer)).not.toContain('zsh build');
    expect(useControlCenterStore.getState().pendingChallenges).toEqual([
      expect.objectContaining({ challengeId: 'chal-2' }),
    ]);

    tap(renderer, 'quota-challenge-terminate');
    expect(sendMock).toHaveBeenCalledWith({
      type: 'challenge.respond',
      challengeId: 'chal-2',
      verdict: 'denied',
    });
    expect(useControlCenterStore.getState().pendingChallenges).toEqual([]);
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
  });
});

describe('challengeBytesToMb (MB display rounding)', () => {
  it('rounds byte counts to whole MB — 3.6 MB reads 4, not floor 3', () => {
    expect(challengeBytesToMb(0)).toBe(0);
    expect(challengeBytesToMb(3.6 * MB)).toBe(4);
    expect(challengeBytesToMb(5 * MB)).toBe(5);
  });
});

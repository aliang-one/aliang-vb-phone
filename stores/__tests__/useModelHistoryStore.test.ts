import { useModelHistoryStore } from '../useModelHistoryStore';

describe('useModelHistoryStore', () => {
  beforeEach(() => {
    useModelHistoryStore.setState({ historiesByUser: {} });
  });

  it('isolates recent models by provider', () => {
    const { rememberRecentModel } = useModelHistoryStore.getState();

    rememberRecentModel('user-1', 'claude_code', 'glm-5.1');
    rememberRecentModel('user-1', 'opencode', 'openai/gpt-5');

    expect(
      useModelHistoryStore.getState().historiesByUser['user-1'],
    ).toEqual({
      claude_code: ['glm-5.1'],
      opencode: ['openai/gpt-5'],
    });
  });

  it('does not mix model history between accounts on the same phone', () => {
    const { rememberRecentModel } = useModelHistoryStore.getState();

    rememberRecentModel('user-1', 'codex', 'gpt-5.5');
    rememberRecentModel('user-2', 'codex', 'gpt-5.4');

    expect(
      useModelHistoryStore.getState().historiesByUser['user-1']?.codex,
    ).toEqual(['gpt-5.5']);
    expect(
      useModelHistoryStore.getState().historiesByUser['user-2']?.codex,
    ).toEqual(['gpt-5.4']);
  });
});

const mockRefreshSessionCommands = jest.fn();

jest.mock('../src/api/sessions', () => {
  const actual = jest.requireActual('../src/api/sessions');
  return {
    ...actual,
    refreshSessionCommands: (...args: unknown[]) => mockRefreshSessionCommands(...args),
  };
});

import { useControlCenterStore } from '../src/store/controlCenterStore';

describe('session-scoped command capabilities', () => {
  beforeEach(() => {
    mockRefreshSessionCommands.mockReset();
    useControlCenterStore.setState({
      sessionCommands: {},
      vibeRuns: [
        { id: 's1', projectId: 'p1' },
        { id: 's2', projectId: 'p1' },
      ] as never,
      projects: [
        {
          id: 'p1',
          availableCommands: [{ name: 'legacy-project-command' }],
        },
      ] as never,
    });
  });

  it('stores refreshed capabilities on the owning session, not the project', async () => {
    mockRefreshSessionCommands.mockResolvedValue({
      source: 'agent',
      fetched_at: '2026-07-18T00:00:00.000Z',
      verified: true,
      commands: [{ name: 'review-pr', kind: 'skill', scope: 'project' }],
    });

    await useControlCenterStore.getState().refreshSessionCommands('s1', { force: true });

    expect(useControlCenterStore.getState().sessionCommands).toEqual({
      s1: [{ name: 'review-pr', kind: 'skill', scope: 'project' }],
    });
    expect(useControlCenterStore.getState().projects[0].availableCommands).toEqual([
      { name: 'legacy-project-command' },
    ]);
  });

  it('does not deduplicate refreshes across two sessions in the same project', async () => {
    mockRefreshSessionCommands
      .mockResolvedValueOnce({ source: 'agent', fetched_at: '1', commands: [{ name: 'one' }] })
      .mockResolvedValueOnce({ source: 'agent', fetched_at: '2', commands: [{ name: 'two' }] });

    await Promise.all([
      useControlCenterStore.getState().refreshSessionCommands('s1', { force: true }),
      useControlCenterStore.getState().refreshSessionCommands('s2', { force: true }),
    ]);

    expect(mockRefreshSessionCommands).toHaveBeenCalledTimes(2);
    expect(useControlCenterStore.getState().sessionCommands).toEqual({
      s1: [{ name: 'one' }],
      s2: [{ name: 'two' }],
    });
  });

  it('does not apply the one-hour gate to an unverified Claude snapshot', async () => {
    mockRefreshSessionCommands
      .mockResolvedValueOnce({
        source: 'agent',
        fetched_at: '1',
        verified: false,
        commands: [],
      })
      .mockResolvedValueOnce({
        source: 'agent',
        fetched_at: '2',
        verified: true,
        commands: [{ name: 'review-pr', kind: 'skill' }],
      });

    await useControlCenterStore.getState().refreshSessionCommands('s1', { force: true });
    await useControlCenterStore.getState().refreshSessionCommands('s1', { force: false });

    expect(mockRefreshSessionCommands).toHaveBeenNthCalledWith(1, 's1', true);
    expect(mockRefreshSessionCommands).toHaveBeenNthCalledWith(2, 's1', true);
    expect(useControlCenterStore.getState().sessionCommands.s1).toEqual([
      { name: 'review-pr', kind: 'skill' },
    ]);
  });
});

import { platformTransport } from '../src/services/platformTransport';
import { useControlCenterStore } from '../src/store/controlCenterStore';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    pauseAiSession: jest.fn(),
    resumeAiSession: jest.fn(),
  },
}));

const session = {
  id: 's1',
  title: 'Session',
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/project',
  status: 'idle',
  objective: '',
  model: 'GPT-5 Codex',
  risk: 'low',
  currentStep: 'Ready',
  branch: 'main',
  lastActivityMs: 1,
  updatedAt: 'now',
  suggestions: [],
  transcript: [],
  events: [],
  structuredEvents: [],
} as const;

describe('unsupported AI pause/resume lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [session as never],
    });
  });

  it.each([
    ['pauseAgentSession', 'Pausing is not supported'],
    ['resumeAgentSession', 'cannot be resumed'],
  ] as const)('%s rejects without producing a ghost local state', async (method, message) => {
    const before = useControlCenterStore.getState().vibeRuns.map(run => ({
      ...run,
      transcript: [...run.transcript],
      events: [...run.events],
      structuredEvents: [...run.structuredEvents],
    }));

    await expect(
      useControlCenterStore.getState()[method]('s1'),
    ).rejects.toThrow(message);

    expect(useControlCenterStore.getState().vibeRuns).toEqual(before);
    expect(platformTransport.pauseAiSession).not.toHaveBeenCalled();
    expect(platformTransport.resumeAiSession).not.toHaveBeenCalled();
  });
});

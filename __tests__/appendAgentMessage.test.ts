import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import type { VibeCodingRun } from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    sendAiMessage: jest.fn(),
  },
}));

const run = (transcript: VibeCodingRun['transcript'] = []): VibeCodingRun => ({
  id: 's1',
  title: 'run-s1',
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/proj',
  status: 'idle',
  objective: '',
  model: 'Claude Code',
  timeLimitMinutes: 60,
  elapsedMinutes: 0,
  risk: 'medium',
  currentStep: '',
  branch: 'main',
  lastActivityMs: 0,
  updatedAt: '',
  suggestions: [],
  transcript,
  events: [],
});

describe('appendAgentMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [
        run([
          {
            id: 'old-user',
            role: 'user',
            content: 'Initial prompt',
            timestamp: '09:58',
          },
          {
            id: 'old-assistant',
            role: 'assistant',
            content: 'Initial reply',
            timestamp: '09:59',
          },
        ]),
      ],
      devices: [
        {
          id: 'device-1',
          name: 'Device',
          status: 'online',
          location: '',
          os: 'macOS',
          host: 'localhost',
          cpuLoad: 0,
          memLoad: 0,
          authorizedDirectories: [],
          activePorts: [],
          projectIds: [],
          activeSessionIds: [],
          lastSeen: '',
          remoteTerminalEnabled: true,
          aiControlEnabled: true,
          capabilities: [],
          tools: [],
          history: [],
        },
      ],
    });
  });

  it('renders a user prompt optimistically at the visible tail before the request resolves', async () => {
    let resolveSend:
      | ((value: { message_id: string; status: string }) => void)
      | undefined;
    (platformTransport.sendAiMessage as jest.Mock).mockReturnValue(
      new Promise(resolve => {
        resolveSend = resolve;
      }),
    );

    const send = useControlCenterStore
      .getState()
      .appendAgentMessage('s1', 'Follow-up', 'text');

    const optimisticTranscript =
      useControlCenterStore.getState().vibeRuns[0].transcript;
    expect(optimisticTranscript.map(item => item.content)).toEqual([
      'Initial prompt',
      'Initial reply',
      'Follow-up',
    ]);
    expect(optimisticTranscript[2]).toMatchObject({
      role: 'user',
      pending: true,
    });

    resolveSend?.({ message_id: 'server-user', status: 'running' });
    await send;

    const confirmedTranscript =
      useControlCenterStore.getState().vibeRuns[0].transcript;
    expect(confirmedTranscript.map(item => item.id)).toEqual([
      'old-user',
      'old-assistant',
      'server-user',
    ]);
    expect(confirmedTranscript[2]).toMatchObject({
      role: 'user',
      content: 'Follow-up',
      pending: false,
    });
  });
});

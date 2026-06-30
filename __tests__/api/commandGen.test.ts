import { apiPost } from '../../src/api/client';
import { generateCommand } from '../../src/api/commandGen';

jest.mock('../../src/api/client', () => ({
  apiPost: jest.fn(),
}));

const mockedApiPost = apiPost as jest.MockedFunction<typeof apiPost>;

describe('generateCommand', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs the input to /api/ai/command-gen and returns the result', async () => {
    mockedApiPost.mockResolvedValue({
      command: 'git status --short',
      dangerous: false,
    });

    const result = await generateCommand({
      text: 'show git state',
      deviceId: 'd1',
      cwd: '/repo',
      mode: 'initial',
    });

    expect(mockedApiPost).toHaveBeenCalledWith('/api/ai/command-gen', {
      text: 'show git state',
      deviceId: 'd1',
      cwd: '/repo',
      mode: 'initial',
    });
    expect(result).toEqual({ command: 'git status --short', dangerous: false });
  });

  it('forwards sessionId/projectId when provided', async () => {
    mockedApiPost.mockResolvedValue({ command: 'ls', dangerous: false });
    await generateCommand({
      text: 'list files',
      deviceId: 'd1',
      cwd: '/r',
      mode: 'live',
      sessionId: 's1',
      projectId: 'p1',
    });
    expect(mockedApiPost).toHaveBeenCalledWith('/api/ai/command-gen', {
      text: 'list files',
      deviceId: 'd1',
      cwd: '/r',
      mode: 'live',
      sessionId: 's1',
      projectId: 'p1',
    });
  });
});

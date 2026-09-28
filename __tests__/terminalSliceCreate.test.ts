import { useControlCenterStore } from '../src/store/controlCenterStore';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    createTerminalSession: jest.fn(),
    attachTerminalSession: jest.fn(),
    closeTerminalSession: jest.fn(),
    send: jest.fn(),
  },
}));

import { platformTransport } from '../src/services/platformTransport';

const serverSession = (over: Record<string, unknown> = {}) => ({
  session_id: 'term_srv_1',
  device_id: 'd1',
  status: 'creating',
  cwd: '/tmp/a',
  shell: 'zsh',
  cols: 80,
  rows: 24,
  created_at: '2026-09-28T00:00:00.000Z',
  last_active_at: '2026-09-28T00:00:00.000Z',
  ...over,
});

const seededDevice = {
  id: 'd1',
  name: 'dev',
  os: 'linux',
  authorizedDirectories: ['/tmp/a', '/tmp/b'],
};

let callSeq = 0;
function primeTransport() {
  (platformTransport.createTerminalSession as jest.Mock).mockImplementation(
    async (input: { device_id: string; cwd?: string }) => {
      callSeq += 1;
      return serverSession({
        session_id: `term_srv_${callSeq}`,
        device_id: input.device_id,
        cwd: input.cwd,
      });
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  callSeq = 0;
  useControlCenterStore.setState({
    serverMode: true,
    devices: [seededDevice as any],
    terminalSessions: [],
    events: [],
  });
  primeTransport();
});

// RCA 2026-09-28:创建链路四层无守卫( effect 重跑 / 超时重发 / 无幂等键 /
// 服务端按请求铸新 ID)曾产出毫秒级成对孤儿会话。单飞 + client_request_id
// 在手机侧封掉前两层。
describe('terminalSlice.createTerminalSession single-flight', () => {
  it('coalesces concurrent creates for the same device+directory into one POST', async () => {
    const [a, b] = await Promise.all([
      useControlCenterStore.getState().createTerminalSession('d1', '/tmp/a'),
      useControlCenterStore.getState().createTerminalSession('d1', '/tmp/a'),
    ]);

    expect(a).toBe(b);
    expect(platformTransport.createTerminalSession).toHaveBeenCalledTimes(1);
    // 幂等键随请求下发(服务端按 key 回放)。
    expect(
      (platformTransport.createTerminalSession as jest.Mock).mock.calls[0][0],
    ).toMatchObject({
      device_id: 'd1',
      cwd: '/tmp/a',
      client_request_id: expect.any(String),
    });
  });

  it('does not coalesce different directories', async () => {
    await Promise.all([
      useControlCenterStore.getState().createTerminalSession('d1', '/tmp/a'),
      useControlCenterStore.getState().createTerminalSession('d1', '/tmp/b'),
    ]);

    expect(platformTransport.createTerminalSession).toHaveBeenCalledTimes(2);
  });

  it('allows a fresh create after the in-flight one settles', async () => {
    await useControlCenterStore.getState().createTerminalSession('d1', '/tmp/a');
    await useControlCenterStore.getState().createTerminalSession('d1', '/tmp/a');

    expect(platformTransport.createTerminalSession).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry on failure so the retry is a real POST', async () => {
    (platformTransport.createTerminalSession as jest.Mock)
      .mockImplementationOnce(async () => {
        throw new Error('network down');
      })
      .mockImplementationOnce(async () =>
        serverSession({ session_id: 'term_retry_ok', cwd: '/tmp/a' }),
      );

    await expect(
      useControlCenterStore.getState().createTerminalSession('d1', '/tmp/a'),
    ).rejects.toThrow('network down');
    const id = await useControlCenterStore
      .getState()
      .createTerminalSession('d1', '/tmp/a');

    expect(id).toBe('term_retry_ok');
    expect(platformTransport.createTerminalSession).toHaveBeenCalledTimes(2);
  });
});

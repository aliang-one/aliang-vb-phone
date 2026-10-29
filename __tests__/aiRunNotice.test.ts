/**
 * ai.run.notice 展示链（跨端统一 P4-4）。
 *
 * agent 在续聊降级时发信息性帧（resume_missing / history_restore_failed），
 * 服务端随用户级广播原样达手机。此前 toEvent 白名单没有它 → 落 {type:'raw'}
 * 被 store 丢弃。本文件钉死三段链路：WS 帧归一、未知 code 前向兼容丢弃、
 * store 落为该会话时间线的一条 system 灰条（含幂等去重）。
 */
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

import { platformTransport } from '../src/services/platformTransport';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { mapAiRunNotice, aiRunNoticeText } from '../src/utils/aiRunNotice';
import type { VibeCodingRun } from '../src/data/platformModels';

const makeRun = (id: string): VibeCodingRun =>
  ({
    id,
    title: `run-${id}`,
    status: 'running',
    transcript: [],
    createdAt: '2026-10-29T00:00:00Z',
    updatedAt: '2026-10-29T00:00:00Z',
  } as unknown as VibeCodingRun);

const dispatch = (event: Parameters<
  ReturnType<typeof useControlCenterStore.getState>['handleTransportEvent']
>[0]) => useControlCenterStore.getState().handleTransportEvent(event);

beforeEach(() => {
  useControlCenterStore.setState({ vibeRuns: [makeRun('ai-n1')] });
});

afterEach(() => {
  useControlCenterStore.setState({ vibeRuns: [] });
});

describe('ai.run.notice copy mapping', () => {
  it('maps known codes and passes the detail through', () => {
    expect(mapAiRunNotice('resume_missing', 'native session x not found')).toEqual({
      code: 'resume_missing',
      textKey: 'session.notice.resumeMissing',
      detail: 'native session x not found',
    });
    expect(mapAiRunNotice('history_restore_failed')).toEqual({
      code: 'history_restore_failed',
      textKey: 'session.notice.historyRestoreFailed',
      detail: undefined,
    });
  });

  it('drops unknown codes (forward compatibility)', () => {
    expect(mapAiRunNotice('some_future_code', 'detail')).toBeNull();
    expect(mapAiRunNotice('')).toBeNull();
  });

  it('appends the detail as a trailing note', () => {
    expect(aiRunNoticeText('正文', 'boom at /x/y')).toBe('正文 · boom at /x/y');
    expect(aiRunNoticeText('正文')).toBe('正文');
    expect(aiRunNoticeText('正文', '   ')).toBe('正文');
  });
});

describe('platformTransport ai.run.notice normalization', () => {
  afterEach(() => {
    platformTransport.disconnect();
  });

  it('normalizes the WS frame into a typed transport event', () => {
    const events: unknown[] = [];
    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.({
      type: 'ai.run.notice',
      session_id: 'ai-n1',
      message_id: 'msg_asst_9',
      code: 'resume_missing',
      detail: 'native session abc not found; continuing as a fresh conversation',
    });

    expect(events).toEqual([
      {
        type: 'ai.run.notice',
        sessionId: 'ai-n1',
        code: 'resume_missing',
        detail: 'native session abc not found; continuing as a fresh conversation',
        raw: expect.objectContaining({ type: 'ai.run.notice' }),
      },
    ]);
  });
});

describe('store ingestion of ai.run.notice', () => {
  it('appends a localized system note to the session transcript', () => {
    dispatch({
      type: 'ai.run.notice',
      sessionId: 'ai-n1',
      code: 'resume_missing',
      detail: 'native session abc not found',
      raw: { message_id: 'msg_asst_1' },
    });

    const run = useControlCenterStore
      .getState()
      .vibeRuns.find(item => item.id === 'ai-n1');
    expect(run?.transcript).toHaveLength(1);
    const note = run?.transcript[0];
    expect(note?.role).toBe('system');
    expect(note?.content).toBe(
      '原生会话不存在，已按新会话继续 · native session abc not found',
    );
  });

  it('replays of the same frame (same message_id) do not duplicate the note', () => {
    const frame = {
      type: 'ai.run.notice' as const,
      sessionId: 'ai-n1',
      code: 'history_restore_failed',
      detail: 'journal read failed',
      raw: { message_id: 'msg_asst_2' },
    };
    dispatch(frame);
    dispatch(frame);

    const run = useControlCenterStore
      .getState()
      .vibeRuns.find(item => item.id === 'ai-n1');
    expect(run?.transcript).toHaveLength(1);
  });

  it('drops unknown codes without touching the transcript', () => {
    dispatch({
      type: 'ai.run.notice',
      sessionId: 'ai-n1',
      code: 'brand_new_code',
      detail: 'detail',
      raw: {},
    });

    const run = useControlCenterStore
      .getState()
      .vibeRuns.find(item => item.id === 'ai-n1');
    expect(run?.transcript).toHaveLength(0);
  });

  it('ignores notices for sessions that are not loaded locally', () => {
    dispatch({
      type: 'ai.run.notice',
      sessionId: 'ai-unknown',
      code: 'resume_missing',
      detail: undefined,
      raw: {},
    });

    expect(useControlCenterStore.getState().vibeRuns).toHaveLength(1);
    expect(
      useControlCenterStore.getState().vibeRuns[0].transcript,
    ).toHaveLength(0);
  });
});

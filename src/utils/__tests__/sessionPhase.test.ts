import {
  LIVE_TURN_WINDOW_MS,
  deriveSessionPhase,
  liveAssistantMessageId,
  sessionPhaseLabel,
} from '../sessionPhase';

describe('deriveSessionPhase (L1 整体相位)', () => {
  it('failed 终态(非 live 时)', () => {
    expect(deriveSessionPhase('failed', true)).toBe('failed');
  });

  it('isLive 压过误报终态:status=completed 但正在思考 → 仍进行中', () => {
    // 这就是用户报告的 bug:服务端把 status 推成 closed→completed,但 agent 明明在思考。
    // 生命迹象(isLive)是真相,必须压过 status 的「上一轮完成」。
    expect(deriveSessionPhase('completed', false, true)).toBe('running');
  });

  it('failed 终态优先,不被短时间 live window 误导成进行中', () => {
    expect(deriveSessionPhase('failed', false, true)).toBe('failed');
  });

  it('isLive=true 时 idle / paused / waiting_user 都 → 进行中', () => {
    expect(deriveSessionPhase('idle', false, true)).toBe('running');
    expect(deriveSessionPhase('paused', false, true)).toBe('running');
  });

  it('isLive=false 时 status=completed → 上一轮已完成', () => {
    expect(deriveSessionPhase('completed', false, false)).toBe('completed');
  });

  it('completed 表示上一轮已完成,即使有 pending approval 也优先展示完成态', () => {
    // completed 只是上一轮完成,会话线程仍可继续;陈旧审批不应该把顶部顶成待审批。
    expect(deriveSessionPhase('completed', true)).toBe('completed');
  });

  it('有 pending approval → 待审批', () => {
    expect(deriveSessionPhase('running', true)).toBe('waiting_approval');
    expect(deriveSessionPhase('idle', true)).toBe('waiting_approval');
    expect(deriveSessionPhase('paused', true)).toBe('waiting_approval');
  });

  it('回合答完(无活动、无待审批、非真结束)→ 已完成,不卡进行中', () => {
    // 旧版把 idle/running 都映射成进行中,导致回合答完后顶部永远进行中。现在靠 isLive
    // 判活:无生命迹象 = 回合 settle = 已完成(status 卡 running 也能收敛)。
    expect(deriveSessionPhase('idle', false)).toBe('completed');
    expect(deriveSessionPhase('running', false)).toBe('completed');
    expect(deriveSessionPhase('paused', false)).toBe('completed');
    expect(deriveSessionPhase('waiting_user', false)).toBe('completed');
    expect(deriveSessionPhase('testing', false)).toBe('completed');
    expect(deriveSessionPhase('preview_ready', false)).toBe('completed');
  });

  it('4 个相位都有中文 label', () => {
    expect(sessionPhaseLabel.running).toBe('进行中');
    expect(sessionPhaseLabel.waiting_approval).toBe('待审批');
    expect(sessionPhaseLabel.completed).toBe('已完成');
    expect(sessionPhaseLabel.failed).toBe('失败');
  });
});

describe('liveAssistantMessageId (live 回合信号)', () => {
  const transcript = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' },
    { id: 'a2', role: 'assistant' },
  ];

  it('窗口内 → 返回最后一条 assistant 消息 id', () => {
    expect(liveAssistantMessageId(transcript, 1000, 1000)).toBe('a2');
    expect(liveAssistantMessageId(transcript, 1000, 1000 + LIVE_TURN_WINDOW_MS)).toBe('a2');
  });

  it('窗口外 → undefined(回合已 settle)', () => {
    expect(liveAssistantMessageId(transcript, 1000, 1000 + LIVE_TURN_WINDOW_MS + 1)).toBeUndefined();
  });

  it('lastActivityMs 缺失 → undefined', () => {
    expect(liveAssistantMessageId(transcript, undefined, 1000)).toBeUndefined();
  });

  it('忽略结尾的非 assistant 消息,取最近的 assistant', () => {
    const t = [
      { id: 'a1', role: 'assistant' },
      { id: 'u3', role: 'user' }, // 球已在用户侧,但仍在窗口内
    ];
    expect(liveAssistantMessageId(t, 1000, 1000)).toBe('a1');
  });

  it('没有任何 assistant 消息 → undefined', () => {
    expect(liveAssistantMessageId([{ id: 'u1', role: 'user' }], 1000, 1000)).toBeUndefined();
  });

  it('空 transcript → undefined', () => {
    expect(liveAssistantMessageId([], 1000, 1000)).toBeUndefined();
  });
});

import {
  LIVE_TURN_WINDOW_MS,
  deriveSessionPhase,
  isSessionTurnActive,
  lastUnrepliedUserMessageId,
  liveAssistantMessageId,
  sessionPhaseLabel,
  shouldLockComposerForProvider,
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

describe('lastUnrepliedUserMessageId (失败回合定位)', () => {
  // 用于 case B:消息已送达、agent 报错没回出来。失败回合 = 会话停在一条没有
  // 后续 assistant 回复的 user 消息上(最后一条是 user)。给它挂「重试」入口。
  it('最后一条是 user → 返回该 id', () => {
    expect(
      lastUnrepliedUserMessageId([{ id: 'u1', role: 'user' }]),
    ).toBe('u1');
  });

  it('最后一条是 assistant(已回复)→ undefined', () => {
    expect(
      lastUnrepliedUserMessageId([
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'assistant' },
      ]),
    ).toBeUndefined();
  });

  it('多轮:最后一轮 user 还没回 → 返回最后那条 user id', () => {
    expect(
      lastUnrepliedUserMessageId([
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'assistant' },
        { id: 'u2', role: 'user' },
      ]),
    ).toBe('u2');
  });

  it('最后一条是 system(如错误事件行)→ undefined', () => {
    expect(
      lastUnrepliedUserMessageId([
        { id: 'u1', role: 'user' },
        { id: 's1', role: 'system' },
      ]),
    ).toBeUndefined();
  });

  it('空 → undefined', () => {
    expect(lastUnrepliedUserMessageId([])).toBeUndefined();
  });
});

describe('shouldLockComposerForProvider (composer 锁与相位同源)', () => {
  // 用户报告的脱节 bug:回合答完后顶部已显「已完成」,但底部 composer 仍锁
  // 「Claude Code 正在运行」。根因=旧实现裸读陈旧的 session.status='running',
  // 而顶部用 isLive 压过陈旧 status。锁判定必须与相位同源(用 isSessionLive)。
  it('claude_code 真在干活(isSessionLive)→ 锁', () => {
    expect(shouldLockComposerForProvider(true, 'running', 'claude_code')).toBe(true);
  });

  it('claude_code 待审批(waiting_approval,非 live)→ 锁(沿用旧行为)', () => {
    expect(shouldLockComposerForProvider(false, 'waiting_approval', 'claude_code')).toBe(true);
  });

  it('claude_code 回合已 settle(isSessionLive=false,status 陈旧 running)→ 不锁(修 bug)', () => {
    // 这就是 bug 现场:status 停在陈旧的 running,但回合其实答完了。
    expect(shouldLockComposerForProvider(false, 'running', 'claude_code')).toBe(false);
  });

  it('claude_code failed / completed / idle(非 live、非待审批)→ 不锁', () => {
    expect(shouldLockComposerForProvider(false, 'failed', 'claude_code')).toBe(false);
    expect(shouldLockComposerForProvider(false, 'completed', 'claude_code')).toBe(false);
    expect(shouldLockComposerForProvider(false, 'idle', 'claude_code')).toBe(false);
  });

  it('非 claude_code provider(codex 支持排队)→ 永不锁,即便 live', () => {
    expect(shouldLockComposerForProvider(true, 'running', 'codex')).toBe(false);
    expect(shouldLockComposerForProvider(true, 'running', undefined)).toBe(false);
  });
});

describe('isSessionTurnActive (事件驱动:status===running)', () => {
  // 演进:曾用「8s 活动新鲜度」当「是否在跑」的判据(给当年用活动猜结束的抖动打补丁)。
  // 现在回合边界由确定性事件驱动——发送/ai.status→running、ai.done→idle、ai.error→failed、
  // 中断→idle——配合 mergeVibeRunSnapshot 双向 stale 守卫,status 在回合内稳定 running、
  // 结束即时 idle。故「是否在跑」= status==='running',不再需要时间窗口(不抖、不滞后)。
  // waiting_approval 不算在跑(各消费方按需 || waiting_approval)。
  it('status=running → 在跑', () => {
    expect(isSessionTurnActive('running')).toBe(true);
  });

  it('idle / completed / failed → 没在跑(回合已结算)', () => {
    expect(isSessionTurnActive('idle')).toBe(false);
    expect(isSessionTurnActive('completed')).toBe(false);
    expect(isSessionTurnActive('failed')).toBe(false);
  });

  it('waiting_approval / paused / 其它 → 不算在跑(审批/暂停由消费方单独处理)', () => {
    expect(isSessionTurnActive('waiting_approval')).toBe(false);
    expect(isSessionTurnActive('paused')).toBe(false);
    expect(isSessionTurnActive('waiting_user')).toBe(false);
  });
});

/**
 * 后台任务面板契约测试。
 *
 * 面板聚合会话全部 subagent 结构化事件：活跃（queued/started/progress）排前、
 * 终态殿后；标题行显示「N 个进行中 · 共 M 个」；空事件列表显示空态文案。
 * 行渲染口径与 ActivityBlock.SubagentRows 一致（终态才显示耗时、✓/✗/⊘ 标记）。
 *
 * DiagnosticsPanel.empty-state 同款手法：reanimated/safe-area 已全局 mock，
 * i18n 锁 zh，直接断言中文文案。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { BackgroundTasksPanel } from '../BackgroundTasksPanel';
import type { StructuredActivityEvent } from '../../../data/platformModels';

type SubagentEvent = Extract<
  StructuredActivityEvent,
  { kind: 'subagent' }
>;

function makeEvent(overrides: Partial<SubagentEvent> = {}): SubagentEvent {
  return {
    kind: 'subagent',
    eventId: 'sub:task-1',
    serverEventId: 'se-1',
    messageId: 'msg-1',
    itemId: 'task-1',
    taskId: 'task-1',
    phase: 'progress',
    description: '调研任务',
    ...overrides,
  } as SubagentEvent;
}

function renderPanel(events: SubagentEvent[]): string {
  let root: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(
      <BackgroundTasksPanel
        open
        onClose={() => {}}
        sessionId="sess-1"
        events={events}
      />,
    );
  });
  const texts: string[] = [];
  root!.root.findAllByType('Text' as never).forEach(node => {
    const { children } = node.props as { children?: unknown };
    // 行标题是数组 children（mark + 名称 + 相位拼接），逐段收集字符串。
    if (typeof children === 'string') texts.push(children);
    else if (Array.isArray(children)) {
      children.forEach(child => {
        if (typeof child === 'string') texts.push(child);
      });
    }
  });
  return texts.join('\n');
}

describe('BackgroundTasksPanel', () => {
  it('空事件列表 → 显示空态文案', () => {
    const output = renderPanel([]);
    expect(output).toContain('后台任务');
    expect(output).toContain('本会话还没有后台任务');
  });

  it('混合相位 → 标题显示活跃计数与总数', () => {
    const output = renderPanel([
      makeEvent({ taskId: 'a', eventId: 'sub:a', phase: 'completed', durationMs: 12_000 }),
      makeEvent({ taskId: 'b', eventId: 'sub:b', phase: 'progress' }),
      makeEvent({ taskId: 'c', eventId: 'sub:c', phase: 'queued' }),
    ]);
    expect(output).toContain('2 个进行中 · 共 3 个');
  });

  it('活跃事件排在终态之前（渲染顺序：progress → queued → completed）', () => {
    const output = renderPanel([
      makeEvent({ taskId: 'done', eventId: 'sub:done', phase: 'completed', description: '调研任务' }),
      makeEvent({ taskId: 'live', eventId: 'sub:live', phase: 'progress', description: '正在跑' }),
      makeEvent({ taskId: 'wait', eventId: 'sub:wait', phase: 'queued', description: '排队中' }),
    ]);
    const liveIdx = output.indexOf('正在跑');
    const waitIdx = output.indexOf('排队中');
    const doneIdx = output.indexOf('调研任务');
    expect(liveIdx).toBeGreaterThanOrEqual(0);
    expect(waitIdx).toBeGreaterThan(liveIdx);
    expect(doneIdx).toBeGreaterThan(waitIdx);
  });

  it('终态行带完成标记与耗时；排队行显示排队相位文案', () => {
    const output = renderPanel([
      makeEvent({ taskId: 'done', eventId: 'sub:done', phase: 'completed', durationMs: 65_000 }),
      makeEvent({ taskId: 'wait', eventId: 'sub:wait', phase: 'queued' }),
    ]);
    expect(output).toContain('✓');
    expect(output).toContain('65 秒');
    expect(output).toContain('排队中');
  });
});

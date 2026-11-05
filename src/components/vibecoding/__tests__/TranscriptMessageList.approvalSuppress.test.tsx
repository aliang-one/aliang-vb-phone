/**
 * approval 静态卡防双渲染钉。
 *
 * 服务端把助手消息里的 aliang-options 围栏派生成时间线里的**交互审批卡**
 * （stableDerivedApprovalId，plan.key = JSON.stringify({title, options:[id]})）。
 * 聊天气泡里的静态卡（callout approval 降级渲染）若再画一遍同一份方案，
 * 就是用户看到的「文本圆点 + options 卡」双份展示。
 *
 * 契约：会话屏把权威审批集合算成 plan-key 集合传进
 * `suppressedApprovalPlanKeys`，静态卡命中即整体不渲染（正文一并隐藏——
 * 卡片承载了全部信息，正文残句只会变成突兀的孤儿文本）；未命中（服务端
 * 未派生/坏 JSON/v1 块）保持降级渲染，宁重复不丢内容。派生卡被答复后
 * 进折叠组，信息不丢，所以隐藏是永久的、不会闪回。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { TranscriptMessageList } from '../TranscriptMessageList';
import { derivedApprovalPlanKey } from '../../../utils/messageRendering';
import type { DisplayTranscriptMessage } from '../../../utils/agentTranscript';
import type { TranscriptOptionCard } from '../../../utils/messageRendering';

const optionCard: TranscriptOptionCard = {
  version: 2,
  title: 'Choose next step',
  summary: 'The assistant is waiting for a plan choice.',
  options: [
    { id: 'ship-it', label: 'Ship it' },
    { id: 'rework', label: 'Rework the plan' },
  ],
  multi: false,
  allowCustom: true,
};

const message: DisplayTranscriptMessage = {
  id: 'm1',
  role: 'assistant',
  timestamp: '2026-10-30T10:00:00Z',
  mergedCount: 1,
  segments: [
    {
      kind: 'text',
      id: 't1',
      content: 'Here is the plan.',
      blocks: [
        { kind: 'paragraph', children: [{ kind: 'text', content: 'Here is the plan.' }] },
      ],
    },
    {
      kind: 'callout',
      id: 'm1:callout:1:approval-request',
      variant: 'approval',
      title: 'Approval',
      tone: 'warning',
      content: 'Choose next step — Ship it / Rework the plan',
      optionCard,
      blocks: [],
    },
  ],
  contentKey: 'k',
  sourceMessageIds: ['m1'],
};

const allTexts = (renderer: TestRenderer.ReactTestRenderer): string[] => {
  const texts: string[] = [];
  renderer.root
    .findAllByType('Text' as never)
    .forEach((node: { props: { children?: unknown } }) => {
      const { children } = node.props;
      if (typeof children === 'string') texts.push(children);
    });
  return texts;
};

const render = (suppressed?: ReadonlySet<string>) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <TranscriptMessageList
        message={message}
        suppressedApprovalPlanKeys={suppressed}
      />,
    );
  });
  return renderer;
};

describe('approval 静态卡防双渲染', () => {
  it('静态卡 key 命中 suppressed 集合时整段不渲染', () => {
    const renderer = render(new Set([derivedApprovalPlanKey(optionCard)]));
    const texts = allTexts(renderer);
    expect(texts).not.toContain('Choose next step');
    expect(texts.join('\n')).not.toContain('Ship it');
  });

  it('只隐藏卡本身;卡前独立正文段落(模型的正常话)不受影响', () => {
    const renderer = render(new Set([derivedApprovalPlanKey(optionCard)]));
    const texts = allTexts(renderer);
    expect(texts).toContain('Here is the plan.');
    expect(texts).not.toContain('Ship it');
  });

  it('key 未命中(服务端未派生/坏 JSON/v1 块)保持降级渲染', () => {
    const renderer = render(new Set(['{"title":"other"}']));
    expect(allTexts(renderer)).toContain('Choose next step');
  });

  it('不传 prop(未接线调用方)行为不变', () => {
    const renderer = render();
    expect(allTexts(renderer)).toContain('Choose next step');
  });
});

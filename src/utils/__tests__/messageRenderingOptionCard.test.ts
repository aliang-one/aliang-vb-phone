import {
  parseMessageContentSegments,
  type TranscriptCalloutSegment,
} from '../messageRendering';

/**
 * v2 结构化选项卡(optionCard 机读旁路)专项:
 *  - <card-json> 子标签 → segment.optionCard,正文不再含 JSON;
 *  - 颜文字/emoji label 逐字符保真(不过 inline markdown 管线);
 *  - previews 钳制 8×200;options 截 8;
 *  - 坏 JSON/半截流式 → optionCard 缺省走 v1 markdown 降级,JSON 不外晒。
 */

const approvalSegment = (content: string): TranscriptCalloutSegment => {
  const segments = parseMessageContentSegments('m1', content);
  const segment = segments.find(
    (segment): segment is TranscriptCalloutSegment =>
      segment.kind === 'callout' && segment.variant === 'approval',
  );
  if (!segment) throw new Error('expected approval callout segment');
  return segment;
};

const fence = (json: Record<string, unknown>) =>
  '```aliang-options\n' + JSON.stringify(json) + '\n```';

describe('messageRendering — aliang-options v2 optionCard 直通', () => {
  it('v2 围栏:optionCard 结构化拆出,颜文字 label 逐字符保真,<card-json> 不进正文', () => {
    const label = '蓝绿部署 (｡•̀ᴗ-)✧';
    const segment = approvalSegment(
      fence({
        v: 2,
        title: '选择发布策略',
        header: '部署',
        summary: '两种路径',
        multi: false,
        allow_custom: true,
        options: [
          {
            id: 'blue-green',
            label,
            description: '回滚最快',
            previews: ['kubectl apply -f a.yaml', 'kubectl rollout status'],
          },
          { id: 'in-place', label: '原地滚动升级 😊' },
        ],
      }),
    );
    expect(segment.optionCard).toBeDefined();
    const card = segment.optionCard!;
    expect(card.version).toBe(2);
    expect(card.header).toBe('部署');
    expect(card.title).toBe('选择发布策略');
    expect(card.summary).toBe('两种路径');
    expect(card.allowCustom).toBe(true);
    expect(card.multi).toBe(false);
    expect(card.options[0]?.label).toBe(label); // 颜文字逐字符
    expect(card.options[0]?.previews).toEqual([
      'kubectl apply -f a.yaml',
      'kubectl rollout status',
    ]);
    expect(card.options[1]?.label).toBe('原地滚动升级 😊');
    // 结构化字段不进人读正文;markdown 圆点降级仍在(blocks 供 v1/复制)
    expect(segment.content).not.toContain('card-json');
    expect(segment.content).not.toContain('"blue-green"');
    expect(segment.content).toContain(label);
  });

  it('multi 标志经 attr 与 card 双通道一致', () => {
    const segment = approvalSegment(
      fence({ title: '勾模块', multi: true, options: [{ id: 'a', label: 'A' }] }),
    );
    expect(segment.multi).toBe(true);
    expect(segment.optionCard?.multi).toBe(true);
  });

  it('previews 钳制 8×200,非字符串丢弃;options 截 8', () => {
    const segment = approvalSegment(
      fence({
        title: 't',
        options: Array.from({ length: 12 }, (_, i) => ({
          id: `o${i}`,
          label: `L${i}`,
          previews: ['x'.repeat(300), 42, 'ok'],
        })),
      }),
    );
    const card = segment.optionCard!;
    expect(card.options).toHaveLength(8);
    expect(card.options[0]?.previews).toEqual(['x'.repeat(200), 'ok']);
  });

  it('丢围栏裸 JSON 兜底同样产出 optionCard', () => {
    const segment = approvalSegment(
      '{"title":"裸方案","multi":true,"options":[{"id":"a","label":"(ฅ\'ω\'ฅ) 保守"}]}',
    );
    expect(segment.optionCard?.title).toBe('裸方案');
    expect(segment.optionCard?.multi).toBe(true);
    expect(segment.optionCard?.options[0]?.label).toBe("(ฅ'ω'ฅ) 保守");
  });

  it('坏 card JSON:optionCard 缺省走 v1 降级,JSON 行不外晒', () => {
    // 直接构造坏 card-json(绕过 formatAliangOptionsFence 的产出端)
    const segment = approvalSegment(
      '\n<approval-request><card-json>{"title":"broken"</card-json>需要你的批准</approval-request>\n',
    );
    expect(segment.optionCard).toBeUndefined();
    expect(segment.content).not.toContain('card-json');
    expect(segment.content).toContain('需要你的批准');
  });
});

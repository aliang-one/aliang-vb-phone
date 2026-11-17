import {
  derivedApprovalPlanKey,
  parseMessageContentSegments,
  sessionApprovalSuppressPlanKeys,
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

describe('sessionApprovalSuppressPlanKeys(静态卡抑制集合,7647fda 契约收尾)', () => {
  // 2026-11-16 TUI 会话实锤:7647fda 只落了子组件与测试,会话屏从未传
  // suppressedApprovalPlanKeys → 每条 aliang-options 围栏消息渲染一张无交互
  // 死卡,用户「只能看到样式不能选择」。集合计算提为纯函数钉死契约。
  const storeApproval = {
    title: '两边名字必须一字不差：liang liang ≠ aliang',
    options: [
      { id: 'miit-to-liangliang' },
      { id: 'apple-to-aliang' },
      { id: 'tell-me-where' },
    ],
  };

  it('store 权威审批的 key 与消息围栏解析出的静态卡 key 逐字节一致', () => {
    const segment = approvalSegment(
      fence({
        title: storeApproval.title,
        options: [
          { id: 'miit-to-liangliang', label: '备案改回' },
          { id: 'apple-to-aliang', label: 'Apple 改名' },
          { id: 'tell-me-where', label: '说不清' },
        ],
      }),
    );
    const keys = sessionApprovalSuppressPlanKeys([storeApproval]);
    expect(keys.has(derivedApprovalPlanKey(segment.optionCard!))).toBe(true);
  });

  it('无 options 的审批产出独立 key,不误伤真实围栏卡', () => {
    const segment = approvalSegment(
      fence({ title: 't', options: [{ id: 'a', label: 'A' }] }),
    );
    const keys = sessionApprovalSuppressPlanKeys([
      { title: 't' },
      { title: 't', options: [] },
    ]);
    expect(keys.has(derivedApprovalPlanKey(segment.optionCard!))).toBe(false);
  });

  it('空集合→空集合', () => {
    expect(sessionApprovalSuppressPlanKeys([]).size).toBe(0);
  });
});

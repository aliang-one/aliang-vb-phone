import type {
  TranscriptMarkdownBlock,
  TranscriptMarkdownInline,
} from '../messageRendering';
import {
  parseMarkdownBlocks,
  parseMessageContentSegments,
} from '../messageRendering';

/**
 * 构造纯文本输入(parseMarkdownBlocks 的 MarkdownSourcePart[] 入口)。
 * 仅 text part 即可覆盖所有 block/inline 解析路径。
 */
const text = (content: string) => [{ kind: 'text' as const, content }];

const blockAt = (blocks: TranscriptMarkdownBlock[], index = 0) => {
  const b = blocks[index];
  if (!b) throw new Error(`expected block at index ${index}, got undefined`);
  return b;
};

const asParagraph = (b: TranscriptMarkdownBlock) => {
  if (b.kind !== 'paragraph') throw new Error(`expected paragraph, got ${b.kind}`);
  return b;
};

/** 取段落第一个 inline 节点(便于断言 strikethrough/image/strong 等)。 */
const firstInline = (b: TranscriptMarkdownBlock): TranscriptMarkdownInline => {
  const node = asParagraph(b).children[0];
  if (!node) throw new Error('paragraph has no inline children');
  return node;
};

describe('parseMarkdownBlocks — GFM 表格', () => {
  it('基础两列表格:表头 + 数据行,cell 走 inline 解析', () => {
    const blocks = parseMarkdownBlocks(text('| h1 | h2 |\n|---|---|\n| 1 | 2 |'));
    expect(blocks).toHaveLength(1);
    const b = blockAt(blocks);
    expect(b.kind).toBe('table');
    if (b.kind !== 'table') return;
    expect(b.headers).toEqual([
      [{ kind: 'text', content: 'h1' }],
      [{ kind: 'text', content: 'h2' }],
    ]);
    expect(b.rows).toHaveLength(1);
    expect(b.align).toEqual([null, null]);
  });

  it('对齐标记 :--- / :---: / ---: 解析为 left/center/right', () => {
    const blocks = parseMarkdownBlocks(text('| L | C | R |\n|:---|:---:|---:|'));
    const b = blockAt(blocks);
    expect(b.kind).toBe('table');
    if (b.kind !== 'table') return;
    expect(b.align).toEqual(['left', 'center', 'right']);
  });

  it('无外管道(缺首尾 |)也能识别为表格', () => {
    expect(blockAt(parseMarkdownBlocks(text('h1 | h2\n--- | ---\n1 | 2'))).kind).toBe(
      'table',
    );
  });

  it('缺分隔行 → 不当作表格,回退为段落', () => {
    expect(blockAt(parseMarkdownBlocks(text('| a | b |\n| 1 | 2 |'))).kind).toBe(
      'paragraph',
    );
  });

  it('数据行列数少于表头补空、多于表头截断', () => {
    const fewer = parseMarkdownBlocks(
      text('| h1 | h2 | h3 |\n|---|---|---|\n| a | b |'),
    );
    const fb = blockAt(fewer);
    if (fb.kind !== 'table') throw new Error('expected table');
    expect(fb.rows[0]).toHaveLength(3); // 第三格补空

    const more = parseMarkdownBlocks(
      text('| h1 | h2 |\n|---|---|\n| a | b | c |'),
    );
    const mb = blockAt(more);
    if (mb.kind !== 'table') throw new Error('expected table');
    expect(mb.rows[0]).toHaveLength(2); // 截断到表头列数
  });
});

describe('parseMarkdownBlocks — 水平分隔线', () => {
  it('--- / *** / ___ 均识别为 thematicBreak', () => {
    for (const marker of ['---', '***', '___']) {
      expect(blockAt(parseMarkdownBlocks(text(marker))).kind).toBe('thematicBreak');
    }
  });

  it('带空格的 * * * 也是分隔线', () => {
    expect(blockAt(parseMarkdownBlocks(text('* * *'))).kind).toBe('thematicBreak');
  });

  it('分隔线紧跟文本行不误判:段落 + 分隔线', () => {
    const blocks = parseMarkdownBlocks(text('hello\n---'));
    expect(blocks).toHaveLength(2);
    expect(blockAt(blocks, 0).kind).toBe('paragraph');
    expect(blockAt(blocks, 1).kind).toBe('thematicBreak');
  });
});

describe('parseMarkdownBlocks — 嵌套列表', () => {
  it('两级无序:depth [0,1,0]', () => {
    const b = blockAt(parseMarkdownBlocks(text('- a\n  - b\n- c')));
    if (b.kind !== 'list') throw new Error('expected list');
    expect(b.items.map(i => i.depth)).toEqual([0, 1, 0]);
  });

  it('有序嵌套:depth [0,1]', () => {
    const b = blockAt(parseMarkdownBlocks(text('1. a\n   1) b')));
    if (b.kind !== 'list') throw new Error('expected list');
    expect(b.items.map(i => i.depth)).toEqual([0, 1]);
  });

  it('4 空格缩进 → depth 2', () => {
    const b = blockAt(parseMarkdownBlocks(text('- a\n    - b')));
    if (b.kind !== 'list') throw new Error('expected list');
    expect(b.items.map(i => i.depth)).toEqual([0, 2]);
  });
});

describe('parseMarkdownBlocks — 任务列表', () => {
  it('[ ] 未完成 / [x] 已完成', () => {
    const b = blockAt(parseMarkdownBlocks(text('- [ ] todo\n- [x] done')));
    if (b.kind !== 'list') throw new Error('expected list');
    expect(b.items.map(i => i.checkbox)).toEqual(['unchecked', 'checked']);
  });

  it('大写 [X] 也识别为已勾选', () => {
    const b = blockAt(parseMarkdownBlocks(text('- [X] done')));
    if (b.kind !== 'list') throw new Error('expected list');
    expect(b.items[0].checkbox).toBe('checked');
  });
});

describe('parseInlineMarkdown — 删除线', () => {
  it('~~text~~ → strikethrough', () => {
    expect(firstInline(blockAt(parseMarkdownBlocks(text('~~text~~')))).kind).toBe(
      'strikethrough',
    );
  });

  it('嵌套在 strong 内:**~~x~~**', () => {
    const node = firstInline(blockAt(parseMarkdownBlocks(text('**~~x~~**'))));
    expect(node.kind).toBe('strong');
    if (node.kind !== 'strong') return;
    expect(node.children[0].kind).toBe('strikethrough');
  });
});

describe('parseInlineMarkdown — 图片', () => {
  it('![alt](url) → image,不误判为 link', () => {
    const node = firstInline(
      blockAt(parseMarkdownBlocks(text('![alt](https://x/y.png)'))),
    );
    expect(node.kind).toBe('image');
    if (node.kind !== 'image') return;
    expect(node.alt).toBe('alt');
    expect(node.url).toBe('https://x/y.png');
  });

  it('alt 含空格完整保留', () => {
    const node = firstInline(
      blockAt(parseMarkdownBlocks(text('![alt with spaces](url)'))),
    );
    if (node.kind !== 'image') throw new Error('expected image');
    expect(node.alt).toBe('alt with spaces');
  });

  it('图片夹在文本中间被正确切分', () => {
    const para = asParagraph(
      blockAt(parseMarkdownBlocks(text('see ![logo](x.png) here'))),
    );
    const kinds = para.children.map(c => c.kind);
    expect(kinds).toEqual(['text', 'image', 'text']);
  });
});

describe('parseMarkdownBlocks — 回归 / 混合', () => {
  it('表格可紧跟标题(谓词顺序不回归)', () => {
    const blocks = parseMarkdownBlocks(
      text('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |'),
    );
    expect(blockAt(blocks, 0).kind).toBe('heading');
    expect(blockAt(blocks, 1).kind).toBe('table');
  });

  it('两段间分隔线 → 段落 / 分隔线 / 段落', () => {
    const blocks = parseMarkdownBlocks(text('para1\n\n---\n\npara2'));
    expect(blocks.map(b => b.kind)).toEqual([
      'paragraph',
      'thematicBreak',
      'paragraph',
    ]);
  });

  it('粗体 + 列表 仍正确解析', () => {
    const blocks = parseMarkdownBlocks(text('**bold**\n\n- item'));
    expect(blockAt(blocks, 0).kind).toBe('paragraph');
    expect(firstInline(blockAt(blocks, 0)).kind).toBe('strong');
    expect(blockAt(blocks, 1).kind).toBe('list');
  });
});

describe('parseMessageContentSegments — aliang-options 丢围栏兜底', () => {
  // 生产实锤三种"模型不守围栏"形态（2026-09/10 线上实例）：
  // A = 裸 ``` 围栏丢语言标签；B = 整条消息就是裸 JSON；C = JSON 混在散文里。
  // 修复前这些原样打印 JSON；修复后应转为 approval-request callout 卡片。
  const plan = {
    title: '线程模型怎么实现',
    description: '选一个落地方向',
    options: [
      { id: 'virtual', label: '虚拟线程（观察层）', description: '改动小' },
      { id: 'entity', label: '实体常驻线程', description: '成本上升' },
    ],
    allow_custom: true,
    multi: false,
  };
  const json = JSON.stringify(plan);
  const calloutTags = (content: string) =>
    parseMessageContentSegments('msg_test', content)
      .filter(s => s.kind === 'callout')
      .map(s => (s.kind === 'callout' ? s.title : ''));

  const calloutsOf = (content: string) =>
    parseMessageContentSegments('msg_test', content).filter(
      s => s.kind === 'callout',
    );

  it('approval 卡片带 variant=approval;显式 multi:false 不产生 multi attr', () => {
    const [card] = calloutsOf('```aliang-options\n' + json + '\n```');
    if (!card || card.kind !== 'callout') throw new Error('no approval card');
    expect(card.variant).toBe('approval');
    // 段级语义:只有 multi:true 会写成 attr 穿透;false/缺省都是 undefined,
    // 渲染层按 multi !== true 判单选。
    expect(card.multi).toBeUndefined();
    expect(card.tone).toBe('warning');
  });

  it('multi:true 方案卡 → multi 标志为 true(单选/多选区分依据)', () => {
    const multiPlan = JSON.stringify({ ...plan, multi: true });
    for (const input of [
      '```aliang-options\n' + multiPlan + '\n```',
      multiPlan,
      '<approval-request multi>请选择</approval-request>',
    ]) {
      const [card] = calloutsOf(input);
      if (!card || card.kind !== 'callout') throw new Error('no approval card');
      expect(card.multi).toBe(true);
    }
  });

  it('multi 缺省 → multi 为 undefined(单选,不与显式 true 混淆)', () => {
    const noMulti = JSON.stringify({
      title: 't',
      options: [{ id: 'a', label: 'A' }],
    });
    const [card] = calloutsOf('```aliang-options\n' + noMulti + '\n```');
    if (!card || card.kind !== 'callout') throw new Error('no approval card');
    expect(card.multi).toBeUndefined();
  });

  it('其他 callout 标签是 generic,不带 multi', () => {
    const [card] = calloutsOf('<command-message>review</command-message>');
    if (!card || card.kind !== 'callout') throw new Error('no callout');
    expect(card.variant).toBe('generic');
    expect(card.multi).toBeUndefined();
  });

  it('形态 B：裸 JSON 无围栏 → approval-request callout', () => {
    expect(calloutTags(json)).toEqual(['Approval request']);
  });

  it('形态 A：裸 ``` 围栏丢语言标签 → approval-request callout', () => {
    expect(calloutTags('```\n' + json + '\n```')).toEqual(['Approval request']);
  });

  it('形态 C：JSON 混在散文中间 → 前后保留正文 + callout 卡片', () => {
    const segments = parseMessageContentSegments(
      'msg_test',
      '结论如下：\n```\n' + json + '\n```\n另外两个顺带发现：① … ② …',
    );
    expect(segments.filter(s => s.kind === 'callout').map(s => s.kind === 'callout' ? s.title : ''))
      .toEqual(['Approval request']);
    // 散文段落仍在（作为文本段），没有被吞掉
    expect(segments.some(s => s.kind === 'text')).toBe(true);
  });

  it('带语言标签的代码围栏里的同形 JSON 不转卡片（代码示例）', () => {
    expect(calloutTags('```ts\nconst e = ' + json + ';\n```')).toEqual([]);
  });

  it('无 option 形状的普通 JSON 不转卡片', () => {
    expect(calloutTags('{"title":"cfg","retries":3}')).toEqual([]);
  });

  it('围栏正确的 aliang-options 行为不回归', () => {
    expect(calloutTags('```aliang-options\n' + json + '\n```')).toEqual([
      'Approval request',
    ]);
  });

  it('流式半截 JSON 不闪卡片', () => {
    expect(calloutTags(json.slice(0, Math.floor(json.length / 2)))).toEqual([]);
  });
});

describe('parseMessageContentSegments — harness 信封渲染', () => {
  const taskNotice = [
    '<task-notification>',
    '<task-id>b876t1utc</task-id>',
    '<tool-use-id>call_0ec7</tool-use-id>',
    '<output-file>/private/tmp/claude-502/tasks/b876t1utc.output</output-file>',
    '<status>completed</status>',
    '<summary>Background command "Release 构建" completed (exit code 0)</summary>',
    '</task-notification>',
  ].join('\n');

  const segmentsOf = (content: string) => parseMessageContentSegments('m', content);
  const calloutsOf = (content: string) =>
    segmentsOf(content).filter(s => s.kind === 'callout') as Array<
      Extract<ReturnType<typeof parseMessageContentSegments>[number], { kind: 'callout' }>
    >;

  it('task-notification → task 卡片:summary 进正文,状态/输出文件进 meta,管线字段不再裸奔', () => {
    const callouts = calloutsOf(taskNotice);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].title).toBe('Background task');
    expect(callouts[0].variant).toBe('task');
    expect(callouts[0].content).toContain('Release 构建');
    expect(callouts[0].content).not.toContain('/private/tmp/claude-502/tasks/b876t1utc.output');
    expect(callouts[0].content).not.toContain('<task-id>');
    expect(callouts[0].content).not.toContain('<tool-use-id>');
    expect(callouts[0].content).not.toContain('<status>');
    expect(callouts[0].meta).toEqual({
      status: 'completed',
      outputFile: '/private/tmp/claude-502/tasks/b876t1utc.output',
    });
  });

  it('task-notification 失败态 meta.status=failed;无 summary 也能出卡', () => {
    const failed = taskNotice
      .replace('<status>completed</status>', '<status>failed</status>')
      .replace(/<summary>[\s\S]*?<\/summary>\n?/, '');
    const callouts = calloutsOf(failed);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].meta?.status).toBe('failed');
    expect(callouts[0].content).toContain('failed');
  });

  it('task-notification 携带 result → meta.result 摘走,不漏正文', () => {
    const withResult = taskNotice.replace(
      '</task-notification>',
      '<result>[harness: subagent output]</result></task-notification>',
    );
    const callouts = calloutsOf(withResult);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].meta?.result).toBe('[harness: subagent output]');
    expect(callouts[0].content).not.toContain('subagent output');
  });

  it('裸字段簇(无包裹 task-notification)合并为单张 task 卡——生产常见形态', () => {
    const bare = [
      '<task-id>a3ca66e044a44168c</task-id>',
      '<tool-use-id>call_9c5928bbbd5d4f30aae5a575</tool-use-id>',
      '<output-file>/private/tmp/claude-502/tasks/a3ca66e044a44168c.output</output-file>',
      '<status>completed</status>',
      '<summary>Agent "Implement Task 5" finished</summary>',
      '<note>A task-notification fires each time this agent stops.</note>',
      '<result>实现完成,e2e 全绿。</result>',
    ].join('\n');
    const callouts = calloutsOf(bare);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].variant).toBe('task');
    expect(callouts[0].title).toBe('Background task');
    expect(callouts[0].content).toContain('Implement Task 5');
    expect(callouts[0].meta).toEqual({
      status: 'completed',
      outputFile: '/private/tmp/claude-502/tasks/a3ca66e044a44168c.output',
      result: '实现完成,e2e 全绿。',
    });
    const raw = segmentsOf(bare).map(s => s.kind === 'text' ? s.content : '').join('');
    expect(raw).not.toContain('<task-id>');
    expect(raw).not.toContain('<note>');
  });

  it('裸字段簇的 result 体内出现 </status> 字样不会截断配对', () => {
    const tricky = [
      '<task-id>t1</task-id>',
      '<status>completed</status>',
      '<summary>done</summary>',
      '<result>片段 <status>伪装</status> 继续输出</result>',
    ].join('\n');
    const callouts = calloutsOf(tricky);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].meta?.result).toContain('继续输出');
  });

  it('散文里的孤立 <status> 字样(无 task-id)不触发合并', () => {
    const segs = segmentsOf('状态如下 <status>ok</status> 请查收');
    expect(segs.some(s => s.kind === 'callout' && s.variant === 'task')).toBe(false);
    expect(segs.some(s => s.kind === 'text' && s.content.includes('请查收'))).toBe(true);
  });

  it('命令簇合并为单张 Slash command 卡片(不再三段零碎)', () => {
    const cluster = '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>high</command-args>';
    const callouts = calloutsOf(cluster);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].title).toBe('Slash command');
    expect(callouts[0].content).toContain('/review high');
  });

  it('无斜杠前缀的 skill 名自动补 /', () => {
    const cluster = '<command-message>workflow-authoring</command-message>\n<command-name>workflow-authoring</command-name>\n<skill-format>true</skill-format>';
    const callouts = calloutsOf(cluster);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].content).toContain('/workflow-authoring');
  });

  it('task-notification 混在散文中只替换信封本身', () => {
    const mixed = `构建结果来了：\n${taskNotice}\n请看下日志。`;
    const segs = segmentsOf(mixed);
    expect(segs.some(s => s.kind === 'callout' && (s as { title: string }).title === 'Background task')).toBe(true);
    expect(segs.some(s => s.kind === 'text')).toBe(true);
  });
});

describe('parseMarkdownBlocks — 容错(2026-10-26 GLM 输出风格生产实证)', () => {
  // 生产占比:agentcore 会话无空格标题 11%、无空格列表 22%、表头接标题
  // 文字 5.6%;claude 侧同族中文模型也有 ~1%。此前全部落 paragraph 原样
  // 显示(标题井号/表格竖线肉眼可见)。

  it('无空格标题 `##标题` → heading,不再落 paragraph 原文', () => {
    const blocks = parseMarkdownBlocks(text('##标题\n正文段落'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe('heading');
    if (blocks[0].kind !== 'heading') return;
    expect(blocks[0].level).toBe(2);
    expect(blocks[0].children).toEqual([{ kind: 'text', content: '标题' }]);
  });

  it('越界 # 串 `#######` 与空标题 `## ` 仍不算标题', () => {
    for (const raw of ['#######七个\n正文', '##   \n正文']) {
      const blocks = parseMarkdownBlocks(text(raw));
      expect(blocks[0].kind).toBe('paragraph');
    }
  });

  it('无空格标题后紧贴表格 → heading + table(表格行不被吞)', () => {
    const blocks = parseMarkdownBlocks(
      text('###小节\n| a | b |\n| --- | --- |\n| 1 | 2 |'),
    );
    expect(blocks.map(b => b.kind)).toEqual(['heading', 'table']);
    if (blocks[1].kind !== 'table') return;
    expect(blocks[1].rows).toHaveLength(1);
  });

  it('散文后紧贴表格 → paragraph + table(表格行不被 paragraph 吞掉)', () => {
    const blocks = parseMarkdownBlocks(
      text('结论如下：\n| a | b |\n| --- | --- |\n| 1 | 2 |'),
    );
    expect(blocks.map(b => b.kind)).toEqual(['paragraph', 'table']);
  });

  it('融合形态 `##标题文字| 项目 | 技术栈 |` 拆成 heading + table', () => {
    const blocks = parseMarkdownBlocks(
      text('##📦 核心项目| 项目 | 技术栈 |\n| --- | --- |\n| x | y |'),
    );
    expect(blocks.map(b => b.kind)).toEqual(['heading', 'table']);
    if (blocks[0].kind !== 'heading' || blocks[1].kind !== 'table') return;
    expect(blocks[0].children).toEqual([{ kind: 'text', content: '📦 核心项目' }]);
    expect(blocks[1].headers).toEqual([
      [{ kind: 'text', content: '项目' }],
      [{ kind: 'text', content: '技术栈' }],
    ]);
  });

  it('无空格短横列表 `-存档` → list item', () => {
    const blocks = parseMarkdownBlocks(text('-存档\n-回滚'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('list');
    if (blocks[0].kind !== 'list') return;
    expect(blocks[0].ordered).toBe(false);
    expect(blocks[0].items).toHaveLength(2);
  });

  it('ASCII 短横行不是列表:diff 删除行/ls 权限串/箭头/负数/--flag(容错不越界)', () => {
    for (const raw of [
      '-const a = 1;\n+const a = 2;\n上下文行',
      '-rw-r--r-- 1 user staff 1024\n正文',
      '-> 表示回退箭头\n正文',
      '-5度 是最低温\n正文',
      '--verbose 打开日志\n正文',
    ]) {
      const blocks = parseMarkdownBlocks(text(raw));
      expect(blocks[0].kind).toBe('paragraph');
    }
  });

  it('ASCII 井号行不是标题:#123 / shebang / #include / #tag', () => {
    for (const raw of [
      '#123 号议题\n正文',
      '#!/usr/bin/env node\nconsole.log(1)',
      '#include <stdio.h>\n正文',
      '#tag 这是话题标签\n正文',
    ]) {
      const blocks = parseMarkdownBlocks(text(raw));
      expect(blocks[0].kind).toBe('paragraph');
    }
  });

  it('回归:带空格的原有形态不受影响', () => {
    const blocks = parseMarkdownBlocks(
      text('# 标题\n\n- 项目\n\n| h |\n| - |\n| v |'),
    );
    expect(blocks.map(b => b.kind)).toEqual(['heading', 'list', 'table']);
  });
});


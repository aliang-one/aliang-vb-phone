import type {
  TranscriptMarkdownBlock,
  TranscriptMarkdownInline,
} from '../messageRendering';
import { parseMarkdownBlocks } from '../messageRendering';

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

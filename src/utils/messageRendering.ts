import { extractGoalReport, type GoalReportKind } from './goalReportMarker';

export type TranscriptTone = 'info' | 'warning' | 'neutral';

export interface TranscriptTextSegment {
  id: string;
  kind: 'text';
  content: string;
  blocks: TranscriptMarkdownBlock[];
}

export interface TranscriptFoldedSegment {
  id: string;
  kind: 'folded';
  label: string;
  content: string;
  tone: TranscriptTone;
}

export interface TranscriptCalloutSegment {
  id: string;
  kind: 'callout';
  title: string;
  content: string;
  tone: TranscriptTone;
  blocks: TranscriptMarkdownBlock[];
}

/**
 * Structured Goal report card extracted from the `ALIANG_GOAL_REPORT:` /
 * `ALIANG_GOAL_PLAN:` marker the agent prints at a turn's end. The raw marker
 * JSON is stripped from the narrative text (see {@link extractGoalReport}) and
 * surfaced as this card instead of leaking as plain text. The marker is a
 * machine channel; this segment is the human-facing rendering of it.
 */
export interface TranscriptGoalReportSegment {
  id: string;
  kind: 'goalReport';
  reportKind: GoalReportKind;
  outcome: 'task_completed' | 'blocked' | 'failed' | 'no_progress';
  summary: string;
  blockerCode?: string;
  completionProposed?: boolean;
}

export type TranscriptSegment =
  | TranscriptTextSegment
  | TranscriptFoldedSegment
  | TranscriptCalloutSegment
  | TranscriptGoalReportSegment;

export type TranscriptMarkdownInline =
  | { kind: 'text'; content: string }
  | { kind: 'strong'; children: TranscriptMarkdownInline[] }
  | { kind: 'emphasis'; children: TranscriptMarkdownInline[] }
  | { kind: 'strikethrough'; children: TranscriptMarkdownInline[] }
  | { kind: 'inlineCode'; content: string }
  | { kind: 'link'; url: string; children: TranscriptMarkdownInline[] }
  | { kind: 'image'; alt: string; url: string }
  | { kind: 'commandName'; content: string }
  | { kind: 'commandArgs'; content: string };

/** GFM 表格每列对齐:null = 默认左对齐。 */
export type TableAlign = 'left' | 'center' | 'right' | null;

export interface TranscriptListItem {
  /** 缩进层级:0 = 顶级,每 2 个空格(或 1 个 tab) +1。 */
  depth: number;
  /** 任务列表勾选状态;缺省 = 普通列表项。 */
  checkbox?: 'unchecked' | 'checked';
  children: TranscriptMarkdownInline[];
}

export type TranscriptMarkdownBlock =
  | { kind: 'paragraph'; children: TranscriptMarkdownInline[] }
  | { kind: 'heading'; level: number; children: TranscriptMarkdownInline[] }
  | { kind: 'quote'; children: TranscriptMarkdownInline[] }
  | { kind: 'list'; ordered: boolean; items: TranscriptListItem[] }
  | { kind: 'code'; language?: string; content: string }
  | {
      kind: 'table';
      align: TableAlign[];
      headers: TranscriptMarkdownInline[][];
      rows: TranscriptMarkdownInline[][][];
    }
  | { kind: 'thematicBreak' }
  | {
      kind: 'folded';
      label: string;
      content: string;
      preview?: string;
      tone: TranscriptTone;
      blocks: TranscriptMarkdownBlock[];
    };

type InlineTagKind = 'commandName' | 'commandArgs';

interface InlineTagSourcePart {
  kind: 'inlineTag';
  tagKind: InlineTagKind;
  content: string;
}

interface TextSourcePart {
  kind: 'text';
  content: string;
}

type MarkdownSourcePart = TextSourcePart | InlineTagSourcePart;

interface InlineTagConfig {
  display: 'inline';
  kind: InlineTagKind;
}

interface CalloutTagConfig {
  display: 'callout';
  title: string;
  tone: TranscriptTone;
}

interface FoldedTagConfig {
  display: 'folded';
  label: string;
  tone: TranscriptTone;
}

type TagConfig = InlineTagConfig | CalloutTagConfig | FoldedTagConfig;

interface TextToken {
  kind: 'text';
  content: string;
}

interface TagToken {
  kind: 'tag';
  tag: string;
  body: string;
  config: TagConfig;
}

type AgentMarkupToken = TextToken | TagToken;

const escapeControl = String.fromCharCode(27);
const csiControl = String.fromCharCode(155);
const ansiRegex = new RegExp(
  `(?:${escapeControl}|${csiControl})\\[[0-?]*[ -/]*[@-~]`,
  'g',
);

const tagRegistry: Record<string, TagConfig> = {
  think: { display: 'folded', label: 'Thinking', tone: 'neutral' },
  thinking: { display: 'folded', label: 'Thinking', tone: 'neutral' },
  analysis: { display: 'folded', label: 'Reasoning', tone: 'neutral' },
  reasoning: { display: 'folded', label: 'Reasoning', tone: 'neutral' },
  'system-reminder': {
    display: 'folded',
    label: 'System note',
    tone: 'neutral',
  },
  system: { display: 'folded', label: 'System note', tone: 'neutral' },
  developer: { display: 'folded', label: 'Developer note', tone: 'neutral' },
  command: { display: 'folded', label: 'Command', tone: 'info' },
  'local-command': { display: 'folded', label: 'Local command', tone: 'info' },
  'local-command-caveat': {
    display: 'callout',
    title: 'Command caveat',
    tone: 'warning',
  },
  'local-command-stdout': {
    display: 'folded',
    label: 'Command stdout',
    tone: 'info',
  },
  'local-command-stderr': {
    display: 'folded',
    label: 'Command stderr',
    tone: 'warning',
  },
  'local-command-status': {
    display: 'folded',
    label: 'Command status',
    tone: 'neutral',
  },
  'command-name': { display: 'inline', kind: 'commandName' },
  'command-args': { display: 'inline', kind: 'commandArgs' },
  'command-message': {
    display: 'callout',
    title: 'Command message',
    tone: 'info',
  },
  'command-output': {
    display: 'folded',
    label: 'Command output',
    tone: 'info',
  },
  'command-stdout': {
    display: 'folded',
    label: 'Command stdout',
    tone: 'info',
  },
  'command-stderr': {
    display: 'folded',
    label: 'Command stderr',
    tone: 'warning',
  },
  'command-status': {
    display: 'folded',
    label: 'Command status',
    tone: 'neutral',
  },
  stdout: { display: 'folded', label: 'Stdout', tone: 'info' },
  stderr: { display: 'folded', label: 'Stderr', tone: 'warning' },
  'bash-output': { display: 'folded', label: 'Terminal output', tone: 'info' },
  code: { display: 'folded', label: 'Code', tone: 'info' },
  'code-block': { display: 'folded', label: 'Code', tone: 'info' },
  patch: { display: 'folded', label: 'Patch', tone: 'info' },
  diff: { display: 'folded', label: 'Diff', tone: 'info' },
  tool: { display: 'folded', label: 'Tool event', tone: 'neutral' },
  'tool-use': { display: 'folded', label: 'Tool call', tone: 'info' },
  'tool-result': { display: 'folded', label: 'Tool result', tone: 'neutral' },
  'function-call': { display: 'folded', label: 'Function call', tone: 'info' },
  'function-result': {
    display: 'folded',
    label: 'Function result',
    tone: 'neutral',
  },
  'codex-event': { display: 'folded', label: 'Codex event', tone: 'neutral' },
  'claude-event': { display: 'folded', label: 'Claude event', tone: 'neutral' },
  approval: {
    display: 'callout',
    title: 'Approval request',
    tone: 'warning',
  },
  'approval-request': {
    display: 'callout',
    title: 'Approval request',
    tone: 'warning',
  },
  'approval-requested': {
    display: 'callout',
    title: 'Approval request',
    tone: 'warning',
  },
  'client-response': {
    display: 'callout',
    title: 'Approval request',
    tone: 'warning',
  },
};

const normalizeTag = (value: string) =>
  value.trim().toLowerCase().replace(/_/g, '-');

const tagConfig = (tag: string) => tagRegistry[normalizeTag(tag)];

const cleanText = (value: string) =>
  value
    .replace(ansiRegex, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

const textValue = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const objectRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object' && !Array.isArray(item)),
      )
    : [];

const formatAliangOptionsFence = (body: string) => {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    const title = textValue(raw.title) || 'Choose next step';
    const summary =
      textValue(raw.description) ||
      textValue(raw.summary) ||
      'The assistant is waiting for your choice.';
    const options = objectRecords(raw.options)
      .map((option, index) => {
        const label =
          textValue(option.label) || textValue(option.id) || `Option ${index + 1}`;
        const description = textValue(option.description);
        return description ? `- ${label}: ${description}` : `- ${label}`;
      })
      .filter(Boolean);
    return [title, '', summary, options.length ? ['', 'Options:', ...options].join('\n') : '']
      .filter(Boolean)
      .join('\n');
  } catch {
    return cleanText(body) || 'The assistant is waiting for your approval.';
  }
};

const replaceAliangOptionsFences = (rawContent: string) =>
  rawContent.replace(/```aliang-options\s*([\s\S]*?)```/gi, (_match, body) => {
    const content = formatAliangOptionsFence(String(body ?? ''));
    return `\n<approval-request>${content}</approval-request>\n`;
  });

const summarizeContent = (value: string) => {
  const lineCount = value ? value.split('\n').length : 0;
  if (!value) return 'empty';
  if (lineCount > 1) return `${lineCount} lines`;
  return `${value.length} chars`;
};

const AUTO_FOLD_CODE_LINES = 12;
const AUTO_FOLD_CODE_CHARS = 800;
const AUTO_FOLD_LIST_ITEMS = 8;
const AUTO_FOLD_TABLE_ROWS = 10;
const AUTO_FOLD_PARAGRAPH_LINES = 8;
const AUTO_FOLD_PARAGRAPH_CHARS = 900;
const AUTO_FOLD_SECTION_LINES = 6;
const toolSectionHeading = /^#{3,4}\s+(Ran Playwright code|Page|Snapshot|Events|Result|Console|Console entries|Warnings|Errors)\s*$/i;
const alwaysFoldToolSection = /^Ran Playwright code|Snapshot|Events|Console|Console entries|Warnings|Errors$/i;
const diagnosticToolSection = /^Result$/i;

const previewText = (value: string, maxLines = 3) =>
  value
    .split('\n')
    .slice(0, maxLines)
    .join('\n')
    .trim();

const countLines = (value: string) => (value ? value.split('\n').length : 0);

const foldLabel = (title: string, content: string) =>
  `${title} · ${summarizeContent(content)}`;

const inlineNodesText = (nodes: TranscriptMarkdownInline[]): string =>
  nodes
    .map(node => {
      switch (node.kind) {
        case 'strong':
        case 'emphasis':
        case 'strikethrough':
        case 'link':
          return inlineNodesText(node.children);
        case 'image':
          return node.alt;
        default:
          return node.content;
      }
    })
    .join('');

const blockText = (block: TranscriptMarkdownBlock): string => {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
    case 'quote':
      return inlineNodesText(block.children);
    case 'list':
      return block.items
        .map(
          (item, index) =>
            `${'  '.repeat(item.depth)}${item.checkbox ? `[${item.checkbox === 'checked' ? 'x' : ' '}] ` : `${index + 1}. `}${inlineNodesText(item.children)}`,
        )
        .join('\n');
    case 'table':
      return [
        block.headers.map(cells => inlineNodesText(cells)).join(' | '),
        ...block.rows.map(row =>
          row.map(cells => inlineNodesText(cells)).join(' | '),
        ),
      ].join('\n');
    case 'thematicBreak':
      return '---';
    case 'code':
      return block.content;
    case 'folded':
      return block.content;
  }
};

const createFoldedMarkdownBlock = (
  label: string,
  content: string,
  blocks: TranscriptMarkdownBlock[],
  tone: TranscriptTone = 'neutral',
): TranscriptMarkdownBlock => ({
  kind: 'folded',
  label,
  content,
  preview: previewText(content),
  tone,
  blocks,
});

const shouldFoldCodeBlock = (block: Extract<TranscriptMarkdownBlock, { kind: 'code' }>) =>
  countLines(block.content) > AUTO_FOLD_CODE_LINES ||
  block.content.length > AUTO_FOLD_CODE_CHARS;

const shouldFoldParagraphBlock = (
  block: Extract<TranscriptMarkdownBlock, { kind: 'paragraph' | 'quote' }>,
) => {
  const content = blockText(block);
  return (
    countLines(content) > AUTO_FOLD_PARAGRAPH_LINES ||
    content.length > AUTO_FOLD_PARAGRAPH_CHARS ||
    /\[WARNING\]|\[ERROR\]|Vue warn|Traceback|Exception/i.test(content)
  );
};

const headingText = (block: TranscriptMarkdownBlock) =>
  block.kind === 'heading' ? inlineNodesText(block.children).trim() : '';

const isToolSectionHeading = (
  block: TranscriptMarkdownBlock,
): block is Extract<TranscriptMarkdownBlock, { kind: 'heading' }> =>
  block.kind === 'heading' &&
  toolSectionHeading.test(`#`.repeat(block.level) + ` ${headingText(block)}`);

const autoFoldMarkdownBlocks = (
  blocks: TranscriptMarkdownBlock[],
): TranscriptMarkdownBlock[] => {
  const result: TranscriptMarkdownBlock[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];
    const title = headingText(block);

    if (isToolSectionHeading(block)) {
      const section: TranscriptMarkdownBlock[] = [block];
      index += 1;
      while (index < blocks.length) {
        const next = blocks[index];
        if (
          next.kind === 'heading' &&
          next.level <= block.level &&
          isToolSectionHeading(next)
        ) {
          break;
        }
        section.push(next);
        index += 1;
      }
      const content = section.map(blockText).filter(Boolean).join('\n\n');
      const shouldFold =
        alwaysFoldToolSection.test(title) ||
        (diagnosticToolSection.test(title) &&
          /\[WARNING\]|\[ERROR\]|Total messages|Console:/i.test(content)) ||
        countLines(content) >= AUTO_FOLD_SECTION_LINES ||
        content.length > 360;
      if (shouldFold) {
        result.push(createFoldedMarkdownBlock(foldLabel(title, content), content, section, title.match(/warning|error/i) ? 'warning' : 'info'));
      } else {
        result.push(...section);
      }
      continue;
    }

    if (block.kind === 'code' && shouldFoldCodeBlock(block)) {
      const title = block.language
        ? `${block.language.toUpperCase()} code`
        : 'Code';
      result.push(createFoldedMarkdownBlock(foldLabel(title, block.content), block.content, [block], 'info'));
      index += 1;
      continue;
    }

    if (block.kind === 'list' && block.items.length > AUTO_FOLD_LIST_ITEMS) {
      const content = blockText(block);
      result.push(createFoldedMarkdownBlock(foldLabel('List', content), content, [block], 'neutral'));
      index += 1;
      continue;
    }

    if (block.kind === 'table' && block.rows.length > AUTO_FOLD_TABLE_ROWS) {
      const content = blockText(block);
      result.push(createFoldedMarkdownBlock(foldLabel('Table', content), content, [block], 'neutral'));
      index += 1;
      continue;
    }

    if ((block.kind === 'paragraph' || block.kind === 'quote') && shouldFoldParagraphBlock(block)) {
      const content = blockText(block);
      const warning = /\[WARNING\]|\[ERROR\]|Vue warn|Traceback|Exception/i.test(content);
      result.push(createFoldedMarkdownBlock(foldLabel(warning ? 'Log output' : 'Long text', content), content, [block], warning ? 'warning' : 'neutral'));
      index += 1;
      continue;
    }

    result.push(block);
    index += 1;
  }

  return result;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isBlank = (line: string) => line.trim().length === 0;

const appendTextInline = (
  target: TranscriptMarkdownInline[],
  content: string,
) => {
  if (!content) return;
  const previous = target[target.length - 1];
  if (previous?.kind === 'text') {
    previous.content += content;
    return;
  }
  target.push({ kind: 'text', content });
};

const placeholderForInlineTag = (index: number) =>
  `@@AGENT_INLINE_TAG_${index}@@`;

const markdownSourceToText = (parts: MarkdownSourcePart[]) => {
  const inlineTags: InlineTagSourcePart[] = [];
  const content = parts
    .map(part => {
      if (part.kind === 'text') return part.content;
      const index = inlineTags.length;
      inlineTags.push(part);
      return placeholderForInlineTag(index);
    })
    .join('');

  return { content: cleanText(content), inlineTags };
};

const parseInlineMarkdown = (
  value: string,
  inlineTags: InlineTagSourcePart[],
): TranscriptMarkdownInline[] => {
  const nodes: TranscriptMarkdownInline[] = [];
  let index = 0;

  const nextSpecialIndex = (start: number) => {
    const candidates = [
      value.indexOf('@@AGENT_INLINE_TAG_', start),
      value.indexOf('`', start),
      value.indexOf('**', start),
      value.indexOf('__', start),
      value.indexOf('~~', start),
      value.indexOf('![', start),
      value.indexOf('[', start),
      value.indexOf('*', start),
      value.indexOf('_', start),
    ].filter(candidate => candidate >= 0);

    return candidates.length ? Math.min(...candidates) : -1;
  };

  while (index < value.length) {
    const remaining = value.slice(index);
    const tagMatch = remaining.match(/^@@AGENT_INLINE_TAG_(\d+)@@/);
    if (tagMatch) {
      const tag = inlineTags[Number(tagMatch[1])];
      if (tag?.tagKind === 'commandName' || tag?.tagKind === 'commandArgs') {
        const content = cleanText(tag.content);
        if (content) nodes.push({ kind: tag.tagKind, content });
      } else {
        appendTextInline(nodes, tag?.content ?? tagMatch[0]);
      }
      index += tagMatch[0].length;
      continue;
    }

    if (remaining.startsWith('`')) {
      const end = value.indexOf('`', index + 1);
      if (end > index + 1) {
        nodes.push({
          kind: 'inlineCode',
          content: value.slice(index + 1, end),
        });
        index = end + 1;
        continue;
      }
    }

    const strongMarker = remaining.startsWith('**')
      ? '**'
      : remaining.startsWith('__')
      ? '__'
      : null;
    if (strongMarker) {
      const end = value.indexOf(strongMarker, index + 2);
      if (end > index + 2) {
        nodes.push({
          kind: 'strong',
          children: parseInlineMarkdown(
            value.slice(index + 2, end),
            inlineTags,
          ),
        });
        index = end + 2;
        continue;
      }
    }

    if (remaining.startsWith('~~')) {
      const end = value.indexOf('~~', index + 2);
      if (end > index + 2) {
        nodes.push({
          kind: 'strikethrough',
          children: parseInlineMarkdown(
            value.slice(index + 2, end),
            inlineTags,
          ),
        });
        index = end + 2;
        continue;
      }
    }

    if (remaining.startsWith('![')) {
      const closeLabel = value.indexOf(']', index + 2);
      const openUrl = closeLabel >= 0 ? closeLabel + 1 : -1;
      if (openUrl >= 0 && value[openUrl] === '(') {
        const closeUrl = value.indexOf(')', openUrl + 1);
        if (closeUrl > openUrl + 1) {
          const alt = value.slice(index + 2, closeLabel);
          const url = value.slice(openUrl + 1, closeUrl).trim();
          nodes.push({ kind: 'image', alt, url });
          index = closeUrl + 1;
          continue;
        }
      }
    }

    if (remaining.startsWith('[')) {
      const closeLabel = value.indexOf(']', index + 1);
      const openUrl = closeLabel >= 0 ? closeLabel + 1 : -1;
      if (openUrl >= 0 && value[openUrl] === '(') {
        const closeUrl = value.indexOf(')', openUrl + 1);
        if (closeUrl > openUrl + 1) {
          const label = value.slice(index + 1, closeLabel);
          const url = value.slice(openUrl + 1, closeUrl).trim();
          nodes.push({
            kind: 'link',
            url,
            children: parseInlineMarkdown(label, inlineTags),
          });
          index = closeUrl + 1;
          continue;
        }
      }
    }

    const emphasisMarker =
      remaining.startsWith('*') && !remaining.startsWith('**')
        ? '*'
        : remaining.startsWith('_') && !remaining.startsWith('__')
        ? '_'
        : null;
    if (emphasisMarker) {
      const end = value.indexOf(emphasisMarker, index + 1);
      if (end > index + 1) {
        nodes.push({
          kind: 'emphasis',
          children: parseInlineMarkdown(
            value.slice(index + 1, end),
            inlineTags,
          ),
        });
        index = end + 1;
        continue;
      }
    }

    const next = nextSpecialIndex(index + 1);
    appendTextInline(
      nodes,
      value.slice(index, next >= 0 ? next : value.length),
    );
    index = next >= 0 ? next : value.length;
  }

  return nodes;
};

const lineStartsCodeFence = (line: string) => /^```/.test(line.trim());

const lineStartsThematicBreak = (line: string) =>
  /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line);

/** 按 `|` 拆分一行表格单元格,去掉首尾可选的外管道。 */
const splitTableRow = (line: string): string[] => {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map(cell => cell.trim());
};

const cellAlign = (cell: string): TableAlign => {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
};

const lineStartsHeading = (line: string) => /^#{1,6}\s+/.test(line.trim());

const lineStartsQuote = (line: string) => /^>\s?/.test(line.trim());

const unorderedListMatch = (line: string) => line.match(/^\s*[-*+]\s+(.+)$/);

const orderedListMatch = (line: string) => line.match(/^\s*\d+[.)]\s+(.+)$/);

const lineStartsList = (line: string) =>
  Boolean(unorderedListMatch(line) ?? orderedListMatch(line));

const lineStartsBlock = (line: string) =>
  lineStartsCodeFence(line) ||
  lineStartsThematicBreak(line) ||
  lineStartsHeading(line) ||
  lineStartsQuote(line) ||
  lineStartsList(line);

export const parseMarkdownBlocks = (
  parts: MarkdownSourcePart[],
): TranscriptMarkdownBlock[] => {
  const { content, inlineTags } = markdownSourceToText(parts);
  if (!content) return [];

  const blocks: TranscriptMarkdownBlock[] = [];
  const lines = content.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (isBlank(line)) {
      index += 1;
      continue;
    }

    if (lineStartsCodeFence(line)) {
      const language = trimmed.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lineStartsCodeFence(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        kind: 'code',
        language,
        content: codeLines.join('\n').replace(/\n+$/, ''),
      });
      continue;
    }

    if (lineStartsThematicBreak(line)) {
      blocks.push({ kind: 'thematicBreak' });
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length) {
      const headerCells = splitTableRow(line);
      const sepCells = splitTableRow(lines[index + 1]);
      if (
        headerCells.length >= 1 &&
        sepCells.length === headerCells.length &&
        sepCells.every(cell => /^:?-+:?$/.test(cell))
      ) {
        const align = sepCells.map(cellAlign);
        const headers = headerCells.map(cell =>
          parseInlineMarkdown(cell, inlineTags),
        );
        index += 2;
        const rows: TranscriptMarkdownInline[][][] = [];
        while (
          index < lines.length &&
          !isBlank(lines[index]) &&
          lines[index].includes('|')
        ) {
          const rowCells = splitTableRow(lines[index]);
          const padded = headers.map((_, i) =>
            parseInlineMarkdown(rowCells[i] ?? '', inlineTags),
          );
          rows.push(padded);
          index += 1;
        }
        blocks.push({ kind: 'table', align, headers, rows });
        continue;
      }
    }

    if (lineStartsHeading(line)) {
      const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        blocks.push({
          kind: 'heading',
          level: match[1].length,
          children: parseInlineMarkdown(match[2], inlineTags),
        });
        index += 1;
        continue;
      }
    }

    if (lineStartsQuote(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && lineStartsQuote(lines[index])) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({
        kind: 'quote',
        children: parseInlineMarkdown(quoteLines.join('\n'), inlineTags),
      });
      continue;
    }

    const unordered = unorderedListMatch(line);
    const ordered = orderedListMatch(line);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const items: TranscriptListItem[] = [];
      while (index < lines.length) {
        const currentMatch = isOrdered
          ? orderedListMatch(lines[index])
          : unorderedListMatch(lines[index]);
        if (!currentMatch) break;
        const indentMatch = lines[index].match(/^(\s*)/);
        const indentWidth = indentMatch
          ? indentMatch[1].replace(/\t/g, '  ').length
          : 0;
        const depth = Math.floor(indentWidth / 2);
        const rawContent = currentMatch[1];
        const taskMatch = rawContent.match(/^\[([ xX])\]\s+(.*)$/);
        items.push({
          depth,
          checkbox: taskMatch
            ? taskMatch[1].toLowerCase() === 'x'
              ? 'checked'
              : 'unchecked'
            : undefined,
          children: parseInlineMarkdown(
            taskMatch ? taskMatch[2] : rawContent,
            inlineTags,
          ),
        });
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items });
      continue;
    }

    const paragraphLines: string[] = [trimmed];
    index += 1;
    while (
      index < lines.length &&
      !isBlank(lines[index]) &&
      !lineStartsBlock(lines[index])
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({
      kind: 'paragraph',
      children: parseInlineMarkdown(paragraphLines.join('\n'), inlineTags),
    });
  }

  return autoFoldMarkdownBlocks(blocks);
};

const isInsideRange = (
  index: number,
  ranges: Array<{ start: number; end: number }>,
) => ranges.some(range => index >= range.start && index < range.end);

const collectMarkdownCodeRanges = (content: string) => {
  const ranges: Array<{ start: number; end: number }> = [];
  const fenceRegex = /^```.*$/gm;
  let opening: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content))) {
    if (!opening) {
      opening = match;
      continue;
    }
    const closeLineEnd = content.indexOf('\n', match.index);
    ranges.push({
      start: opening.index,
      end: closeLineEnd >= 0 ? closeLineEnd : content.length,
    });
    opening = null;
  }

  if (opening) {
    ranges.push({ start: opening.index, end: content.length });
  }

  let index = 0;
  while (index < content.length) {
    const open = content.indexOf('`', index);
    if (open < 0) break;
    if (isInsideRange(open, ranges)) {
      index = open + 1;
      continue;
    }
    const close = content.indexOf('`', open + 1);
    if (close < 0) break;
    ranges.push({ start: open, end: close + 1 });
    index = close + 1;
  }

  return ranges;
};

const tokenizeAgentMarkup = (rawContent: string): AgentMarkupToken[] => {
  const content = replaceAliangOptionsFences(rawContent)
    .replace(ansiRegex, '')
    .replace(/\r\n/g, '\n');
  const codeRanges = collectMarkdownCodeRanges(content);
  const tokens: AgentMarkupToken[] = [];
  const tagRegex = /<([a-zA-Z][\w:-]*)(?:\s[^>]*)?>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content))) {
    const [openingTag, rawTag] = match;
    const config = tagConfig(rawTag);
    if (!config || isInsideRange(match.index, codeRanges)) continue;

    const closingRegex = new RegExp(`</\\s*${escapeRegExp(rawTag)}\\s*>`, 'gi');
    closingRegex.lastIndex = match.index + openingTag.length;
    const closing = closingRegex.exec(content);
    const bodyStart = match.index + openingTag.length;
    const bodyEnd = closing?.index ?? content.length;
    const fullEnd = closing
      ? closing.index + closing[0].length
      : content.length;

    if (match.index > lastIndex) {
      tokens.push({
        kind: 'text',
        content: content.slice(lastIndex, match.index),
      });
    }

    tokens.push({
      kind: 'tag',
      tag: normalizeTag(rawTag),
      body: content.slice(bodyStart, bodyEnd),
      config,
    });
    lastIndex = fullEnd;
    tagRegex.lastIndex = fullEnd;
  }

  if (lastIndex < content.length) {
    tokens.push({ kind: 'text', content: content.slice(lastIndex) });
  }

  return tokens;
};

const sourcePartContent = (part: MarkdownSourcePart) => part.content;

const createTextSegment = (
  messageId: string,
  index: number,
  parts: MarkdownSourcePart[],
): TranscriptTextSegment | null => {
  const content = cleanText(parts.map(sourcePartContent).join(''));
  if (!content) return null;
  return {
    id: `${messageId}:text:${index}`,
    kind: 'text',
    content,
    blocks: parseMarkdownBlocks(parts),
  };
};

const createCalloutSegment = (
  messageId: string,
  index: number,
  tag: string,
  config: CalloutTagConfig,
  body: string,
): TranscriptCalloutSegment | null => {
  const content = cleanText(body);
  if (!content) return null;
  return {
    id: `${messageId}:callout:${index}:${tag}`,
    kind: 'callout',
    title: config.title,
    content,
    tone: config.tone,
    blocks: parseMarkdownBlocks([{ kind: 'text', content }]),
  };
};

const createFoldedSegment = (
  messageId: string,
  index: number,
  tag: string,
  config: FoldedTagConfig,
  body: string,
): TranscriptFoldedSegment | null => {
  const content = cleanText(body);
  if (!content) return null;
  return {
    id: `${messageId}:folded:${index}:${tag}`,
    kind: 'folded',
    label: `${config.label} · ${summarizeContent(content)}`,
    content,
    tone: config.tone,
  };
};

export const parseMessageContentSegments = (
  messageId: string,
  content: string,
): TranscriptSegment[] => {
  // Peel off the structured Goal marker (ALIANG_GOAL_REPORT/PLAN) before
  // tokenizing: the marker JSON must never render as plain text. `narrative`
  // is what the user should read; `report` (when complete) becomes a card
  // segment appended after the narrative. During streaming the marker may be
  // half-arrived — extractGoalReport suppresses the partial tail and returns
  // report=null so no raw JSON flashes and no card is shown prematurely.
  const { narrative, report, reportKind } = extractGoalReport(content);
  const tokens = tokenizeAgentMarkup(narrative);
  const segments: TranscriptSegment[] = [];
  let inlineParts: MarkdownSourcePart[] = [];
  let segmentIndex = 0;

  const flushInlineParts = () => {
    const segment = createTextSegment(messageId, segmentIndex, inlineParts);
    inlineParts = [];
    if (segment) {
      segments.push(segment);
      segmentIndex += 1;
    }
  };

  for (const token of tokens) {
    if (token.kind === 'text') {
      inlineParts.push({ kind: 'text', content: token.content });
      continue;
    }

    if (token.config.display === 'inline') {
      inlineParts.push({
        kind: 'inlineTag',
        tagKind: token.config.kind,
        content: token.body,
      });
      continue;
    }

    flushInlineParts();

    const segment =
      token.config.display === 'callout'
        ? createCalloutSegment(
            messageId,
            segmentIndex,
            token.tag,
            token.config,
            token.body,
          )
        : createFoldedSegment(
            messageId,
            segmentIndex,
            token.tag,
            token.config,
            token.body,
          );

    if (segment) {
      segments.push(segment);
      segmentIndex += 1;
    }
  }

  flushInlineParts();

  if (report && reportKind) {
    segments.push({
      id: `${messageId}:goalReport`,
      kind: 'goalReport',
      reportKind,
      outcome: report.outcome,
      summary: report.summary,
      blockerCode: report.blockerCode,
      completionProposed: report.completionProposed,
    });
  }

  return segments;
};

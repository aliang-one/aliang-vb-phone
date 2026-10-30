import { extractGoalReport, type GoalReportKind } from './goalReportMarker';

export type TranscriptTone = 'info' | 'warning' | 'neutral';

/**
 * task-notification 卡片携带的结构化字段。status 驱动卡片徽章配色
 * （completed/failed/其他），outputFile 渲染成 mono 元数据行，result 是子
 * agent 的收尾输出——可能很长，卡片里默认折叠。
 */
export interface TranscriptTaskMeta {
  status?: string;
  outputFile?: string;
  result?: string;
}

/** v2 结构化选项卡的选项行。label 原样渲染（颜文字/emoji 逐字符保真），
 * 永不过 inline markdown 管线（inline 阶段会吞配对的星号、下划线、反引号
 * 与双波浪线——见 parseInlineMarkdown 的 emphasis/code 分支）。 */
export interface TranscriptOptionCardOption {
  id: string;
  label: string;
  description?: string;
  previews?: string[];
}

/**
 * v2 结构化选项卡——aliang-options 围栏的机读旁路，照 TranscriptTaskMeta
 * 先例：`<card-json>` 子标签承载 JSON，createCalloutSegment 拆出进 segment。
 * 正文仍保留 markdown 圆点文本，作 v1 降级渲染与长按复制来源。与 server 侧
 * approval/parsing.ts 的 optionBlockFromRaw 是镜像词表，加字段两处同批。
 */
export interface TranscriptOptionCard {
  version?: number;
  header?: string;
  title: string;
  summary?: string;
  multi: boolean;
  allowCustom: boolean;
  options: TranscriptOptionCardOption[];
}

/**
 * Callout 展示家族。`approval`（`<approval-request>` 标签 / aliang-options
 * 围栏与丢围栏兜底转换而来）在渲染层有专属卡片样式（盾形图标 + 待处理徽章 +
 * i18n 标题）；`task`（task-notification 信封，含无包裹的裸字段簇）走
 * 后台任务卡（agent 徽标 + 状态徽章 + 输出文件行 + 可折叠任务输出）；
 * `command`（斜杠命令簇合并卡）走终端图标 + mono 命令行外观；
 * `generic` 是其余标签的通用警示框外观。缺省即 `generic`。
 */
export type TranscriptCalloutVariant = 'generic' | 'approval' | 'task' | 'command';

export interface TranscriptCalloutSegment {
  id: string;
  kind: 'callout';
  variant: TranscriptCalloutVariant;
  /**
   * 仅 variant==='approval' 有意义：aliang-options 协议的 multi 标志——
   * true 表示多选（可勾选多个方案），false/缺省为单选。由
   * replaceAliangOptionsFences 写成开标签 attr（`<approval-request multi>`）
   * 穿过 tokenize，再由 createCalloutSegment 读回——布尔值没法放进人读的
   * 正文里，这是它抵达渲染层的唯一通道。
   */
  multi?: boolean;
  /**
   * 仅 variant==='approval' 有意义：v2 结构化选项卡（存在时渲染层走原生
   * 选项行，绕开 markdown 往返）。缺省 = v1 块/坏 JSON，走 markdown 圆点降级。
   */
  optionCard?: TranscriptOptionCard;
  /** 仅 variant==='task' 有意义：状态/输出文件/任务输出三件套。 */
  meta?: TranscriptTaskMeta;
  title: string;
  content: string;
  tone: TranscriptTone;
  blocks: TranscriptMarkdownBlock[];
}

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
  /** 展示家族；缺省 'generic'（通用警示框）。approval 走专属卡片样式。 */
  variant?: TranscriptCalloutVariant;
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
  /** 开标签 attr(如 <approval-request multi> 的 multi)。 */
  attrs?: Readonly<Record<string, string>>;
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
    variant: 'approval',
  },
  'approval-request': {
    display: 'callout',
    title: 'Approval request',
    tone: 'warning',
    variant: 'approval',
  },
  'task-notification': {
    display: 'callout',
    title: 'Background task',
    tone: 'info',
    variant: 'task',
  },
  'harness-command': {
    display: 'callout',
    title: 'Slash command',
    tone: 'neutral',
    variant: 'command',
  },
  'cross-session-message': {
    display: 'callout',
    title: 'Cross-session message',
    tone: 'info',
  },
  'approval-requested': {
    display: 'callout',
    title: 'Approval request',
    tone: 'warning',
    variant: 'approval',
  },
  'client-response': {
    display: 'callout',
    title: 'Approval request',
    tone: 'warning',
    variant: 'approval',
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

/** previews 钳制：≤8 项、每项 ≤200 字符（防模型倒整段 diff 进卡）。 */
const previewsFromRaw = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.slice(0, 200))
    .slice(0, 8);
  return items.length > 0 ? items : undefined;
};

/**
 * 把 aliang-options JSON 正文化为 approval 卡片正文。multi 走返回值（fenced/
 * bare 两路写开标签 attr）；card 是 v2 结构化旁路——调用方把它包成
 * `<card-json>` 子标签随正文进 tokenizer，createCalloutSegment 拆回。
 * content 永远产出（markdown 圆点），作 v1 渲染与长按复制来源。
 */
const formatAliangOptionsFence = (
  body: string,
): { content: string; multi: boolean; card?: TranscriptOptionCard } => {
  const fallback = (): { content: string; multi: boolean } => ({
    content: cleanText(body) || 'The assistant is waiting for your approval.',
    multi: false,
  });
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    const title = textValue(raw.title) || 'Choose next step';
    const summary =
      textValue(raw.description) ||
      textValue(raw.summary) ||
      'The assistant is waiting for your choice.';
    const structured = objectRecords(raw.options)
      .map((option, index) => {
        const id = textValue(option.id) || textValue(option.label) || `option-${index + 1}`;
        const label =
          textValue(option.label) || textValue(option.id) || `Option ${index + 1}`;
        const description = textValue(option.description);
        const previews = previewsFromRaw(option.previews);
        return {
          id,
          label,
          ...(description ? { description } : {}),
          ...(previews ? { previews } : {}),
        };
      })
      .filter(option => option.label)
      .slice(0, 8);
    const card: TranscriptOptionCard | undefined = structured.length
      ? {
          ...(typeof raw.v === 'number' ? { version: raw.v } : {}),
          ...(textValue(raw.header) ? { header: textValue(raw.header) } : {}),
          title,
          summary,
          multi: raw.multi === true,
          allowCustom: raw.allow_custom === true,
          options: structured,
        }
      : undefined;
    const options = structured.map(option =>
      option.description
        ? `- ${option.label}: ${option.description}`
        : `- ${option.label}`,
    );
    return {
      content: [
        title,
        '',
        summary,
        options.length ? ['', 'Options:', ...options].join('\n') : '',
      ]
        .filter(Boolean)
        .join('\n'),
      multi: raw.multi === true,
      card,
    };
  } catch {
    return fallback();
  }
};

// --- Claude Code harness 信封格式化 -----------------------------------------
// harness 会把后台任务通知、斜杠命令记录等以 XML 信封形态注入 user 消息流
// （生产 ai_messages 实证：task-notification 71 条全裸奔、命令簇 86 条零碎
// 三段）。这里把信封正文化为可读卡片内容；标签本身交给 tagRegistry 呈现。

const harnessField = (body: string, field: string): string => {
  const match = new RegExp(`<${field}>\\s*([\\s\\S]*?)\\s*</${field}>`).exec(body);
  return match ? match[1].trim() : '';
};

/**
 * 把 task-notification 信封体（包裹式或裸字段簇，两者字段同名）规整为
 * 「人读 headline + 机器字段标签」的统一信封体：headline 是 summary 一句话，
 * status/output-file/result 以嵌套标签随行——tokenizer 消费外层标签时整体
 * 跳过内层（lastIndex 越过整个信封），createCalloutSegment 再拆出来进
 * meta。task-id / tool-use-id / note 是纯管线字段，对手机读者只是噪音。
 */
const formatTaskNotificationBody = (body: string): string => {
  const status = harnessField(body, 'status');
  const summary = harnessField(body, 'summary');
  const outputFile = harnessField(body, 'output-file');
  const result = harnessField(body, 'result');
  if (!status && !summary && !outputFile && !result) return cleanText(body);
  const machine = [
    status ? `<task-status>${status}</task-status>` : '',
    outputFile ? `<task-output-file>${outputFile}</task-output-file>` : '',
    result ? `<task-result>${result}</task-result>` : '',
  ]
    .filter(Boolean)
    .join('');
  return `${summary || status}${machine}`;
};

const replaceTaskNotificationEnvelope = (content: string) =>
  content.replace(
    /<task-notification>\s*([\s\S]*?)\s*<\/task-notification>/gi,
    (_match, body) =>
      `\n<task-notification>${formatTaskNotificationBody(String(body ?? ''))}</task-notification>\n`,
  );

// 裸 task-notification 簇：CC 的后台任务通知更常见的形态是不带
// <task-notification> 包裹、直接一串 <task-id>/<tool-use-id>/<output-file>/
// <status>/<summary>/<note>/<result> 裸字段（生产实锤，用户聊天里"经常出现
// 这种"）。相邻裸字段簇合并成一张后台任务卡，避免逐字段漏出成原文。
// 反向引用 </\\1> 保证 <result> 体内出现 </status> 字样不会截断配对。
const TASK_FIELD_TAG =
  'task-id|tool-use-id|output-file|status|summary|note|result';
const BARE_TASK_FIELD_CLUSTER = new RegExp(
  `(?:\\s*<(${TASK_FIELD_TAG})>[\\s\\S]*?</\\1>)+`,
  'gi',
);

const replaceBareTaskNotificationCluster = (content: string) =>
  content.replace(BARE_TASK_FIELD_CLUSTER, cluster => {
    if (!/<task-id>/i.test(cluster)) return cluster;
    return `\n<task-notification>${formatTaskNotificationBody(cluster)}</task-notification>\n`;
  });

// 斜杠命令簇：<command-message>+<command-name>+<command-args>(+<skill-format>)
// 相邻出现时合并为一张 Slash command 卡片，替代"零碎三段"。
const HARNESS_COMMAND_TAG = 'command-message|command-name|command-args|skill-format|command-contents';
const HARNESS_COMMAND_CLUSTER = new RegExp(
  `(?:\\s*<(?:${HARNESS_COMMAND_TAG})>[\\s\\S]*?</(?:${HARNESS_COMMAND_TAG})>)+`,
  'gi',
);

const replaceHarnessCommandCluster = (content: string) =>
  content.replace(HARNESS_COMMAND_CLUSTER, cluster => {
    const name = harnessField(cluster, 'command-name');
    if (!name) return cluster;
    const args = harnessField(cluster, 'command-args');
    const label = name.startsWith('/') ? name : `/${name}`;
    return `\n<harness-command>${args ? `${label} ${args}` : label}</harness-command>\n`;
  });

const formatHarnessEnvelopes = (content: string) =>
  replaceHarnessCommandCluster(
    replaceBareTaskNotificationCluster(replaceTaskNotificationEnvelope(content)),
  );

/** v2 结构化卡随正文走 `<card-json>` 子标签（照 task-status 先例），
 * createCalloutSegment 拆进 segment.optionCard。 */
const approvalRequestTag = (formatted: {
  content: string;
  multi: boolean;
  card?: TranscriptOptionCard;
}) =>
  `\n<approval-request${formatted.multi ? ' multi' : ''}>${
    formatted.card
      ? `<card-json>${JSON.stringify(formatted.card)}</card-json>`
      : ''
  }${formatted.content}</approval-request>\n`;

const replaceAliangOptionsFences = (rawContent: string) => {
  const content = rawContent.replace(
    /```aliang-options\s*([\s\S]*?)```/gi,
    (_match, body) =>
      approvalRequestTag(formatAliangOptionsFence(String(body ?? ''))),
  );
  return replaceBareOptionJson(content);
};

// --- Fence-tolerant aliang-options fallback ---------------------------------
// 生产实锤：模型偶尔丢掉 ```aliang-options 围栏标签——裸 JSON、裸 ``` 围栏、
// JSON 混在散文里——旧解析原样把 JSON 打印给用户。这里按"形状"识别兜底，
// 与 server 侧 approval/parsing.ts 的 fenceTolerantOptionBlocks 保持同一判定
//（两处为镜像实现，改一处须同步另一处）。

const OPTION_JSON_MARKER = /"options"\s*:/g;

/** 带非 json/aliang-options 语言标签的围栏视为代码示例，不转卡片——
 * 文档示例不能在聊天里伪装成方案卡。裸 ``` 围栏与无围栏 JSON 仍可识别。 */
const FALLBACK_FENCE_LANGUAGES = new Set(['', 'aliang-options', 'json']);

/** 字符串感知单趟扫描，返回每个配平 `{...}` 对象的 [start, end) 区间。
 * JSON 字符串字面量里的花括号（含转义引号）不计入嵌套。半截流式 JSON
 * 没有闭合区间，天然跳过。 */
const collectBalancedObjectSpans = (content: string): Array<[number, number]> => {
  const spans: Array<[number, number]> = [];
  const stack: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      stack.push(i);
    } else if (ch === '}' && stack.length > 0) {
      spans.push([stack.pop() as number, i + 1]);
    }
  }
  return spans;
};

interface FenceSpan {
  start: number;
  end: number;
  language: string;
}

const collectOptionFenceSpans = (content: string): FenceSpan[] => {
  const spans: FenceSpan[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content))) {
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      language: match[1].trim().toLowerCase(),
    });
  }
  return spans;
};

const isOptionRequestShape = (raw: unknown): raw is Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  const options = record.options;
  if (!Array.isArray(options) || options.length === 0 || options.length > 12) {
    return false;
  }
  const wellFormed = options.every(
    option =>
      Boolean(option) &&
      typeof option === 'object' &&
      !Array.isArray(option) &&
      (typeof (option as Record<string, unknown>).label === 'string' ||
        typeof (option as Record<string, unknown>).id === 'string'),
  );
  if (!wellFormed) return false;
  // 形状锚点：至少带一个签名级字段，避免普通配置 JSON 误判。
  return (
    typeof record.title === 'string' ||
    typeof record.allow_custom === 'boolean' ||
    typeof record.multi === 'boolean'
  );
};

const replaceBareOptionJson = (content: string) => {
  const objectSpans = collectBalancedObjectSpans(content);
  if (objectSpans.length === 0) return content;
  const fences = collectOptionFenceSpans(content);
  // v2:<card-json> 子标签里的结构化卡自带 "options": 锚点,会被下面的
  // 裸 JSON 扫描误捕获再包一层 approval-request(嵌套标签把 tokenizer
  // 截断)。card-json 区间整体排除。
  const cardJsonSpans: Array<[number, number]> = [];
  const cardJsonRe = /<card-json>[\s\S]*?<\/card-json>/gi;
  let cardSpan: RegExpExecArray | null;
  while ((cardSpan = cardJsonRe.exec(content))) {
    cardJsonSpans.push([cardSpan.index, cardSpan.index + cardSpan[0].length]);
  }
  const replacements: Array<{
    start: number;
    end: number;
    body: string;
    multi: boolean;
    card?: TranscriptOptionCard;
  }> = [];
  OPTION_JSON_MARKER.lastIndex = 0;
  let marker: RegExpExecArray | null;
  while ((marker = OPTION_JSON_MARKER.exec(content))) {
    const markerIndex = marker.index;
    // 覆盖该标记的最小配平对象——对 option 形状来说就是带 options 键的那层。
    let best: [number, number] | null = null;
    for (const [start, end] of objectSpans) {
      if (start <= markerIndex && markerIndex < end) {
        if (!best || (start >= best[0] && end <= best[1])) best = [start, end];
      }
    }
    if (!best) continue;
    if (
      cardJsonSpans.some(([start, end]) => best![0] >= start && best![1] <= end)
    ) {
      continue; // 结构化卡的 JSON 已在 <card-json> 里,不重复转卡。
    }
    if (
      replacements.some(
        existing => existing.start < best![1] && best![0] < existing.end,
      )
    ) {
      continue; // 嵌套对象共享标记：已接受的外层替换优先，防重叠替换。
    }
    const fence = fences.find(
      span => best![0] >= span.start && best![1] <= span.end,
    );
    if (fence && !FALLBACK_FENCE_LANGUAGES.has(fence.language)) continue;
    const json = content.slice(best[0], best[1]);
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      continue;
    }
    if (!isOptionRequestShape(raw)) continue;
    // JSON 在（允许的）裸围栏内时，把整个围栏一起替换：只换 JSON 会把
    // <approval-request> 标签留在 ``` 围栏里，被 markdown 当成代码块。
    const start = fence ? fence.start : best[0];
    const end = fence ? fence.end : best[1];
    const { content: optionBody, multi, card } = formatAliangOptionsFence(json);
    replacements.push({
      start,
      end,
      body: optionBody,
      multi,
      card,
    });
  }
  if (replacements.length === 0) return content;
  let result = '';
  let cursor = 0;
  for (const replacement of replacements) {
    result +=
      content.slice(cursor, replacement.start) +
      approvalRequestTag({
        content: replacement.body,
        multi: replacement.multi,
        card: replacement.card,
      });
    cursor = replacement.end;
  }
  return result + content.slice(cursor);
};

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

// isTablePairStart 判定「本行是表头且下一行是分隔行」——表格分支的可达性
// 谓词。主循环、paragraph 收集、融合拆分三处共用,保证判定一致。
const isTablePairStart = (
  line: string | undefined,
  nextLine: string | undefined,
): boolean => {
  if (!line || !nextLine || !line.includes('|')) return false;
  const headerCells = splitTableRow(line);
  const sepCells = splitTableRow(nextLine);
  return (
    headerCells.length >= 1 &&
    sepCells.length === headerCells.length &&
    sepCells.every(cell => /^:?-+:?$/.test(cell))
  );
};

// 标题容错(2026-10-26 生产实证):GLM 系中文输出习惯写 `##标题`(# 后无空格),
// 严格 CommonMark 形态会把它落成 paragraph、井号原样显示——agentcore 会话
// 生产命中率 11%(claude 侧 0.9%,同族中文模型经 router 也有)。放宽为:
// # 串后面要么是「空白+内容」,要么直接跟**非 ASCII** 内容(审查定谳:ASCII
// 放行会误伤 #123 / #!/usr/bin/env node / #include / #tag 这些行首合法形态,
// 而生产样本的首字符全是 CJK/emoji);`#######`(越界 # 串)与空标题仍不算。
const lineStartsHeading = (line: string) => {
  const trimmed = line.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  const match = trimmed.match(/^#{1,6}(\S)/u);
  return Boolean(match && /\P{ASCII}/u.test(match[1]));
};

const lineStartsQuote = (line: string) => /^>\s?/.test(line.trim());

// 列表容错(2026-10-26 生产实证,agentcore 22% 命中):GLM 中文输出常写
// `-存档`(短横后无空格)。只放宽短横、且要求短横后首字符为**非 ASCII**
// (审查定谳:ASCII 放行会把未围栏 diff 删除行 `-const a = 1`、ls -l 权限串
// `-rw-r--r--`、`--flag`、`->` 箭头误判成列表并吞掉短横;生产样本首字符
// 全是 CJK)。`*`/`+` 保持要求空格(与 `*强调*` 歧义太大,不值得)。
const unorderedListMatch = (line: string) =>
  line.match(/^\s*[-*+]\s+(.+)$/) ?? line.match(/^\s*-(?=\P{ASCII})(.+)$/u);

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

    // 融合形态容错(2026-10-26 生产实证):GLM 会把表头直接接在标题文字后
    // (`##📦 核心项目| 项目 | 技术栈 |`)。首根竖线前是标题、竖线后恰是
    // 表头、下一行是匹配的分隔行 → 拆成 heading + table 两块,别整段落进
    // paragraph 原样显示。
    if (lineStartsHeading(line) && line.includes('|') && index + 1 < lines.length) {
      const pipeIndex = line.indexOf('|');
      const headingMatch = line.slice(0, pipeIndex).trim().match(/^(#{1,6})\s*(.+)$/);
      const headerPart = line.slice(pipeIndex);
      if (
        headingMatch &&
        isTablePairStart(headerPart, lines[index + 1])
      ) {
        blocks.push({
          kind: 'heading',
          level: headingMatch[1].length,
          children: parseInlineMarkdown(headingMatch[2], inlineTags),
        });
        const sepCells = splitTableRow(lines[index + 1]);
        const align = sepCells.map(cellAlign);
        const headers = splitTableRow(headerPart).map(cell =>
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
          rows.push(headers.map((_, i) => parseInlineMarkdown(rowCells[i] ?? '', inlineTags)));
          index += 1;
        }
        blocks.push({ kind: 'table', align, headers, rows });
        continue;
      }
    }

    if (isTablePairStart(line, lines[index + 1])) {
      const sepCells = splitTableRow(lines[index + 1]);
      const align = sepCells.map(cellAlign);
      const headers = splitTableRow(line).map(cell =>
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

    if (lineStartsHeading(line)) {
      const match = trimmed.match(/^(#{1,6})\s*(.+)$/);
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
      !lineStartsBlock(lines[index]) &&
      // 表格紧贴散文(2026-10-26 生产实证):GLM 写表格常不与上一行空行分隔,
      // 不在这里中断的话,表头/分隔行/数据行会被整段吞进 paragraph,竖线
      // 原样显示,表格分支(见上)永远轮不到。识别「本行像表头且下一行是
      // 分隔行」即收笔,把扫描器停在表头行交还给主循环。
      !isTablePairStart(lines[index], lines[index + 1])
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
  const content = replaceAliangOptionsFences(formatHarnessEnvelopes(rawContent))
    .replace(ansiRegex, '')
    .replace(/\r\n/g, '\n');
  const codeRanges = collectMarkdownCodeRanges(content);
  const tokens: AgentMarkupToken[] = [];
  const tagRegex = /<([a-zA-Z][\w:-]*)(?:\s([^>]*))?>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content))) {
    const [openingTag, rawTag, attrText] = match;
    const config = tagConfig(rawTag);
    if (!config || isInsideRange(match.index, codeRanges)) continue;

    // 开标签 attr(<approval-request multi>):标记 attr 存进 token 随行,
    // 供 createCalloutSegment 派生布尔段字段;标签正文仍是纯内容。
    const attrs: Record<string, string> = {};
    if (attrText) {
      const attrRegex = /([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s"'>]+))?/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(attrText))) {
        attrs[attrMatch[1].toLowerCase()] =
          attrMatch[3] ?? attrMatch[4] ?? attrMatch[2] ?? '';
      }
    }

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
      attrs,
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
  attrs?: Readonly<Record<string, string>>,
): TranscriptCalloutSegment | null => {
  // task 卡：正文 = headline（summary 一句话），status/output-file/result 从
  // 机器字段标签拆进 meta——它们不该再出现在人读文本里。
  let displayBody = body;
  let meta: TranscriptTaskMeta | undefined;
  // approval 卡：v2 结构化选项卡从 <card-json> 子标签拆进 optionCard
  // （机读旁路；正文 markdown 圆点保留作 v1 降级）。坏 JSON/半截流式静默
  // 走 v1 降级——子标签行无论如何都要从正文剥掉，不能把 JSON 晒给用户。
  let optionCard: TranscriptOptionCard | undefined;
  if ((config.variant ?? 'generic') === 'approval') {
    const cardMatch = /<card-json>\s*([\s\S]*?)\s*<\/card-json>/i.exec(body);
    if (cardMatch) {
      displayBody = displayBody.replace(
        /<card-json>[\s\S]*?<\/card-json>/gi,
        '',
      );
      try {
        const parsed = JSON.parse(cardMatch[1]) as TranscriptOptionCard;
        if (
          parsed &&
          typeof parsed.title === 'string' &&
          Array.isArray(parsed.options) &&
          parsed.options.length > 0
        ) {
          optionCard = parsed;
        }
      } catch {
        // 半截流式/坏 JSON：留 v1 markdown 降级
      }
    }
  }
  if ((config.variant ?? 'generic') === 'task') {
    const status = harnessField(body, 'task-status');
    const outputFile = harnessField(body, 'task-output-file');
    const result = harnessField(body, 'task-result');
    if (status || outputFile || result) {
      meta = {
        status: status || undefined,
        outputFile: outputFile || undefined,
        result: result || undefined,
      };
      displayBody = body
        .replace(/<task-status>[\s\S]*?<\/task-status>/gi, '')
        .replace(/<task-output-file>[\s\S]*?<\/task-output-file>/gi, '')
        .replace(/<task-result>[\s\S]*?<\/task-result>/gi, '');
    }
  }
  const content = cleanText(displayBody);
  if (!content && !meta) return null;
  return {
    id: `${messageId}:callout:${index}:${tag}`,
    kind: 'callout',
    variant: config.variant ?? 'generic',
    multi: attrs?.multi != null ? true : undefined,
    optionCard,
    meta,
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
            token.attrs,
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

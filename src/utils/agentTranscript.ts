import type { AgentMessage } from '../data/platformModels';
import {
  parseMessageContentSegments,
  type TranscriptCalloutSegment,
  type TranscriptFoldedSegment,
  type TranscriptGoalReportSegment,
  type TranscriptMarkdownBlock,
  type TranscriptMarkdownInline,
  type TranscriptSegment,
  type TranscriptTextSegment,
} from './messageRendering';

export type TranscriptDisplayRole = 'user' | 'assistant' | 'system';
export type {
  TranscriptCalloutSegment,
  TranscriptFoldedSegment,
  TranscriptGoalReportSegment,
  TranscriptMarkdownBlock,
  TranscriptMarkdownInline,
  TranscriptSegment,
  TranscriptTextSegment,
};

export interface DisplayTranscriptMessage {
  id: string;
  role: TranscriptDisplayRole;
  timestamp: string;
  endTimestamp?: string;
  mergedCount: number;
  segments: TranscriptSegment[];
  /**
   * Concatenated raw `.content` of the underlying {@link AgentMessage}s this
   * bubble spans. NOT for display — a cheap, stable change signal so
   * {@link TranscriptMessageList}'s `React.memo` can skip re-rendering bubbles
   * whose source content hasn't changed. During streaming the store only grows
   * the trailing assistant message's content, so only that one bubble's
   * contentKey changes per flush; every historical bubble keeps an identical
   * contentKey and is skipped. Extended by `appendSegments` on each merge.
   */
  contentKey?: string;
  /**
   * Client-only retry flag carried over from a failed-to-send user message
   * (see {@link AgentMessage.failed}). Only ever set on user bubbles; the render
   * site shows a retry / dismiss affordance when truthy.
   */
  failed?: boolean;
  /**
   * Underlying {@link AgentMessage.id}s this (possibly coalesced) display bubble
   * spans. Seeded with the first message's id and extended by `appendSegments`
   * on each merge. The render site uses this to attach the matching
   * `StructuredActivityEvent` group (filtered by `messageId`) under the bubble.
   * Note: tool-only turns whose prose parses to zero segments are still dropped
   * by `buildDisplayTranscript` (it has no event context) — the render site
   * appends a synthetic activity bubble for those orphan message ids.
   */
  sourceMessageIds: string[];
  /**
   * 该用户气泡携带的素材（照片 / 手绘 / ASCII）。只挂在自己的消息上——
   * 服务端确认后同一字段原样回传，乐观气泡与历史消息走同一条渲染路径。
   */
  attachments?: AgentMessage['attachments'];
}

// Markdown parsing (parseMessageContentSegments) is by far the most expensive
// step in buildDisplayTranscript. During streaming the store replaces only the
// trailing assistant message with a fresh object each flush and leaves every
// other AgentMessage referentially stable (see applyDeltasToRun in deltaBatch),
// so a WeakMap keyed on the message object turns the per-flush parse into
// O(changed) instead of O(total messages). Cache validity rides on object
// identity: when a message's content changes the store hands back a different
// object, so a stale entry can never be served. Snapshots (mergeAgentMessages)
// rebuild every message object and thus miss the cache once — fine, they're
// infrequent, not per-token.
const segmentCache = new WeakMap<AgentMessage, TranscriptSegment[]>();

// role='system' 的一行式工具状态噪音：旧版 agent 历史解析把 tool_result 摊平成
// system 消息的残留物（"Updated task #N status"/"[1]+ Done …"/"patched" 等）。
// 新版 server（入库拦截 + 开机清理）与 agent（reader 不再摊平）已从源头拦住，
// 这里对仍留在内存热窗 / 旧服务端数据里的残余做显示层兜底。只匹配原始 content
// 开头且仅限 system 角色——assistant 正文说 "patched" 不受影响。
const SYSTEM_TOOL_STATUS_NOISE =
  /^(updated task #\d+ status\b|patched\b|typecheck_exit=\d+|build_exit=\d+|\[\d\]\+\s+done\b|<retrieval_status>|command running in background with id:)/i;

const isSystemToolStatusNoise = (message: AgentMessage): boolean =>
  message.role === 'system' &&
  SYSTEM_TOOL_STATUS_NOISE.test((message.content ?? '').replace(/^\s+/, ''));

// harness 信封：Claude Code 把后台任务通知、/命令执行记录、系统提醒等以 XML
// 信封形态注入 user 消息流（生产 ai_messages 实证：task-notification 71 条、
// 命令簇 86 条，全是 user 角色）。纯信封消息不是用户说的话——显示层重分类为
// system，吃现成的灰条折叠 UI，不占用用户气泡。混合（散文+信封）保持 user。
// 裸字段簇（task-id/tool-use-id/…/result，CC 后台任务通知的无包裹形态）与
// 渲染层 formatTaskNotificationBody 派生的 task-* 嵌套标签也在列：纯裸字段
// 消息同样不是用户话语。
const HARNESS_ENVELOPE_TAG =
  'task-notification|task-id|tool-use-id|output-file|status|summary|note|result|task-status|task-output-file|task-result|system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|local-command-status|command-message|command-name|command-args|command-contents|command-output|command-stdout|command-stderr|command-status|skill-format';
const HARNESS_ENVELOPE_RE = new RegExp(
  `<(?:${HARNESS_ENVELOPE_TAG})>[\\s\\S]*?</(?:${HARNESS_ENVELOPE_TAG})>`,
  'gi',
);

const isPureHarnessEnvelope = (content: string): boolean => {
  if (!content.includes('<')) return false;
  return content.replace(HARNESS_ENVELOPE_RE, '').trim() === '';
};

// CC 技能注入：Skill 工具把 skill 全文以 user 消息注入，开头是
// "Base directory for this skill: <路径>" 的纯散文——没有 XML 信封，
// isPureHarnessEnvelope 的 '<' 快速门挡不住（生产 ai_import 会话实证：
// 4000 字符里 0 个 '<'）。要求短语后跟含 '/' 的路径 token：用户引用/
// 追问这个短语本身（无路径）不算注入。
const CC_SKILL_INJECTION_RE = /^base directory for this skill:\s+\S*\/\S*/i;

// 截断信封：transcript 内容按 4000 rune 截断会切掉闭合标签，
// isPureHarnessEnvelope 的整信封匹配兜不住。行首前缀兜底（与 server 端
// CC_META_CONTENT_PREFIXES 同源；只碰行首，正文"提及"标签不受影响）。
const CC_META_UNCLOSED_PREFIX_RE =
  /^<(?:command-name|command-message|local-command-caveat|local-command-stdout|system-reminder|task-id|task-notification)>/;

/**
 * CC 写进 user 流、但不是用户话语的 meta 内容（纯信封 / 截断信封 / 技能注入
 * 散文）。buildDisplayTranscript 用它把这类行重分类为 system；会话卡"最新
 * 提问"预览（lastUserMessageOf）用它跳过冒充用户的注入行。
 */
export const isClaudeCodeMetaUserContent = (content: string): boolean => {
  const trimmed = (content ?? '').trimStart();
  return (
    isPureHarnessEnvelope(trimmed) ||
    CC_SKILL_INJECTION_RE.test(trimmed) ||
    CC_META_UNCLOSED_PREFIX_RE.test(trimmed)
  );
};

export const parseTranscriptSegments = (
  message: AgentMessage,
): TranscriptSegment[] => {
  const cached = segmentCache.get(message);
  if (cached) return cached;
  const segments = parseMessageContentSegments(message.id, message.content);
  segmentCache.set(message, segments);
  return segments;
};

const uniqueId = (id: string, used: Set<string>) => {
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  let suffix = 2;
  let next = `${id}:dup:${suffix}`;
  while (used.has(next)) {
    suffix += 1;
    next = `${id}:dup:${suffix}`;
  }
  used.add(next);
  return next;
};

const uniquifySegments = (
  segments: TranscriptSegment[],
  usedIds: Set<string>,
): TranscriptSegment[] =>
  segments.map(segment => {
    const id = uniqueId(segment.id, usedIds);
    return id === segment.id ? segment : { ...segment, id };
  });

const appendSegments = (
  target: DisplayTranscriptMessage,
  message: AgentMessage,
  segments: TranscriptSegment[],
) => {
  target.segments.push(...segments);
  target.endTimestamp = message.timestamp;
  target.mergedCount += 1;
  target.sourceMessageIds.push(message.id);
  target.contentKey = `${target.contentKey ?? ''}${message.content ?? ''}`;
};

// —— 流式尾窗(吐字卡死修复,2026-10-29)——
// 流式期间 store 每 100ms flush 换一次尾消息对象 → segmentCache(WeakMap 按
// 对象身份)必然 miss → 每 200ms 对整段增长后的全文重 parse + 整棵 markdown
// 树重渲染,成本随消息长度无界;服务端积压排空时一次突进几十 KB 更是把 JS
// 线程打满(吐字过程"卡死")。会话活跃时把尾气泡的解析钉死到末尾窗口:
// 成本 O(window) 恒定,settle 后(useConversationTranscript 关掉尾窗)全量换回。
export const LIVE_TAIL_ENGAGE_CHARS = 6000;
export const LIVE_TAIL_WINDOW_CHARS = 12000;
// 尾窗条目的 contentKey 哨兵前缀:气泡 React.memo 比较器只认 contentKey 变化,
// 不打哨兵的话 settle 全量解析(contentKey 回到原文)会被判等拦下,
// 气泡永远停在尾窗。
export const STREAMING_TAIL_CONTENTKEY_PREFIX = '\u0000tail-window\u0000';
const STREAMING_TAIL_MARKER = '*……前文已折叠(流式中)*';

/**
 * 会话活跃期间,把末尾 assistant 气泡的解析收敛到内容末尾
 * {@link LIVE_TAIL_WINDOW_CHARS} 字符窗口(非 assistant 尾条、内容不足、或
 * 窗口起点落在段首——即折叠只会丢内容的情形——原引用返回,零开销)。
 *
 * 返回新数组:被替换的只有尾条目,历史条目引用原样保留;尾条目的
 * id/sourceMessageIds/timestamp 不变(scrubber/活动事件挂载不受影响),
 * 仅 segments 换成尾窗解析结果、contentKey 打上
 * {@link STREAMING_TAIL_CONTENTKEY_PREFIX} 哨兵。
 */
export const applyStreamingTailWindow = (
  transcript: DisplayTranscriptMessage[],
  windowChars: number = LIVE_TAIL_WINDOW_CHARS,
  engageChars: number = LIVE_TAIL_ENGAGE_CHARS,
): DisplayTranscriptMessage[] => {
  const index = transcript.length - 1;
  const last = transcript[index];
  if (!last || last.role !== 'assistant') return transcript;
  const content = last.contentKey ?? '';
  // 实际生效阈值 ≈ window:窗口起点为 0 时折叠只会丢开头,不值得。
  if (content.length <= engageChars) return transcript;
  const windowStart = content.length - windowChars;
  if (windowStart <= 0) return transcript;

  // 切点:从窗口起点向后找第一个段落边界('\n\n'),找不到(单一长代码块
  // 等无空行内容)才原地硬切。尾窗从完整段落开头开始,不切半个词。
  const boundary = content.indexOf('\n\n', windowStart);
  const tailBody =
    boundary === -1 ? content.slice(windowStart) : content.slice(boundary + 2);

  // 与前文段 id 去重:被替换条目自己的段除外(同名段让位加 :dup,防 React
  // key 撞——同消息双副本/折叠气泡持有同 id 段的场景)。
  const usedSegmentIds = new Set<string>();
  for (const entry of transcript.slice(0, index)) {
    for (const segment of entry.segments) usedSegmentIds.add(segment.id);
  }

  // 折叠提示独立解析(id 用 :tailmark 命名空间),与尾窗正文各自成段,
  // 互不合并、也不占用正文段 id。
  const segments = uniquifySegments(
    [
      ...parseMessageContentSegments(`${last.id}:tailmark`, STREAMING_TAIL_MARKER),
      ...parseMessageContentSegments(last.id, tailBody),
    ],
    usedSegmentIds,
  );

  const replaced: DisplayTranscriptMessage = {
    ...last,
    segments,
    contentKey: `${STREAMING_TAIL_CONTENTKEY_PREFIX}${content}`,
  };
  return [...transcript.slice(0, index), replaced];
};

export const buildDisplayTranscript = (
  messages: AgentMessage[],
): DisplayTranscriptMessage[] => {
  const result: DisplayTranscriptMessage[] = [];
  const usedDisplayIds = new Set<string>();
  const usedSegmentIds = new Set<string>();

  // Track the last message we actually rendered so we can drop a byte-identical
  // repeat of it. One logical message can be stored twice under different ids —
  // a live-streamed copy alongside a reconciled/snapshot copy whose id didn't
  // match the streamed one (see mergeReportedTranscript / buildReportedAiSession
  // `import_<sha1>` ids, or native upstream ids). Upstream dedup is id-only, so
  // such a pair survives into the transcript; without this guard the coalescing
  // below would merge them into a single bubble and the content would render
  // twice. Skipping an exact repeat is always safe: two consecutive same-role
  // messages with identical text are never meant to display as separate parts.
  let lastRole = '';
  let lastContent = '';
  // 素材 id 也要参与去重判定：同一句话配不同图片连发两次是合法操作，
  // 不能被「同文同角色」当成乐观/快照重复而吞掉第二条。
  let lastAttachmentsKey = '';

  for (const message of messages) {
    // 兜底丢弃必须发生在 lastRole/lastContent 去重状态更新与 segment 解析之前：
    // 被丢的行不占去重状态（否则中间夹一条噪音会误吞/漏判相邻重复）、不进
    // segmentCache（省掉整段 markdown 解析）。
    if (isSystemToolStatusNoise(message)) continue;
    const normalized = (message.content ?? '').trim();
    // 纯 harness 信封 / CC 技能注入（纯散文 meta）的 user 消息按 system 展示
    // （灰条折叠，不占用户气泡）。
    const role =
      message.role === 'user' && isClaudeCodeMetaUserContent(normalized)
        ? 'system'
        : message.role;
    const attachmentsKey = (message.attachments ?? [])
      .map(item => item.asset_id)
      .join(',');
    if (
      role === lastRole &&
      normalized !== '' &&
      normalized === lastContent &&
      attachmentsKey === lastAttachmentsKey
    ) {
      continue;
    }
    const segments = uniquifySegments(
      parseTranscriptSegments(message),
      usedSegmentIds,
    );
    if (!segments.length) continue;
    lastRole = role;
    lastContent = normalized;
    lastAttachmentsKey = attachmentsKey;

    const previous = result[result.length - 1];

    if (role === 'user') {
      // Each user prompt is its own bubble. A previous design coalesced
      // consecutive user messages into one ("repeated input bursts"), but that
      // merged two DISTINCT prompts — e.g. a prompt whose turn failed/errored
      // (no assistant reply) followed by the user's next prompt — into a single
      // "你好 在吗" bubble. Keeping them separate preserves the user's intent.
      // Byte-identical repeats (optimistic + snapshot double-store) are already
      // dropped by the `lastContent` dedup above.
      result.push({
        id: uniqueId(message.id, usedDisplayIds),
        role: 'user',
        timestamp: message.timestamp,
        mergedCount: 1,
        segments,
        contentKey: message.content ?? '',
        sourceMessageIds: [message.id],
        failed: message.failed ? true : undefined,
        attachments: message.attachments?.length ? message.attachments : undefined,
      });
      continue;
    }

    if (role === 'assistant') {
      // Each assistant segment is its own bubble. An earlier design coalesced
      // consecutive assistant messages (appendSegments), but with per-turn
      // segment ids (one assistant message per provider turn) that merges
      // DISTINCT turns into one giant bubble — rounds become indistinguishable.
      // User messages are already kept separate for the same reason; assistant
      // turns now match. Byte-identical repeats (optimistic + snapshot double-
      // store) are dropped by the `lastContent` dedup above before reaching here.
      result.push({
        id: uniqueId(message.id, usedDisplayIds),
        role: 'assistant',
        timestamp: message.timestamp,
        mergedCount: 1,
        segments,
        contentKey: message.content ?? '',
        sourceMessageIds: [message.id],
      });
      continue;
    }

    if (previous?.role === 'system') {
      appendSegments(previous, message, segments);
    } else {
      result.push({
        id: uniqueId(message.id, usedDisplayIds),
        role: 'system',
        timestamp: message.timestamp,
        mergedCount: 1,
        segments,
        contentKey: message.content ?? '',
        sourceMessageIds: [message.id],
      });
    }
  }

  return result;
};

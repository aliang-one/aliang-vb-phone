import type { AgentMessage } from '../data/platformModels';
import {
  parseMessageContentSegments,
  type TranscriptCalloutSegment,
  type TranscriptFoldedSegment,
  type TranscriptMarkdownBlock,
  type TranscriptMarkdownInline,
  type TranscriptSegment,
  type TranscriptTextSegment,
} from './messageRendering';

export type TranscriptDisplayRole = 'user' | 'assistant' | 'system';
export type {
  TranscriptCalloutSegment,
  TranscriptFoldedSegment,
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

  for (const message of messages) {
    const role = message.role;
    const normalized = (message.content ?? '').trim();
    if (
      role === lastRole &&
      normalized !== '' &&
      normalized === lastContent
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
      });
      continue;
    }

    if (role === 'assistant') {
      if (previous?.role === 'assistant') {
        appendSegments(previous, message, segments);
      } else {
        result.push({
          id: uniqueId(message.id, usedDisplayIds),
          role: 'assistant',
          timestamp: message.timestamp,
          mergedCount: 1,
          segments,
          contentKey: message.content ?? '',
          sourceMessageIds: [message.id],
        });
      }
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

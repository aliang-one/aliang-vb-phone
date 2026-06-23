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

export const parseTranscriptSegments = (
  message: AgentMessage,
): TranscriptSegment[] => {
  return parseMessageContentSegments(message.id, message.content);
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
      if (previous?.role === 'user') {
        appendSegments(previous, message, segments);
      } else {
        result.push({
          id: uniqueId(message.id, usedDisplayIds),
          role: 'user',
          timestamp: message.timestamp,
          mergedCount: 1,
          segments,
          sourceMessageIds: [message.id],
        });
      }
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
        sourceMessageIds: [message.id],
      });
    }
  }

  return result;
};

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
}

export const parseTranscriptSegments = (
  message: AgentMessage,
): TranscriptSegment[] => {
  return parseMessageContentSegments(message.id, message.content);
};

const appendSegments = (
  target: DisplayTranscriptMessage,
  message: AgentMessage,
  segments: TranscriptSegment[],
) => {
  target.segments.push(...segments);
  target.endTimestamp = message.timestamp;
  target.mergedCount += 1;
};

export const buildDisplayTranscript = (
  messages: AgentMessage[],
): DisplayTranscriptMessage[] => {
  const result: DisplayTranscriptMessage[] = [];

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
    const segments = parseTranscriptSegments(message);
    if (!segments.length) continue;

    const role = message.role;
    const normalized = (message.content ?? '').trim();
    if (
      role === lastRole &&
      normalized !== '' &&
      normalized === lastContent
    ) {
      continue;
    }
    lastRole = role;
    lastContent = normalized;

    const previous = result[result.length - 1];

    if (role === 'user') {
      if (previous?.role === 'user') {
        appendSegments(previous, message, segments);
      } else {
        result.push({
          id: message.id,
          role: 'user',
          timestamp: message.timestamp,
          mergedCount: 1,
          segments,
        });
      }
      continue;
    }

    if (role === 'assistant') {
      if (previous?.role === 'assistant') {
        appendSegments(previous, message, segments);
      } else if (previous?.role === 'system') {
        previous.role = 'assistant';
        appendSegments(previous, message, segments);
      } else {
        result.push({
          id: message.id,
          role: 'assistant',
          timestamp: message.timestamp,
          mergedCount: 1,
          segments,
        });
      }
      continue;
    }

    if (previous?.role === 'assistant' || previous?.role === 'system') {
      appendSegments(previous, message, segments);
    } else {
      result.push({
        id: message.id,
        role: 'system',
        timestamp: message.timestamp,
        mergedCount: 1,
        segments,
      });
    }
  }

  return result;
};

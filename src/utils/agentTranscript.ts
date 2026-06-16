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

  for (const message of messages) {
    const segments = parseTranscriptSegments(message);
    if (!segments.length) continue;

    const previous = result[result.length - 1];
    const role = message.role;

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

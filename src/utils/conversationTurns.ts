import type { DisplayTranscriptMessage } from './agentTranscript';
import { summarizeMessage } from './conversationScrubber';

export interface ConversationTurn {
  id: string;
  role: DisplayTranscriptMessage['role'];
  timestamp: string;
  endTimestamp?: string;
  messages: DisplayTranscriptMessage[];
  messageIds: string[];
  sourceMessageIds: string[];
  preview: string;
}

const turnId = (message: DisplayTranscriptMessage) => `turn:${message.id}`;

const appendToTurn = (
  turn: Omit<ConversationTurn, 'preview'>,
  message: DisplayTranscriptMessage,
) => {
  turn.messages.push(message);
  turn.messageIds.push(message.id);
  turn.sourceMessageIds.push(...message.sourceMessageIds);
  turn.endTimestamp = message.endTimestamp ?? message.timestamp;
};

const finalizeTurn = (
  turn: Omit<ConversationTurn, 'preview'>,
): ConversationTurn => {
  const primary =
    turn.messages.find(message => message.role === 'user') ??
    turn.messages.find(message => message.role === 'assistant') ??
    turn.messages[0];
  const preview = primary ? summarizeMessage(primary) : '';
  return {
    ...turn,
    sourceMessageIds: Array.from(new Set(turn.sourceMessageIds)),
    preview,
  };
};

export const buildConversationTurns = (
  messages: DisplayTranscriptMessage[],
): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  let current: Omit<ConversationTurn, 'preview'> | undefined;

  const flush = () => {
    if (!current) return;
    turns.push(finalizeTurn(current));
    current = undefined;
  };

  for (const message of messages) {
    if (message.role === 'user') {
      flush();
      current = {
        id: turnId(message),
        role: 'user',
        timestamp: message.timestamp,
        endTimestamp: message.endTimestamp,
        messages: [message],
        messageIds: [message.id],
        sourceMessageIds: [...message.sourceMessageIds],
      };
      continue;
    }

    if (!current) {
      current = {
        id: turnId(message),
        role: message.role,
        timestamp: message.timestamp,
        endTimestamp: message.endTimestamp,
        messages: [message],
        messageIds: [message.id],
        sourceMessageIds: [...message.sourceMessageIds],
      };
      continue;
    }

    appendToTurn(current, message);
  }

  flush();
  return turns;
};

export const findTurnIdForMessageId = (
  turns: ConversationTurn[],
  messageId: string | undefined,
) => {
  if (!messageId) return undefined;
  return turns.find(turn => turn.messageIds.includes(messageId))?.id;
};

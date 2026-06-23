import { buildDisplayTranscript } from '../src/utils/agentTranscript';
import {
  buildConversationTurns,
  findTurnIdForMessageId,
} from '../src/utils/conversationTurns';
import type { AgentMessage } from '../src/data/platformModels';

const message = (
  id: string,
  role: AgentMessage['role'],
  content: string,
): AgentMessage => ({
  id,
  role,
  content,
  timestamp: `10:0${id}`,
});

describe('conversationTurns', () => {
  it('groups one user prompt with assistant prose and system tool output', () => {
    const transcript = buildDisplayTranscript([
      message('1', 'user', 'Merge upstream main.'),
      message('2', 'assistant', 'I will inspect the repo.'),
      message('3', 'system', '<tool_use>git status</tool_use>'),
      message('4', 'system', '<tool_result>clean</tool_result>'),
      message('5', 'assistant', 'Merge completed.'),
    ]);

    const turns = buildConversationTurns(transcript);

    expect(turns).toHaveLength(1);
    expect(turns[0].messages.map(item => item.role)).toEqual([
      'user',
      'assistant',
      'system',
      'assistant',
    ]);
    expect(turns[0].preview).toBe('Merge upstream main.');
    expect(turns[0].sourceMessageIds).toEqual(['1', '2', '3', '4', '5']);
  });

  it('starts a new turn at each user message', () => {
    const transcript = buildDisplayTranscript([
      message('1', 'user', 'First prompt'),
      message('2', 'assistant', 'First answer'),
      message('3', 'user', 'Second prompt'),
      message('4', 'system', '<tool_result>ok</tool_result>'),
      message('5', 'assistant', 'Second answer'),
    ]);

    const turns = buildConversationTurns(transcript);

    expect(turns).toHaveLength(2);
    expect(turns.map(turn => turn.preview)).toEqual([
      'First prompt',
      'Second prompt',
    ]);
    expect(turns[0].messages.map(item => item.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(turns[1].messages.map(item => item.role)).toEqual([
      'user',
      'system',
      'assistant',
    ]);
  });

  it('supports assistant-only imported history', () => {
    const transcript = buildDisplayTranscript([
      message('1', 'assistant', 'Imported answer'),
      message('2', 'system', '<tool_result>ok</tool_result>'),
    ]);

    const turns = buildConversationTurns(transcript);

    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('assistant');
    expect(turns[0].preview).toBe('Imported answer');
  });

  it('finds the turn that owns a display message id', () => {
    const transcript = buildDisplayTranscript([
      message('1', 'user', 'Prompt'),
      message('2', 'assistant', 'Answer'),
      message('3', 'system', '<tool_result>ok</tool_result>'),
    ]);
    const turns = buildConversationTurns(transcript);

    expect(findTurnIdForMessageId(turns, transcript[2].id)).toBe(turns[0].id);
    expect(findTurnIdForMessageId(turns, 'missing')).toBeUndefined();
  });
});

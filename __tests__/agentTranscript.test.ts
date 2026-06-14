import {
  buildDisplayTranscript,
  parseTranscriptSegments,
} from '../src/utils/agentTranscript';
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

describe('agentTranscript', () => {
  it('folds Claude and Codex special tags away from visible text', () => {
    const segments = parseTranscriptSegments(
      message(
        '1',
        'assistant',
        'Visible answer\n<thinking>private reasoning</thinking>\n<local-command-stdout>line1\nline2</local-command-stdout>',
      ),
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      kind: 'text',
      content: 'Visible answer',
    });
    expect(segments[1]).toMatchObject({
      kind: 'folded',
      label: 'Thinking · 17 chars',
    });
    expect(segments[2]).toMatchObject({
      kind: 'folded',
      label: 'Command stdout · 2 lines',
    });
  });

  it('merges consecutive assistant and tool messages into one answer', () => {
    const display = buildDisplayTranscript([
      message('1', 'user', 'Fix the project.'),
      message('2', 'assistant', 'I will inspect it.'),
      message('3', 'system', '<tool_result>{"ok":true}</tool_result>'),
      message('4', 'assistant', 'The fix is ready.'),
    ]);

    expect(display).toHaveLength(2);
    expect(display[1].role).toBe('assistant');
    expect(display[1].mergedCount).toBe(3);
    expect(display[1].segments.map(segment => segment.kind)).toEqual([
      'text',
      'folded',
      'text',
    ]);
  });

  it('keeps consecutive user prompts together for repeated input bursts', () => {
    const display = buildDisplayTranscript([
      message('1', 'user', 'First line'),
      message('2', 'user', 'Second line'),
      message('3', 'assistant', 'Combined reply'),
    ]);

    expect(display).toHaveLength(2);
    expect(display[0].role).toBe('user');
    expect(display[0].mergedCount).toBe(2);
  });
});

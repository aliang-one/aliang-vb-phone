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

  it('folds fenced code blocks while keeping surrounding assistant text visible', () => {
    const segments = parseTranscriptSegments(
      message(
        '5',
        'assistant',
        'Here is the patch:\n```ts\nconst answer = 42;\nexport default answer;\n```\nDone.',
      ),
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'text',
      content:
        'Here is the patch:\n```ts\nconst answer = 42;\nexport default answer;\n```\nDone.',
    });
    if (segments[0].kind !== 'text') throw new Error('Expected text segment');
    expect(segments[0].blocks).toMatchObject([
      { kind: 'paragraph' },
      {
        kind: 'code',
        language: 'ts',
        content: 'const answer = 42;\nexport default answer;',
      },
      { kind: 'paragraph' },
    ]);
  });

  it('renders command tags as structured inline text and callouts', () => {
    const segments = parseTranscriptSegments(
      message(
        '6',
        'assistant',
        'Run <command-name>npm test</command-name> <command-args>--watch</command-args> now.\n<command-message>**Checking** the app.</command-message>\n<local-command-caveat>Requires a local shell.</local-command-caveat>',
      ),
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      kind: 'text',
      content: 'Run npm test --watch now.',
    });
    if (segments[0].kind !== 'text') throw new Error('Expected text segment');
    expect(segments[0].blocks[0]).toMatchObject({
      kind: 'paragraph',
      children: [
        { kind: 'text', content: 'Run ' },
        { kind: 'commandName', content: 'npm test' },
        { kind: 'text', content: ' ' },
        { kind: 'commandArgs', content: '--watch' },
        { kind: 'text', content: ' now.' },
      ],
    });
    expect(segments[1]).toMatchObject({
      kind: 'callout',
      title: 'Command message',
      tone: 'info',
    });
    expect(segments[2]).toMatchObject({
      kind: 'callout',
      title: 'Command caveat',
      tone: 'warning',
    });
  });

  it('parses common markdown without treating code tags as agent markup', () => {
    const segments = parseTranscriptSegments(
      message(
        '7',
        'assistant',
        '## Result\n- **Done** with `npm test`\n- [Open docs](https://example.com)\n\n```md\n<command-name>literal</command-name>\n```',
      ),
    );

    expect(segments).toHaveLength(1);
    if (segments[0].kind !== 'text') throw new Error('Expected text segment');
    expect(segments[0].blocks).toMatchObject([
      { kind: 'heading', level: 2 },
      {
        kind: 'list',
        ordered: false,
        items: [
          [
            { kind: 'strong', children: [{ kind: 'text', content: 'Done' }] },
            { kind: 'text', content: ' with ' },
            { kind: 'inlineCode', content: 'npm test' },
          ],
          [
            {
              kind: 'link',
              url: 'https://example.com',
              children: [{ kind: 'text', content: 'Open docs' }],
            },
          ],
        ],
      },
      {
        kind: 'code',
        language: 'md',
        content: '<command-name>literal</command-name>',
      },
    ]);
  });

  it('leaves unknown tags visible as normal markdown text', () => {
    const segments = parseTranscriptSegments(
      message('8', 'assistant', 'Keep <unknown-tag>visible</unknown-tag>.'),
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'text',
      content: 'Keep <unknown-tag>visible</unknown-tag>.',
    });
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

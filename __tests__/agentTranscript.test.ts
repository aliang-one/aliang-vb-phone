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

  it('keeps system tool output separate from assistant prose', () => {
    const display = buildDisplayTranscript([
      message('1', 'user', 'Fix the project.'),
      message('2', 'assistant', 'I will inspect it.'),
      message('3', 'system', '<tool_result>{"ok":true}</tool_result>'),
      message('4', 'assistant', 'The fix is ready.'),
    ]);

    expect(display).toHaveLength(4);
    expect(display[1].role).toBe('assistant');
    expect(display[1].mergedCount).toBe(1);
    expect(display[2].role).toBe('system');
    expect(display[2].segments.map(segment => segment.kind)).toEqual(['folded']);
    expect(display[3].role).toBe('assistant');
    expect(display[3].mergedCount).toBe(1);
  });

  it('still merges consecutive system messages into one lightweight log group', () => {
    const display = buildDisplayTranscript([
      message('1', 'assistant', 'Checking now.'),
      message('2', 'system', '<tool_use>npm test</tool_use>'),
      message('3', 'system', '<tool_result>ok</tool_result>'),
    ]);

    expect(display).toHaveLength(2);
    expect(display[1].role).toBe('system');
    expect(display[1].mergedCount).toBe(2);
    expect(display[1].sourceMessageIds).toEqual(['2', '3']);
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

  it('auto-folds long fenced code blocks inside markdown text', () => {
    const longCode = Array.from({ length: 18 }, (_, index) => `line_${index}();`).join('\n');
    const segments = parseTranscriptSegments(
      message(
        '5b',
        'assistant',
        `Here is the generated file:\n\`\`\`js\n${longCode}\n\`\`\`\nDone.`,
      ),
    );

    expect(segments).toHaveLength(1);
    if (segments[0].kind !== 'text') throw new Error('Expected text segment');
    expect(segments[0].blocks).toMatchObject([
      { kind: 'paragraph' },
      {
        kind: 'folded',
        label: 'JS code · 18 lines',
        tone: 'info',
      },
      { kind: 'paragraph' },
    ]);
  });

  it('auto-folds verbose Playwright report sections', () => {
    const segments = parseTranscriptSegments(
      message(
        '5c',
        'system',
        [
          '### Ran Playwright code',
          '```js',
          "await page.getByRole('button', { name: 'Terminal' }).click();",
          '```',
          '### Page',
          '- Page URL: http://localhost:5179/pod',
          '- Page Title: AliangBoard',
          '- Console: 0 errors, 5 warnings',
          '### Result',
          '[WARNING] [Vue warn]: Component inside <Transition> renders non-element root node.',
          '  at <PodDetail>',
          '[WARNING] [Vue warn]: Component inside <Transition> renders non-element root node.',
          '  at <PodDetail>',
        ].join('\n'),
      ),
    );

    expect(segments).toHaveLength(1);
    if (segments[0].kind !== 'text') throw new Error('Expected text segment');
    expect(segments[0].blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'folded',
          label: expect.stringContaining('Ran Playwright code'),
          tone: 'info',
        }),
        expect.objectContaining({
          kind: 'folded',
          label: expect.stringContaining('Result'),
          tone: 'info',
        }),
      ]),
    );
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

  it('renders aliang approval option fences as approval callouts', () => {
    const segments = parseTranscriptSegments(
      message(
        '7',
        'assistant',
        'I need a choice.\n```aliang-options\n{"title":"Choose next step","description":"Pick one path.","options":[{"id":"fix","label":"Fix bug","description":"Patch the missing action"},{"id":"docs","label":"Write docs"}]}\n```',
      ),
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      kind: 'text',
      content: 'I need a choice.',
    });
    expect(segments[1]).toMatchObject({
      kind: 'callout',
      title: 'Approval request',
      tone: 'warning',
      content: expect.stringContaining('Choose next step'),
    });
    expect(segments[1]).toMatchObject({
      content: expect.stringContaining('- Fix bug: Patch the missing action'),
    });
    expect(segments[1].kind).toBe('callout');
    expect(
      segments[1].kind === 'callout' ? segments[1].content : '',
    ).not.toContain('"options"');
  });

  it('parses common markdown without treating code tags as agent markup', () => {
    const segments = parseTranscriptSegments(
      message(
        '8',
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
          {
            depth: 0,
            children: [
              { kind: 'strong', children: [{ kind: 'text', content: 'Done' }] },
              { kind: 'text', content: ' with ' },
              { kind: 'inlineCode', content: 'npm test' },
            ],
          },
          {
            depth: 0,
            children: [
              {
                kind: 'link',
                url: 'https://example.com',
                children: [{ kind: 'text', content: 'Open docs' }],
              },
            ],
          },
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
      message('9', 'assistant', 'Keep <unknown-tag>visible</unknown-tag>.'),
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'text',
      content: 'Keep <unknown-tag>visible</unknown-tag>.',
    });
  });

  // A user prompt that produced no assistant reply (a failed/errored turn, or a
  // tool-only turn whose empty prose was dropped) leaves the NEXT user prompt
  // adjacent to it. Coalescing them would merge two distinct messages into one
  // bubble ("你好 在吗") — the user's new prompt must stay its own bubble.
  it('keeps distinct consecutive user prompts as separate bubbles', () => {
    const display = buildDisplayTranscript([
      message('1', 'user', '你好'),
      message('2', 'user', '在吗'),
      message('3', 'assistant', '回复'),
    ]);

    expect(display).toHaveLength(3);
    expect(display[0].role).toBe('user');
    expect(display[0].mergedCount).toBe(1);
    expect(display[0].sourceMessageIds).toEqual(['1']);
    expect(display[1].role).toBe('user');
    expect(display[1].mergedCount).toBe(1);
    expect(display[1].sourceMessageIds).toEqual(['2']);
  });

  it('still drops a byte-identical repeat of a user prompt (optimistic + snapshot double-store)', () => {
    const display = buildDisplayTranscript([
      message('1', 'user', 'Same prompt'),
      message('1b', 'user', 'Same prompt'),
      message('2', 'assistant', 'Reply'),
    ]);

    expect(display).toHaveLength(2);
    expect(display[0].role).toBe('user');
    expect(display[0].mergedCount).toBe(1);
  });

  it('propagates the failed flag onto a user display bubble', () => {
    const display = buildDisplayTranscript([
      { ...message('1', 'user', '你好'), failed: true },
      message('2', 'assistant', '回复'),
    ]);

    expect(display).toHaveLength(2);
    expect(display[0].role).toBe('user');
    expect(display[0].failed).toBe(true);
    expect(display[1].failed).toBeUndefined();
  });

  it('keeps display and segment keys unique when upstream repeats an id', () => {
    const display = buildDisplayTranscript([
      message('approval-1', 'system', 'Approval requested.'),
      message('approval-1', 'user', 'Approved.'),
      message('approval-1', 'assistant', 'Continuing.'),
    ]);

    expect(display.map(item => item.id)).toEqual([
      'approval-1',
      'approval-1:dup:2',
      'approval-1:dup:3',
    ]);
    const segmentIds = display.flatMap(item =>
      item.segments.map(segment => segment.id),
    );
    expect(new Set(segmentIds).size).toBe(segmentIds.length);
  });

  it('keeps each assistant segment as its own bubble (no coalescing)', () => {
    // Single bubble: one source id.
    const single = buildDisplayTranscript([
      message('a1', 'assistant', 'hello'),
    ]);
    expect(single).toHaveLength(1);
    expect(single[0].sourceMessageIds).toEqual(['a1']);

    // Consecutive assistant segments are NOT coalesced — each is its own
    // bubble. With per-turn segment ids (one assistant message per provider
    // turn), coalescing would fuse DISTINCT turns into one giant bubble and
    // make rounds indistinguishable. Byte-identical repeats are still deduped
    // upstream (lastContent guard).
    const separate = buildDisplayTranscript([
      message('a1', 'assistant', 'hello'),
      message('a2', 'assistant', 'world'),
    ]);
    expect(separate).toHaveLength(2);
    expect(separate[0].mergedCount).toBe(1);
    expect(separate[0].sourceMessageIds).toEqual(['a1']);
    expect(separate[1].mergedCount).toBe(1);
    expect(separate[1].sourceMessageIds).toEqual(['a2']);
  });

  it('drops tool-only (empty-prose) assistant turns so their ids are absent', () => {
    // No prose => no segments => skipped by buildDisplayTranscript. The render
    // site handles these orphan ids via a synthetic activity bubble; this util
    // stays pure and simply drops them.
    const display = buildDisplayTranscript([
      message('a1', 'assistant', '   '),
      message('a2', 'assistant', 'real answer'),
    ]);
    expect(display).toHaveLength(1);
    expect(display[0].sourceMessageIds).toEqual(['a2']);
  });
});

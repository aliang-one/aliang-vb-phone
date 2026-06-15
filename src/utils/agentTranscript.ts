import type { AgentMessage } from '../data/platformModels';

export type TranscriptDisplayRole = 'user' | 'assistant' | 'system';

export interface TranscriptTextSegment {
  id: string;
  kind: 'text';
  content: string;
}

export interface TranscriptFoldedSegment {
  id: string;
  kind: 'folded';
  label: string;
  content: string;
  tone: 'info' | 'warning' | 'neutral';
}

export type TranscriptSegment = TranscriptTextSegment | TranscriptFoldedSegment;

export interface DisplayTranscriptMessage {
  id: string;
  role: TranscriptDisplayRole;
  timestamp: string;
  endTimestamp?: string;
  mergedCount: number;
  segments: TranscriptSegment[];
}

const escapeControl = String.fromCharCode(27);
const csiControl = String.fromCharCode(155);
const ansiRegex = new RegExp(
  `(?:${escapeControl}|${csiControl})\\[[0-?]*[ -/]*[@-~]`,
  'g',
);

const specialTags: Record<
  string,
  { label: string; tone: TranscriptFoldedSegment['tone'] }
> = {
  think: { label: 'Thinking', tone: 'neutral' },
  thinking: { label: 'Thinking', tone: 'neutral' },
  analysis: { label: 'Reasoning', tone: 'neutral' },
  reasoning: { label: 'Reasoning', tone: 'neutral' },
  'system-reminder': { label: 'System note', tone: 'neutral' },
  system: { label: 'System note', tone: 'neutral' },
  developer: { label: 'Developer note', tone: 'neutral' },
  command: { label: 'Command', tone: 'info' },
  'local-command': { label: 'Local command', tone: 'info' },
  'local-command-stdout': { label: 'Command stdout', tone: 'info' },
  'local-command-stderr': { label: 'Command stderr', tone: 'warning' },
  'local-command-status': { label: 'Command status', tone: 'neutral' },
  stdout: { label: 'Stdout', tone: 'info' },
  stderr: { label: 'Stderr', tone: 'warning' },
  'bash-output': { label: 'Terminal output', tone: 'info' },
  code: { label: 'Code', tone: 'info' },
  'code-block': { label: 'Code', tone: 'info' },
  patch: { label: 'Patch', tone: 'info' },
  diff: { label: 'Diff', tone: 'info' },
  tool: { label: 'Tool event', tone: 'neutral' },
  'tool-use': { label: 'Tool call', tone: 'info' },
  tool_use: { label: 'Tool call', tone: 'info' },
  'tool-result': { label: 'Tool result', tone: 'neutral' },
  tool_result: { label: 'Tool result', tone: 'neutral' },
  function_call: { label: 'Function call', tone: 'info' },
  function_result: { label: 'Function result', tone: 'neutral' },
  codex_event: { label: 'Codex event', tone: 'neutral' },
  claude_event: { label: 'Claude event', tone: 'neutral' },
};

const normalizeTag = (value: string) =>
  value.trim().toLowerCase().replace(/_/g, '-');

const tagInfo = (tag: string) =>
  specialTags[tag] ?? specialTags[normalizeTag(tag)];

const cleanText = (value: string) =>
  value
    .replace(ansiRegex, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

const summarizeContent = (value: string) => {
  const lineCount = value ? value.split('\n').length : 0;
  if (!value) return 'empty';
  if (lineCount > 1) return `${lineCount} lines`;
  return `${value.length} chars`;
};

const textSegment = (messageId: string, index: number, content: string): TranscriptTextSegment | null => {
  const cleaned = cleanText(content);
  if (!cleaned) return null;
  return {
    id: `${messageId}:text:${index}`,
    kind: 'text',
    content: cleaned,
  };
};

const splitTextAndCodeSegments = (
  messageId: string,
  startIndex: number,
  content: string,
): { segments: TranscriptSegment[]; nextIndex: number } => {
  const segments: TranscriptSegment[] = [];
  const codeRegex = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let segmentIndex = startIndex;
  let match: RegExpExecArray | null;

  while ((match = codeRegex.exec(content))) {
    const before = textSegment(messageId, segmentIndex, content.slice(lastIndex, match.index));
    if (before) segments.push(before);
    segmentIndex += 1;

    const language = match[1]?.trim();
    const code = cleanText(match[2] ?? '');
    if (code) {
      segments.push({
        id: `${messageId}:folded:${segmentIndex}:code`,
        kind: 'folded',
        label: `${language ? `Code (${language})` : 'Code'} · ${summarizeContent(code)}`,
        content: code,
        tone: 'info',
      });
    }
    segmentIndex += 1;
    lastIndex = match.index + match[0].length;
  }

  const after = textSegment(messageId, segmentIndex, content.slice(lastIndex));
  if (after) segments.push(after);
  return { segments, nextIndex: segmentIndex + 1 };
};

const foldedSegment = (
  messageId: string,
  index: number,
  tag: string,
  content: string,
): TranscriptFoldedSegment | null => {
  const info = tagInfo(tag);
  const cleaned = cleanText(content);
  if (!info || !cleaned) return null;
  return {
    id: `${messageId}:folded:${index}:${normalizeTag(tag)}`,
    kind: 'folded',
    label: `${info.label} · ${summarizeContent(cleaned)}`,
    content: cleaned,
    tone: info.tone,
  };
};

export const parseTranscriptSegments = (message: AgentMessage): TranscriptSegment[] => {
  const content = message.content.replace(ansiRegex, '');
  const segments: TranscriptSegment[] = [];
  const tagRegex = /<([a-zA-Z][\w:-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let lastIndex = 0;
  let segmentIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content))) {
    const [fullMatch, tag, body] = match;
    const info = tagInfo(tag);

    if (!info) continue;

    const before = splitTextAndCodeSegments(message.id, segmentIndex, content.slice(lastIndex, match.index));
    segments.push(...before.segments);
    segmentIndex = before.nextIndex;

    const folded = foldedSegment(message.id, segmentIndex, tag, body);
    if (folded) segments.push(folded);
    segmentIndex += 1;
    lastIndex = match.index + fullMatch.length;
  }

  const trailing = content.slice(lastIndex);
  const unclosedTagMatch = trailing.match(/^([\s\S]*?)<([a-zA-Z][\w:-]*)(?:\s[^>]*)?>([\s\S]*)$/);

  if (unclosedTagMatch && tagInfo(unclosedTagMatch[2])) {
    const before = splitTextAndCodeSegments(message.id, segmentIndex, unclosedTagMatch[1]);
    segments.push(...before.segments);
    segmentIndex = before.nextIndex;
    const folded = foldedSegment(
      message.id,
      segmentIndex,
      unclosedTagMatch[2],
      unclosedTagMatch[3],
    );
    if (folded) segments.push(folded);
  } else {
    const after = splitTextAndCodeSegments(message.id, segmentIndex, trailing);
    segments.push(...after.segments);
  }

  return segments;
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

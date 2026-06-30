import type { DisplayTranscriptMessage } from './agentTranscript';
import type { ConversationTurn } from './conversationTurns';
import type {
  TranscriptMarkdownBlock,
  TranscriptMarkdownInline,
} from './messageRendering';

/**
 * A single navigable position on the conversation scrubber. Stops are derived
 * from the transcript (user turns by default) and carry a short plain-text
 * preview so the scrubber can show "what's here" without mounting the message.
 */
export interface ScrubberStop {
  id: string;
  role: DisplayTranscriptMessage['role'];
  timestamp: string;
  preview: string;
}

const inlineToText = (node: TranscriptMarkdownInline): string => {
  // Leaf nodes carry their own content.
  if (
    node.kind === 'text' ||
    node.kind === 'inlineCode' ||
    node.kind === 'commandName' ||
    node.kind === 'commandArgs'
  ) {
    return node.content;
  }
  // Images carry alt text (no children, no content) — must be handled before
  // the container branch below or node.children is undefined.
  if (node.kind === 'image') {
    return node.alt;
  }
  // Container nodes recurse into children (links drop their URL on purpose —
  // the visible anchor text is what the reader saw).
  return node.children.map(inlineToText).join('');
};

const blockToText = (block: TranscriptMarkdownBlock): string => {
  if (block.kind === 'paragraph' || block.kind === 'heading' || block.kind === 'quote') {
    return block.children.map(inlineToText).join('');
  }
  if (block.kind === 'list') {
    return block.items.map(item => item.children.map(inlineToText).join('')).join(', ');
  }
  if (block.kind === 'table') {
    return block.headers.map(cells => cells.map(inlineToText).join('')).join(' | ');
  }
  if (block.kind === 'thematicBreak') {
    return '---';
  }
  // code block: keep the raw source — for a user prompt this is rare, for an
  // assistant reply it's often the most informative snippet.
  return block.content;
};

/**
 * Flatten a display message into a single plain-text line, suitable for a
 * scrubber / locator preview. Folded segments (thinking, command stdout) are
 * intentionally skipped — they were hidden in the bubble, so they stay hidden
 * here. Collapses whitespace and truncates with an ellipsis when too long.
 */
export const summarizeMessage = (
  message: DisplayTranscriptMessage,
  maxChars = 120,
): string => {
  const parts: string[] = [];

  for (const segment of message.segments) {
    if (segment.kind === 'text') {
      for (const block of segment.blocks) {
        parts.push(blockToText(block));
      }
    } else if (segment.kind === 'callout') {
      // A callout's title is its visible headline; its body is regular prose.
      parts.push(segment.title);
      for (const block of segment.blocks) {
        parts.push(blockToText(block));
      }
    }
    // 'folded' segments are skipped on purpose (see jsdoc).
  }

  const collapsed = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxChars).trimEnd()}…`;
};

/**
 * Build the list of navigable stops for the scrubber. Defaults to USER turns
 * (each prompt = one conversation position), falling back to every message
 * when the transcript has no user turns (e.g. an assistant-only history).
 */
export const deriveScrubberStops = (
  transcript: DisplayTranscriptMessage[],
): ScrubberStop[] => {
  const userTurns = transcript.filter(message => message.role === 'user');
  const source = userTurns.length > 0 ? userTurns : transcript;

  return source.map(message => ({
    id: message.id,
    role: message.role,
    timestamp: message.timestamp,
    preview: summarizeMessage(message),
  }));
};

export const deriveTurnScrubberStops = (
  turns: ConversationTurn[],
): ScrubberStop[] =>
  turns.map(turn => ({
    id: turn.id,
    role: turn.role,
    timestamp: turn.timestamp,
    preview: turn.preview,
  }));

/**
 * Map a normalized drag position ([0,1], bottom..top or top..bottom depending
 * on layout) to the nearest stop. Clamps out-of-range fractions and returns
 * undefined for an empty stop list.
 */
export const pickStopAtFraction = (
  stops: ScrubberStop[],
  fraction: number,
): ScrubberStop | undefined => {
  if (stops.length === 0) return undefined;
  const clamped = Math.min(1, Math.max(0, fraction));
  const index = Math.round(clamped * (stops.length - 1));
  return stops[index];
};

/**
 * A fisheye ("magnifier") size for one rail tick, given its distance from the
 * currently focused stop. The focused stop is full size; ticks within `radius`
 * taper linearly down to the base size; anything beyond is flat at base. This
 * is what makes the rail visibly "bulge" under the finger — the loupe look —
 * without enlarging the whole rail (so long conversations never grow it tall).
 */
export interface TickScale {
  height: number;
  width: number;
  opacity: number;
}

export interface TickScaleOptions {
  /** Stops on each side of the focused one that get magnified. Default 3. */
  radius?: number;
  /** Tick height far from the focus. Default 7. */
  baseHeight?: number;
  /** Tick height at the focus. Default 16. */
  peakHeight?: number;
  /** Tick opacity far from the focus. Default 0.45. */
  baseOpacity?: number;
  /** Tick width far from the focus. Default 4. */
  baseWidth?: number;
  /** Tick width at the focus. Default 8. */
  peakWidth?: number;
}

export const tickScale = (
  distanceFromActive: number,
  {
    radius = 3,
    baseHeight = 7,
    peakHeight = 16,
    baseOpacity = 0.45,
    baseWidth = 4,
    peakWidth = 8,
  }: TickScaleOptions = {},
): TickScale => {
  const distance = Math.abs(distanceFromActive);

  // radius 0 means "magnify only the focus itself".
  if (radius <= 0) {
    const peak = distance === 0;
    return {
      height: peak ? peakHeight : baseHeight,
      width: peak ? peakWidth : baseWidth,
      opacity: peak ? 1 : baseOpacity,
    };
  }

  // Linear falloff: 1 at the focus → 0 at `radius`, clamped flat beyond.
  const t = Math.min(1, Math.max(0, 1 - distance / radius));
  return {
    height: baseHeight + t * (peakHeight - baseHeight),
    width: baseWidth + t * (peakWidth - baseWidth),
    opacity: baseOpacity + t * (1 - baseOpacity),
  };
};

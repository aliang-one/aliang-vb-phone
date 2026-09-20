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
  if (block.kind === 'folded') {
    // A folded block is collapsed in the bubble too (label chip only, see
    // TranscriptMessageList). The preview must match what the reader saw —
    // dumping the hidden content here would bury the actual prompt that
    // follows it (e.g. a pasted error log ahead of the real question).
    return block.label;
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
 * Geometry of the scrubber rail in screen coordinates. `pageYMeasured` gates
 * fraction decoding: until a real `measure()` callback has landed, pageY is a
 * stale 0, so `(moveY - pageY) / height` would clamp to 1 and point every
 * gesture at the newest stop (the first-gesture loupe bug).
 */
export interface RailGeometry {
  pageY: number;
  height: number;
  pageYMeasured: boolean;
}

/**
 * Decode a finger screen-Y into a rail fraction ([0,1]) against the rail's
 * measured geometry. Returns null while the geometry is unusable (pageY not
 * measured yet, or zero height) — callers must skip selection instead of
 * guessing, since any guess from a poisoned geometry pins the loupe/commit to
 * the wrong stop.
 */
export const railFractionAt = (
  moveY: number,
  geometry: RailGeometry,
): number | null => {
  if (!geometry.pageYMeasured || geometry.height <= 0) return null;
  return Math.min(1, Math.max(0, (moveY - geometry.pageY) / geometry.height));
};

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
 * Uniformly sample up to `maxMarks` turn indices for the idle rail silhouette.
 * When `activeIndex` is given (≥ 0), it is pinned into the set — the rail must
 * always show where the user currently is — replacing one grid slot. Behavior
 * mirrors the original in-screen sampling so idle visuals stay identical.
 */
export const sampleRailIndices = (
  totalCount: number,
  maxMarks: number,
  activeIndex?: number,
): number[] => {
  if (totalCount <= 0) return [];
  const indices = new Set<number>();
  if (totalCount <= maxMarks) {
    for (let index = 0; index < totalCount; index += 1) indices.add(index);
  } else {
    const hasActive = activeIndex != null && activeIndex >= 0;
    const slots = hasActive ? maxMarks - 1 : maxMarks;
    const denominator = Math.max(1, slots - 1);
    for (let index = 0; index < slots; index += 1) {
      indices.add(Math.round((index * (totalCount - 1)) / denominator));
    }
    if (hasActive) indices.add(activeIndex);
  }
  return Array.from(indices).sort((left, right) => left - right);
};

/**
 * Map a focused stop index to a continuous position in mark space ([0,
 * marks-1]) so the fisheye bulge centers on the mark that REPRESENTS the stop
 * the loupe names. Marks are a ≤16-point sample of the stop list, so mark k
 * generally stands for stop index ≠ k — mapping by raw mark index made the
 * bulge and the loupe disagree by ±1 once the conversation exceeded the
 * sample size.
 */
export const markPositionForStop = (
  markStopIndices: number[],
  stopIndex: number,
): number => {
  const count = markStopIndices.length;
  if (count <= 1) return 0;
  if (stopIndex <= markStopIndices[0]) return 0;
  if (stopIndex >= markStopIndices[count - 1]) return count - 1;
  // Bracketing marks + linear interpolation: the bulge glides with the finger
  // instead of snapping between sampled slots.
  for (let k = 1; k < count; k += 1) {
    if (stopIndex <= markStopIndices[k]) {
      const prev = markStopIndices[k - 1];
      const next = markStopIndices[k];
      return k - 1 + (stopIndex - prev) / (next - prev);
    }
  }
  return count - 1;
};

/** Long-conversation rail height cap (≈20 marks at compact pitch). */
export const RAIL_MAX_HEIGHT = 276;
/** Short-conversation floor so a 1-2 mark pill stays tappable/visible. */
export const RAIL_MIN_HEIGHT = 44;

/**
 * Rail height for a given mark count — compact pitch (~13-15px between marks)
 * hugging the old flex look for short conversations, capped for long ones.
 *
 * The pitch IS the fisheye: the bulge reads as a wave only when neighboring
 * marks sit close enough to taper into each other — a fixed tall rail spreads
 * few marks so far apart that pressing just enlarges one lonely dot.
 */
export const railHeightFor = (markCount: number): number => {
  const raw = 30 + 13 * Math.max(0, markCount - 1);
  return Math.min(RAIL_MAX_HEIGHT, Math.max(RAIL_MIN_HEIGHT, raw));
};

export interface RailMarkVisual {
  /** Vertical center of the mark, as % of the rail height. */
  topPct: number;
  height: number;
  width: number;
  opacity: number;
}

/**
 * Visual state of ONE rail mark — the single source of truth for the rail's
 * two states, so their geometry can't drift apart:
 *
 * - idle (`engaged: false`): the compact silhouette — active mark tallest,
 *   mounted turns dimmer, unmounted dimmest.
 * - engaged (`engaged: true`, finger down): the fisheye bulge — marks near
 *   `focusPos` (a continuous mark-space position) magnify in height and width
 *   and brighten, so the located position protrudes out of the pill.
 *
 * Marks ALWAYS lay out at an even percentage of the rail height. The rail
 * itself declares an explicit height (marks render absolutely, out of the
 * document flow) — without that pairing, pressing the rail collapses the pill
 * to its padding and every mark stacks into a single dot.
 */
export const railMarkVisual = (
  index: number,
  markCount: number,
  focusPos: number,
  engaged: boolean,
  isActive: boolean,
  isVisible: boolean,
): RailMarkVisual => {
  const topPct = markCount > 1 ? (index / (markCount - 1)) * 100 : 50;
  if (!engaged) {
    return {
      topPct,
      height: isActive ? 18 : 8,
      width: 4,
      opacity: isActive ? 1 : isVisible ? 0.66 : 0.28,
    };
  }
  const { height, width, opacity } = tickScale(Math.abs(index - focusPos), {
    radius: 3.2,
    baseHeight: 6,
    peakHeight: 28,
    baseWidth: 4,
    peakWidth: 10,
  });
  return { topPct, height, width, opacity: Math.max(opacity, 0.4) };
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

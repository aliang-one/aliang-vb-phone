/**
 * Phone-side extraction of the structured Goal marker the agent prints at the
 * end of a turn (`ALIANG_GOAL_REPORT:{json}` for execution reports,
 * `ALIANG_GOAL_PLAN:{json}` for planning proposals — the latter rarely appears
 * in the live transcript because planning output is consumed as an RPC result,
 * but we defend against it nonetheless).
 *
 * WHY THIS EXISTS — the marker is a *machine channel*: the server reads it off
 * the terminal `ai.done` event's `goal_report` field (server/src/modules/goal/
 * events.ts) to drive the state machine. But the agent emits it as ordinary
 * text on the same stdout as the human-readable narrative, so it rides the
 * `ai.delta` stream verbatim into the assistant message `content`. Nothing
 * along agent→server→phone strips it, so without this layer the user sees a
 * raw `ALIANG_GOAL_REPORT:{...}` line at the end of the bubble.
 *
 * This pure function is invoked at the display layer
 * ({@link parseMessageContentSegments}) so the raw `content` stays intact in
 * the store — we only split it into {narrative, report} for rendering.
 *
 * STREAMING CONTRACT — `content` grows token by token. We must NEVER flash a
 * half-marker or partial JSON. So:
 *  - No marker present            → narrative = full content, report = null.
 *  - Marker prefix partially there
 *    (a streaming tail like `ALIANG_GOAL_RE`) at a line boundary
 *                                  → suppress that tail (narrative cuts it),
 *                                    report = null (card not yet).
 *  - Full marker but JSON incomplete → suppress from marker, report = null.
 *  - Full marker + parseable JSON → narrative = text before marker, report
 *                                    populated → caller renders the card.
 *
 * The line-boundary requirement on the partial-prefix match is what stops
 * ordinary prose ("...looked at ALIANG") from being mistaken for a streaming
 * marker: the marker is always emitted on its own line (protocol.ts prompt:
 * "End the response with exactly one line beginning ALIANG_GOAL_REPORT:").
 *
 * The tolerant JSON parsing mirrors the agent's parseMarkedJSONObject
 * (alianggate agent_goal.go): complete-strict first, then a balanced-scan
 * fallback that accepts a leading object even with trailing prose / ``` fence.
 */

export type GoalReportOutcome =
  | 'task_completed'
  | 'blocked'
  | 'failed'
  | 'no_progress';

export type GoalReportKind = 'report' | 'plan';

export interface ExtractedGoalReport {
  outcome: GoalReportOutcome;
  summary: string;
  blockerCode?: string;
  completionProposed?: boolean;
}

export interface GoalReportExtraction {
  /** `content` with the marker (and any streaming partial marker tail) removed. */
  narrative: string;
  /** Parsed report — null when there is no marker, or the marker is present
   *  but its JSON is not yet complete (still streaming). */
  report: ExtractedGoalReport | null;
  /** Which marker was found. Null when no marker at all. Non-null only with a
   *  complete marker (incomplete tails surface as report=null, reportKind=null
   *  so no card is ever rendered from a partial). */
  reportKind: GoalReportKind | null;
}

const REPORT_MARKER = 'ALIANG_GOAL_REPORT:';
const PLAN_MARKER = 'ALIANG_GOAL_PLAN:';

// REPORT is checked before PLAN: a report terminates the turn, so if both
// somehow appear we treat the machine-consumed report as authoritative.
const MARKERS: ReadonlyArray<{ marker: string; kind: GoalReportKind }> = [
  { marker: REPORT_MARKER, kind: 'report' },
  { marker: PLAN_MARKER, kind: 'plan' },
];

const OUTCOMES: ReadonlySet<string> = new Set([
  'task_completed',
  'blocked',
  'failed',
  'no_progress',
]);

const atLineStart = (content: string, index: number): boolean =>
  index === 0 || content[index - 1] === '\n';

/** First occurrence of `marker` that sits at a line boundary, or -1. */
const indexOfLineStart = (content: string, marker: string): number => {
  let from = 0;
  while (true) {
    const idx = content.indexOf(marker, from);
    if (idx < 0) return -1;
    if (atLineStart(content, idx)) return idx;
    from = idx + marker.length;
  }
};

/**
 * Index of a *partial* marker prefix sitting at a line boundary at the very
 * tail of `content` (the streaming case: the marker is mid-arrival), or -1.
 * Longest-prefix-first so we suppress as early as possible once the line
 * clearly intends to be the marker. The line-start gate is the prose guard.
 *
 * Minimum prefix length is 5 (`'ALIAN'`): shorter prefixes like `'A'` or
 * `'AL'` are common in prose (especially single-letter test messages) and
 * would cause false-positive partial-marker detection, stripping the narrative
 * to empty and silently dropping the message.
 */
const MIN_PARTIAL_PREFIX = 5;

const partialPrefixAtLineStart = (
  content: string,
  marker: string,
): number => {
  for (let len = marker.length - 1; len >= MIN_PARTIAL_PREFIX; len -= 1) {
    const prefix = marker.slice(0, len);
    if (!content.endsWith(prefix)) continue;
    const start = content.length - len;
    if (atLineStart(content, start)) return start;
  }
  return -1;
};

type MarkerHit = { index: number; kind: GoalReportKind; complete: boolean };

/**
 * Locate the marker (complete preferred over partial; REPORT preferred over
 * PLAN). Returns the cut index for the narrative plus which marker / whether
 * its full text has arrived.
 */
const findMarkerHit = (content: string): MarkerHit | null => {
  // 1. Any complete marker at a line boundary wins (REPORT checked first).
  for (const { marker, kind } of MARKERS) {
    const idx = indexOfLineStart(content, marker);
    if (idx >= 0) return { index: idx, kind, complete: true };
  }
  // 2. Otherwise a partial prefix at the tail (streaming). Earliest across the
  //    markers wins so we never show a partial that precedes another hit.
  let best: MarkerHit | null = null;
  for (const { marker, kind } of MARKERS) {
    const idx = partialPrefixAtLineStart(content, marker);
    if (idx >= 0 && (best === null || idx < best.index)) {
      best = { index: idx, kind, complete: false };
    }
  }
  return best;
};

const peelOpeningFence = (value: string): string => {
  const match = value.match(/^```[a-zA-Z0-9]*[ \t]*\n?/);
  return match ? value.slice(match[0].length) : value;
};

const stripTrailingFence = (value: string): string =>
  value.replace(/[ \t]*\n?```[ \t]*$/, '');

/**
 * Parse a leading JSON object out of `tail` (the text after the full marker).
 * Tries the strict whole-string parse first (the common, well-formed case),
 * then falls back to a string-aware brace scan that tolerates trailing prose
 * (the model sometimes appends commentary after the JSON). Returns null when
 * the object is unbalanced — i.e. still streaming — so the caller suppresses.
 */
const parseLeadingJsonObject = (tail: string): Record<string, unknown> | null => {
  const start = tail.indexOf('{');
  if (start < 0) return null;
  try {
    const whole = JSON.parse(tail);
    return typeof whole === 'object' && whole !== null && !Array.isArray(whole)
      ? (whole as Record<string, unknown>)
      : null;
  } catch {
    // Fall through to the tolerant brace scan.
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < tail.length; i += 1) {
    const ch = tail[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const obj = JSON.parse(tail.slice(start, i + 1));
          return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
            ? (obj as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null; // unbalanced → still streaming
};

const parseReportPayload = (tail: string): ExtractedGoalReport | null => {
  let raw = tail.trim();
  if (!raw) return null;
  raw = peelOpeningFence(raw);
  raw = stripTrailingFence(raw).trim();
  if (!raw) return null;
  const obj = parseLeadingJsonObject(raw);
  if (!obj) return null;
  const outcome = typeof obj.outcome === 'string' ? obj.outcome : '';
  if (!OUTCOMES.has(outcome)) return null;
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const blockerCode =
    typeof obj.blocker_code === 'string' && obj.blocker_code.trim()
      ? obj.blocker_code
      : undefined;
  const completionProposed =
    typeof obj.completion_proposed === 'boolean' ? obj.completion_proposed : undefined;
  return { outcome: outcome as GoalReportOutcome, summary, blockerCode, completionProposed };
};

export const extractGoalReport = (content: string | undefined | null): GoalReportExtraction => {
  const source = content ?? '';
  const hit = findMarkerHit(source);
  if (!hit) return { narrative: source, report: null, reportKind: null };
  // The marker sits on its own line, so everything from `hit.index` onward is
  // the marker line; trim the separating whitespace off the narrative so it
  // stays a tight "text before the marker" (matches the render-layer trim).
  // When the model wraps the marker JSON in a fenced block, an opening fence
  // line (e.g. ```json) precedes the marker — strip that too. We only strip a
  // *tagged* opener (```json); a bare ``` is ambiguous with a legitimate code
  // block closer in the narrative, so we leave those intact.
  const narrative = source
    .slice(0, hit.index)
    .trimEnd()
    .replace(/\n?```[a-zA-Z0-9]+[ \t]*$/, '');
  if (!hit.complete) {
    // Streaming: marker prefix landed but the full marker + JSON haven't.
    return { narrative, report: null, reportKind: null };
  }
  const marker = hit.kind === 'report' ? REPORT_MARKER : PLAN_MARKER;
  const report = parseReportPayload(source.slice(hit.index + marker.length));
  if (!report) {
    // Full marker present but JSON incomplete/malformed — still streaming.
    return { narrative, report: null, reportKind: null };
  }
  return { narrative, report, reportKind: hit.kind };
};

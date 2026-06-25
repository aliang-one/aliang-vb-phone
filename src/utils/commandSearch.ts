import type { AgentCommandInfo } from '../data/platformModels';

// Fuzzy `/`-command matching for the mobile typeahead — fzf-style subsequence
// matching with relevance scoring.
//
// Why subsequence + scoring over prefix/substring: prefix-only misses
// "brainstorming" when the user types "brain" mid-thought or "brnst"; substring
// misses transposed/abbreviated input. A subsequence match (every query char
// present, in order, not necessarily contiguous) maximizes RECALL — the chance
// the intended command is in the result set at all — while the score RANKS the
// most relevant first (prefix/contiguous/word-boundary beats scattered). This
// is the "maximum find-probability" approach: cast a wide net, then order by
// how strongly each command looks like the intended one.

/** Score a single piece of text against the query. null = no match. */
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (q.length === 0) return 0;
  if (t.length === 0) return null;

  // Strong fast-path: contiguous substring. Earlier + longer + at a word
  // boundary = best. This ranks prefix matches highest (the common intent).
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    let s = 80; // base for any contiguous match
    s -= subIdx * 2; // earlier in the text = better
    if (subIdx === 0) s += 60; // prefix bonus
    if (subIdx === 0 || isBoundary(t, subIdx)) s += 15; // segment-start bonus
    s += q.length; // longer contiguous span = better
    return s;
  }

  // Subsequence match with escalating run bonus + word-boundary bonus.
  let score = 0;
  let qi = 0;
  let run = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      run += 1;
      score += 1 + run * 2; // consecutive hits escalate (1,3,6,10,…)
      if (ti === 0 || isBoundary(t, ti)) score += 10; // word-boundary hit
      qi += 1;
    } else {
      run = 0;
    }
  }
  if (qi < q.length) return null; // not every query char was consumed → no match
  score -= (t.length - q.length) * 0.3; // density: tighter text ranks higher
  return score;
}

// A word boundary for command names: index 0, or the first char after a
// separator ('/', '-', '_', '.', space) — i.e. the start of each
// kebab/snake/path segment, which is where users mentally chunk command names.
function isBoundary(lowerText: string, i: number): boolean {
  if (i === 0) return true;
  const prev = lowerText[i - 1];
  return prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' ';
}

/**
 * Score a command against a query across name (primary) and description
 * (secondary, reduced weight so a name match always outranks a description-only
 * one). Returns null when neither matches (subsequence fails on both).
 */
export function scoreCommand(cmd: AgentCommandInfo, query: string): number | null {
  if (query.length === 0) return 0;
  const nameScore = fuzzyScore(cmd.name, query);
  const descScore = cmd.description ? fuzzyScore(cmd.description, query) : null;
  if (nameScore === null && descScore === null) return null;
  const name = nameScore ?? Number.NEGATIVE_INFINITY;
  const desc = (descScore ?? Number.NEGATIVE_INFINITY) * 0.4;
  return Math.max(name, desc);
}

/**
 * Filter + rank commands by fuzzy relevance to the query, deduped by lowercased
 * name (keeping the highest-scoring entry per name). Empty query returns all
 * (input order), capped at `limit`.
 */
export function searchCommands(
  commands: AgentCommandInfo[],
  query: string,
  limit = 8,
): AgentCommandInfo[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    const seen = new Set<string>();
    const out: AgentCommandInfo[] = [];
    for (const cmd of commands) {
      const key = cmd.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cmd);
      if (out.length >= limit) break;
    }
    return out;
  }

  const bestByName = new Map<string, { cmd: AgentCommandInfo; score: number }>();
  for (const cmd of commands) {
    const score = scoreCommand(cmd, q);
    if (score === null) continue;
    const key = cmd.name.toLowerCase();
    const prev = bestByName.get(key);
    if (!prev || score > prev.score) bestByName.set(key, { cmd, score });
  }

  return Array.from(bestByName.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.cmd);
}

/**
 * Quota kill-reason prefix contract (cross-repo, verbatim from the Go agent's
 * agent_terminal.go killTerminalSession): the `terminal.error` frame's error
 * text starts with `quota_unanswered:` / `quota_hard_cap:` / `quota_denied:`
 * followed by an English detail line. The phone humanizes those three into
 * `terminals:exitReason.*`; every other error text keeps whatever generic
 * copy the display point already had (zero-regression rule).
 */
export type TerminalQuotaExitKind =
  | 'quota_unanswered'
  | 'quota_hard_cap'
  | 'quota_denied';

const QUOTA_EXIT_PREFIXES: readonly TerminalQuotaExitKind[] = [
  'quota_unanswered',
  'quota_hard_cap',
  'quota_denied',
];

/**
 * Map a raw agent terminal error text to its quota kill kind, or null when
 * the text is absent / not one of the three contract prefixes (including
 * unknown future `quota_*` variants — those must fall back to the existing
 * generic copy rather than render a guess).
 */
export const terminalQuotaExitKind = (
  reason?: string | null,
): TerminalQuotaExitKind | null => {
  if (typeof reason !== 'string') {
    return null;
  }
  for (const kind of QUOTA_EXIT_PREFIXES) {
    if (reason.startsWith(`${kind}:`)) {
      return kind;
    }
  }
  return null;
};

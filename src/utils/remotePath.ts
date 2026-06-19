/**
 * Remote path comparison helpers. Agents and the server occasionally record a
 * session's `project_path` with a trailing slash, doubled separators, or
 * backslashes (Windows agents) that differ from the canonical `Project.path`.
 * A strict `===` then fails to associate the session with its project, so it
 * vanishes from the project's VibeCoding list even though it belongs there.
 *
 * Normalize before comparing. Mirrors the server's `normalizeRemotePath`
 * (server/src/index.ts): intentionally case-sensitive — on the case-sensitive
 * filesystems these agents run on, `/Foo` and `/foo` are different directories,
 * so lowercasing (as the admin web console does) would create false matches.
 */
export function normalizeRemotePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/** True when two remote paths refer to the same directory after normalization. */
export function sameRemotePath(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return normalizeRemotePath(left) === normalizeRemotePath(right);
}

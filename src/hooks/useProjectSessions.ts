import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useStableVibeRuns } from '../store/controlCenterStore';
import { serverAiSessionToVibeRun } from '../store/internals';
import { fetchProjectAiSessions } from '../api/projects';

type ProjectSessionRun = ReturnType<typeof serverAiSessionToVibeRun>;

export interface UseProjectSessionsResult {
  /** Sessions to display — merged with live store runs, sorted newest-first,
   *  and sliced to `limit` when one is set (preview mode). */
  sessions: ProjectSessionRun[];
  /** Full match count on the server (ignores `limit`) — for a "view all" cue. */
  totalCount: number;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Project-scoped AI session list, decoupled from the globally-capped vibeRuns
 * store (MAX_VIBE_RUNS). Fetches this project's sessions directly from the
 * server (lightweight summaries) on focus, merges in any live store runs that
 * belong to the project (store-wins, so just-created / running sessions show
 * current state without waiting for the next fetch), and sorts newest-first.
 *
 * Pass `limit` for a lightweight preview (e.g. the project page shows the 5
 * newest); omit it for a full list (e.g. the "view all" screen). `totalCount`
 * always reflects the full server match so callers can decide whether to offer
 * a "more" entry. Fetch is summaries-only + focus/refresh-triggered, so it
 * stays small and infrequent.
 */
export function useProjectSessions(
  projectId: string | undefined,
  opts?: { limit?: number },
): UseProjectSessionsResult {
  const limit = opts?.limit;
  const vibeRuns = useStableVibeRuns();
  const [fetched, setFetched] = useState<ProjectSessionRun[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { sessions, total_count } = await fetchProjectAiSessions(
        projectId,
        limit,
      );
      // devices/projects aren't needed: these runs are only ever shown inside
      // this project's view, so deriving their projectId is unnecessary.
      setFetched(
        sessions.map(summary => serverAiSessionToVibeRun(summary, [], [])),
      );
      setTotalCount(total_count);
    } catch {
      // leave the previously-loaded list in place on failure
    } finally {
      setLoading(false);
    }
  }, [projectId, limit]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const sessions = useMemo(() => {
    const byId = new Map<string, ProjectSessionRun>();
    for (const run of fetched) byId.set(run.id, run);
    // Overlay live store runs for this project so just-created / running
    // sessions appear immediately without waiting for the next fetch.
    if (projectId) {
      for (const run of vibeRuns) {
        if (run.projectId === projectId) byId.set(run.id, run);
      }
    }
    const merged = [...byId.values()].sort(
      (a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0),
    );
    return limit !== undefined ? merged.slice(0, limit) : merged;
  }, [fetched, vibeRuns, projectId, limit]);

  return { sessions, totalCount, loading, reload };
}

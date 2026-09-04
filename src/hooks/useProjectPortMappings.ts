import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPortMappings, PortMapping } from '../api/portMappings';
import { effectiveStatus } from '../components/devices/PortMappingCard';

export interface UseProjectPortMappingsResult {
  /** Project-tagged public mappings, newest-first (created_at desc). */
  mappings: PortMapping[];
  /** How many of them are actually serving ("转发中") — what the hero cell shows. */
  activeCount: number;
  loading: boolean;
  /** Raw load error — map through mappingErrorKey at render time (it needs the
   *  error instance to detect tunnel-service API codes). Null when clean. */
  error: unknown;
  reload: () => Promise<void>;
}

/**
 * Shared data source for the project ports page and the project-detail hero
 * "ports" metric: one fetch of the project-tagged public mappings, with the
 * active count the hero cell surfaces (agent-detected ports come from the
 * Project model; "转发中" comes from here).
 */
export function useProjectPortMappings(
  projectId: string | undefined,
): UseProjectPortMappingsResult {
  const [mappings, setMappings] = useState<PortMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const mountedRef = useRef(true);

  // Unmount guard in its own empty-dep effect (never re-armed when the reload
  // callback identity changes) — same pattern as PortMappingsScreen.
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const reload = useCallback(async () => {
    if (!projectId) {
      setMappings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPortMappings({ projectId });
      if (!mountedRef.current) return;
      setMappings(
        [...result].sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime(),
        ),
      );
    } catch (loadError) {
      if (!mountedRef.current) return;
      setError(loadError);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const activeCount = mappings.filter(
    mapping => effectiveStatus(mapping) === 'active',
  ).length;

  return { mappings, activeCount, loading, error, reload };
}

/**
 * useSessionDetailLoader — owns the detail-load orchestration for
 * VibeCodingSessionScreen (item 4 / #5 hook extraction).
 *
 * Custom-hook extraction is behavior-preserving by React's composition rules
 * (this hook must be called unconditionally at the top of the component). The
 * decision predicates come from the tested `sessionDetailState` module.
 *
 * SHARED STATE: `detailError` / `setDetailError` is NOT detail-load-specific —
 * the screen reuses it for send / goal / loadEarlier errors. So the screen
 * keeps that state and passes `setDetailError` IN; this hook only owns what is
 * genuinely detail-load-specific (`loadingDetail`, `refreshingLatest`, the
 * detail refs, and the four load/recover effects). Effect bodies + deps were
 * moved unchanged; the hook calls the passed-in setter for errors.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { DetailState } from '../../data/platformModels';
import {
  computeHasDetail,
  isDetailFetchUnavailable,
  isRecoverableConversation,
} from './sessionDetailState';

const DETAIL_LOAD_TIMEOUT_MS = 15000;

export interface SessionDetailLoaderInput {
  targetSessionId: string | undefined;
  detailState: DetailState | undefined;
  transcriptLength: number;
  wsConnected: boolean;
  deviceStatus: string | undefined;
  loadAgentSessionDetail: (
    sessionId: string,
    options?: { refresh?: boolean },
  ) => Promise<unknown>;
  t: TFunction;
  refreshing: boolean;
  /** Shared error display — the screen owns the state, passes the setter in. */
  setDetailError: (message: string) => void;
  /** Current detailError value (read by the mount-auto-load guard). */
  detailError: string;
}

export interface SessionDetailLoader {
  loadingDetail: boolean;
  refreshingLatest: boolean;
  hasDetail: boolean;
  detailFetchUnavailable: boolean;
  recoverableConversation: boolean;
  refreshLatest: () => Promise<void>;
}

export function useSessionDetailLoader(
  input: SessionDetailLoaderInput,
): SessionDetailLoader {
  const {
    targetSessionId,
    detailState,
    transcriptLength,
    wsConnected,
    deviceStatus,
    loadAgentSessionDetail,
    t,
    refreshing,
    setDetailError,
    detailError,
  } = input;

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshingLatest, setRefreshingLatest] = useState(false);

  const mountedRef = useRef(true);
  const targetSessionIdRef = useRef<string | undefined>(undefined);
  const detailLoadRequestRef = useRef(0);
  const detailLoadInFlightRef = useRef<string | null>(null);
  const autoFetchRef = useRef(false);
  const prevRecoverableRef = useRef(false);

  const hasDetail = computeHasDetail(detailState, transcriptLength);
  const detailFetchUnavailable = isDetailFetchUnavailable(detailState);
  const recoverableConversation = isRecoverableConversation({
    wsConnected,
    deviceStatus,
    transcriptLength,
    detailState,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    targetSessionIdRef.current = targetSessionId;
  }, [targetSessionId]);

  useEffect(() => {
    if (hasDetail) {
      autoFetchRef.current = false;
    }
  }, [hasDetail, targetSessionId]);

  useEffect(() => {
    if (!targetSessionId || hasDetail || detailError || detailFetchUnavailable)
      return;
    if (detailLoadInFlightRef.current === targetSessionId) return;
    if (autoFetchRef.current) return;
    autoFetchRef.current = true;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const requestId = detailLoadRequestRef.current + 1;
    detailLoadRequestRef.current = requestId;
    detailLoadInFlightRef.current = targetSessionId;
    setLoadingDetail(true);
    setDetailError('');

    const detailLoad = loadAgentSessionDetail(targetSessionId);
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(t('session.loading.detailTimeout'))),
        DETAIL_LOAD_TIMEOUT_MS,
      );
    });

    void Promise.race([detailLoad, timeout])
      .catch(error => {
        if (
          mountedRef.current &&
          detailLoadRequestRef.current === requestId &&
          targetSessionIdRef.current === targetSessionId
        ) {
          setDetailError(
            error instanceof Error
              ? error.message
              : t('session.loading.loadDetailFailed'),
          );
        }
      })
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
        if (detailLoadRequestRef.current === requestId) {
          detailLoadInFlightRef.current = null;
        }
        if (
          mountedRef.current &&
          detailLoadRequestRef.current === requestId &&
          targetSessionIdRef.current === targetSessionId
        ) {
          setLoadingDetail(false);
        }
      });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    detailError,
    detailFetchUnavailable,
    hasDetail,
    loadAgentSessionDetail,
    t,
    targetSessionId,
    setDetailError,
  ]);

  useEffect(() => {
    if (!loadingDetail || !detailFetchUnavailable) return;
    if (targetSessionIdRef.current !== targetSessionId) return;
    detailLoadRequestRef.current += 1;
    detailLoadInFlightRef.current = null;
    setLoadingDetail(false);
  }, [detailFetchUnavailable, loadingDetail, targetSessionId]);

  useEffect(() => {
    if (!recoverableConversation || prevRecoverableRef.current) return;
    if (!targetSessionId || refreshing || loadingDetail) return;
    prevRecoverableRef.current = true;
    void loadAgentSessionDetail(targetSessionId, { refresh: true }).catch(
      () => {},
    );
  }, [
    recoverableConversation,
    targetSessionId,
    refreshing,
    loadingDetail,
    loadAgentSessionDetail,
  ]);

  useEffect(() => {
    autoFetchRef.current = false;
    prevRecoverableRef.current = false;
  }, [targetSessionId]);

  const refreshLatest = useCallback(async () => {
    if (!targetSessionId) return;
    setRefreshingLatest(true);
    setDetailError('');
    try {
      await loadAgentSessionDetail(targetSessionId, { refresh: true });
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : t('session.loading.loadDetailFailed'),
      );
    } finally {
      setRefreshingLatest(false);
    }
  }, [loadAgentSessionDetail, t, targetSessionId, setDetailError]);

  return {
    loadingDetail,
    refreshingLatest,
    hasDetail,
    detailFetchUnavailable,
    recoverableConversation,
    refreshLatest,
  };
}

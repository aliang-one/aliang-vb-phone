import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useControlCenterStore } from '../store/controlCenterStore';
import { useToastStore } from '../store/toastStore';
import { refreshFeedback } from '../utils/refreshFeedback';

/**
 * Drop-in replacement for the bare `setRefreshing + try/catch refreshFromServer`
 * pattern shared by the snapshot-backed pull-to-refresh handlers. Owns the
 * `refreshing` flag, awaits `refreshFromServer`, and toasts success/failure
 * (the store resolves with `{ok,error}` and never rejects, so feedback is
 * driven by the outcome, not a try/catch).
 */
export function useRefreshWithFeedback() {
  const [refreshing, setRefreshing] = useState(false);
  const refreshFromServer = useControlCenterStore(s => s.refreshFromServer);
  const show = useToastStore(s => s.show);
  const { t } = useTranslation('common');

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await refreshFromServer();
      const feedback = refreshFeedback(result, t);
      show(feedback.message, feedback.type);
    } finally {
      setRefreshing(false);
    }
  }, [refreshFromServer, show, t]);

  return { refreshing, handleRefresh };
}

import type { TFunction } from 'i18next';
import type { ToastType } from '../store/toastStore';
import type { RefreshOutcome } from '../store/types';

export interface RefreshFeedback {
  message: string;
  type: ToastType;
}

/**
 * Map a `refreshFromServer` outcome to a toast payload. Pure so it can be
 * unit-tested without the store/React; the hook wires it to `useToastStore`.
 */
export function refreshFeedback(
  result: RefreshOutcome,
  t: TFunction,
): RefreshFeedback {
  if (result.ok) {
    return { message: t('common:refreshSuccess'), type: 'success' };
  }
  return {
    message: t('common:refreshFailed', { error: result.error }),
    type: 'error',
  };
}

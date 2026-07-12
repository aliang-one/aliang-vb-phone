import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastState {
  message: string | null;
  type: ToastType;
  visible: boolean;
  show: (message: string, type?: ToastType) => void;
  hide: () => void;
}

const AUTO_HIDE_MS = 1500;

// Module-level timer so a new `show` can cancel a pending auto-hide from a
// previous toast (otherwise the old timeout fires and hides the new one early).
let hideTimeoutId: ReturnType<typeof setTimeout> | null = null;

function clearPendingHide() {
  if (hideTimeoutId) {
    clearTimeout(hideTimeoutId);
    hideTimeoutId = null;
  }
}

export const useToastStore = create<ToastState>(set => ({
  message: null,
  type: 'success',
  visible: false,
  show: (message, type = 'success') => {
    clearPendingHide();
    set({ message, type, visible: true });
    hideTimeoutId = setTimeout(() => {
      hideTimeoutId = null;
      set({ visible: false });
    }, AUTO_HIDE_MS);
  },
  hide: () => {
    clearPendingHide();
    set({ visible: false });
  },
}));

export function useToast() {
  return useToastStore(store => ({ show: store.show, hide: store.hide }));
}

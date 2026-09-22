import { create } from 'zustand';

export interface PinnedDevice {
  id: string;
  name: string;
}

export interface DevicePinState {
  pinned: PinnedDevice | null;
  pin: (device: PinnedDevice) => void;
  unpin: () => void;
}

// Session-scoped (in-memory) voice-device lock: the device long-pressed in the
// NEW TERM picker stays the voice→bash target until unpinned/re-pinned or the
// app dies. Deliberately NOT persisted (spec 2026-09-22 §3.1).
export const useDevicePinStore = create<DevicePinState>(set => ({
  pinned: null,
  pin: device => set({ pinned: { id: device.id, name: device.name } }),
  unpin: () => set({ pinned: null }),
}));

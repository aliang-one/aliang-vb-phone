import type { StateCreator } from 'zustand';
import {
  cancelTransfer,
  fetchTransfer,
  startTransfer,
  type TransferState,
  type TransferStatus,
} from '../../api/transfers';
import { ApiResponseError } from '../../api/client';
import type { PlatformTransferStatus } from '../../services/platformTransport';
import type { ControlCenterState, TransferPhase } from '../types';

/**
 * Device-to-device transfer state machine. Event-driven (WS `transfer.updated`
 * pushes fire on every server-side state change) with a REST reconcile
 * fallback (`refreshTransferStatus`) — same self-heal shape as the download
 * slice. One `transferActive` record: the sheet is the only consumer and the
 * long-press menu starts at most one at a time.
 */

type TransferSlice = Pick<
  ControlCenterState,
  | 'transferActive' | 'transferPhase'
  | 'startTransfer' | 'handleTransferEvent' | 'refreshTransferStatus'
  | 'cancelTransfer' | 'markTransferFailed' | 'resetTransfer'
>;

/**
 * Server transfer state → client phase. Server-side progress states
 * (pending/uploading/completing/ready/receiving) all collapse into one
 * `transferring` phase — the phone sees coarse snapshot steps, not a
 * lifecycle it needs to stage. `cancelled` stays its own phase: the sheet
 * treats it as transient and closes itself.
 */
export function transferPhaseFromState(state: TransferState): TransferPhase {
  if (state === 'done') return 'done';
  if (state === 'failed' || state === 'expired') return 'failed';
  if (state === 'cancelled') return 'cancelled';
  return 'transferring';
}

const toEventPayload = (status: TransferStatus): PlatformTransferStatus => ({
  transferId: status.transfer_id,
  filename: status.filename,
  sizeBytes: status.size_bytes,
  isDirectoryArchive: status.is_directory_archive,
  state: status.state,
  bytesDone: status.bytes_done,
  sourceDeviceId: status.source_device_id,
  targetDeviceId: status.target_device_id,
  errorCode: status.error_code,
  errorMessage: status.error_message,
});

export const createTransferSlice: StateCreator<
  ControlCenterState,
  [],
  [],
  TransferSlice
> = (set, get) => ({
  transferActive: null,
  transferPhase: 'idle',

  startTransfer: async input => {
    // Seed the record before the await so the sheet has full context the
    // instant the request starts — and so a failure has somewhere to put its
    // reason (transferId stays '' until the 201 answers).
    set({
      transferActive: {
        sourceDeviceId: input.sourceDeviceId,
        targetDeviceId: input.targetDeviceId,
        transferId: '',
        sourcePath: input.sourcePath,
        filename: input.filename,
        isDirectoryArchive: input.isDirectoryArchive,
        totalBytes: 0,
        bytesDone: 0,
      },
      transferPhase: 'requesting',
    });
    try {
      const status = await startTransfer({
        source_device_id: input.sourceDeviceId,
        target_device_id: input.targetDeviceId,
        source_path: input.sourcePath,
        filename: input.filename,
        is_directory_archive: input.isDirectoryArchive,
      });
      set(state => {
        const active = state.transferActive;
        // A reset/cancel during the POST retired our record — a late 201
        // must not resurrect it.
        if (!active || active.transferId !== '') {
          return state;
        }
        return {
          transferActive: {
            ...active,
            transferId: status.transfer_id,
            totalBytes: status.size_bytes,
            bytesDone: status.bytes_done,
            reason: status.error_message,
          },
          transferPhase: transferPhaseFromState(status.state),
        };
      });
      // Reconcile once the 201 lands: every WS push that raced the POST was
      // dropped by the attribution guard above (transferId still ''), so pull
      // the authoritative snapshot. Safe to await: refreshTransferStatus
      // swallows its own errors and no-ops when the record was retired.
      await get().refreshTransferStatus();
    } catch (error) {
      // Server error codes (409 device_capability_unsupported /
      // self_transfer_not_allowed / pair_busy, 503 transfer_disabled)
      // surface as the reason on the sheet.
      get().markTransferFailed(
        error instanceof Error ? error.message : 'Transfer request failed',
      );
    }
  },

  handleTransferEvent: transfer => {
    const active = get().transferActive;
    // Ignore pushes we cannot attribute: a stale event after reset, or a
    // transfer this client never started (pre-restart / other phone).
    if (!active || !transfer.transferId || transfer.transferId !== active.transferId) {
      return;
    }
    if (transfer.state === 'cancelled') {
      // Cancelled from another surface (same-account cancel API) — same
      // transient as a user cancel: the sheet closes itself.
      set({ transferActive: null, transferPhase: 'cancelled' });
      return;
    }
    const nextPhase = transferPhaseFromState(transfer.state);
    const current = get().transferPhase;
    // A lagging snapshot (WS replay / stale REST replica) must not drag the
    // phase or byte counter backwards; terminal phases stay put.
    const frozen =
      current === 'done' || current === 'failed' || current === 'cancelled';
    set({
      transferActive: {
        ...active,
        totalBytes: transfer.sizeBytes || active.totalBytes,
        bytesDone: Math.max(active.bytesDone, transfer.bytesDone),
        reason: transfer.errorMessage ?? active.reason,
      },
      transferPhase: frozen ? current : nextPhase,
    });
  },

  refreshTransferStatus: async () => {
    const active = get().transferActive;
    // No record (or still awaiting the start POST) — nothing to reconcile.
    if (!active || !active.transferId) return;
    try {
      const status = await fetchTransfer(active.transferId);
      get().handleTransferEvent(toEventPayload(status));
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 404) {
        // The transfer died with a server restart — drop the stale record.
        get().resetTransfer();
        return;
      }
      // Transient network/server errors: leave the WS-driven state untouched.
    }
  },

  cancelTransfer: async () => {
    const active = get().transferActive;
    if (!active) return;
    if (!active.transferId) {
      // Still requesting — the POST-in-flight guard in startTransfer absorbs
      // the late 201; just retire the local record.
      set({ transferActive: null, transferPhase: 'idle' });
      return;
    }
    try {
      await cancelTransfer(active.transferId);
      set({ transferActive: null, transferPhase: 'cancelled' });
    } catch (error) {
      // 409 (already done) means the transfer beat the cancel — the WS
      // `done` snapshot lands via refresh; surface anything else as failed.
      if (error instanceof ApiResponseError && error.status === 409) {
        await get().refreshTransferStatus();
        return;
      }
      get().markTransferFailed(
        error instanceof Error ? error.message : 'Failed to cancel transfer',
      );
    }
  },

  markTransferFailed: reason => {
    set(state => ({
      transferActive: state.transferActive
        ? { ...state.transferActive, reason }
        : state.transferActive,
      transferPhase: 'failed',
    }));
  },

  resetTransfer: () => set({ transferActive: null, transferPhase: 'idle' }),
});

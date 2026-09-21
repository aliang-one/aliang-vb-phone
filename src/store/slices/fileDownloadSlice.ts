import type { StateCreator } from 'zustand';
import {
  cancelProjectFileDownload,
  fetchProjectFileDownload,
  startProjectFileDownload,
  type FileDownloadStatus,
} from '../../api/projects';
import { ApiResponseError } from '../../api/client';
import type { PlatformFileDownloadStatus } from '../../services/platformTransport';
import type { ActiveDownload, ControlCenterState, FileDownloadPhase } from '../types';

/**
 * Single-file download state machine. Event-driven (WS `file_download` pushes)
 * with a REST reconcile fallback (`refreshStatus`) — the same self-heal shape
 * the approval flow uses. The server enforces per-user concurrency = 1, so one
 * `fileDownloadActive` record is the whole truth.
 */

type FileDownloadSlice = Pick<
  ControlCenterState,
  | 'fileDownloadActive' | 'fileDownloadPhase'
  | 'startDownload' | 'handleFileDownloadEvent' | 'refreshStatus'
  | 'cancelDownload' | 'markSaving' | 'markDone' | 'markFailed'
  | 'resetFileDownload'
>;

/**
 * Server download state → client phase. `completed`/`cancelled` both mean
 * "nothing left to show" (idle): after a user cancel the sheet closes over
 * `cancelled` directly, and a WS confirm arriving later finds no active record.
 */
export function phaseFromStatus(
  state: FileDownloadStatus['state'],
): FileDownloadPhase {
  if (state === 'ready' || state === 'failed') return state;
  if (state === 'completed' || state === 'cancelled') return 'idle';
  return 'uploading';
}

const toEventPayload = (
  status: FileDownloadStatus,
  fallbackRequestId: string,
): PlatformFileDownloadStatus => ({
  requestId: status.request_id || fallbackRequestId,
  state: status.state,
  uploadedBytes: status.uploaded_bytes,
  totalBytes: status.total_bytes,
  url: status.url,
  expiresAt: status.expires_at,
  reason: status.reason,
});

export const createFileDownloadSlice: StateCreator<
  ControlCenterState,
  [],
  [],
  FileDownloadSlice
> = (set, get) => ({
  fileDownloadActive: null,
  fileDownloadPhase: 'idle',

  startDownload: async (projectId, path, filename) => {
    // Seed the record before the await so the sheet has filename context the
    // instant the request starts — and so a failure has somewhere to put its
    // reason (requestId stays '' until the 202 answers).
    set({
      fileDownloadActive: {
        projectId,
        requestId: '',
        path,
        filename,
        totalBytes: 0,
        uploadedBytes: 0,
      },
      fileDownloadPhase: 'requesting',
    });
    try {
      const status = await startProjectFileDownload(projectId, path);
      set(state => {
        const active = state.fileDownloadActive;
        // A reset/cancel during the POST retired our record — a late 202 must
        // not resurrect it.
        if (!active || active.projectId !== projectId || active.path !== path) {
          return state;
        }
        return {
          fileDownloadActive: {
            ...active,
            requestId: status.request_id,
            totalBytes: status.total_bytes ?? 0,
            uploadedBytes: status.uploaded_bytes ?? 0,
            url: status.url,
            reason: status.reason,
          },
          fileDownloadPhase: phaseFromStatus(status.state),
        };
      });
      // Reconcile once the 202 lands: every WS push that raced the POST was
      // dropped by the attribution guard above (requestId still ''), so pull
      // the authoritative status — a download that finished inside that
      // window shows up as ready immediately instead of waiting for the next
      // push. Safe to await: refreshStatus swallows its own errors and
      // no-ops when the record was retired (reset/cancel) mid-flight.
      await get().refreshStatus();
    } catch (error) {
      // Server error codes (429 download_in_progress / 503
      // download_not_configured) surface as the reason on the sheet.
      get().markFailed(
        error instanceof Error ? error.message : 'Download request failed',
      );
    }
  },

  handleFileDownloadEvent: download => {
    const active = get().fileDownloadActive;
    // Ignore pushes we cannot attribute: a stale event after reset, or a
    // pre-restart request this client never started.
    if (!active || !download.requestId || download.requestId !== active.requestId) {
      return;
    }
    if (download.state === 'completed' || download.state === 'cancelled') {
      set({ fileDownloadActive: null, fileDownloadPhase: 'idle' });
      return;
    }
    const nextPhase = phaseFromStatus(download.state);
    // A duplicate ready/uploading push arriving after the download already
    // reached ready (or the sheet is saving / done) must not drag the phase
    // or the byte counter backwards — a stale snapshot (WS replay or a
    // lagging REST replica) reporting mid-upload progress is noise. Fields
    // that only move forward (url/reason) still merge.
    const current = get().fileDownloadPhase;
    const frozen =
      current === 'ready' || current === 'saving' || current === 'done';
    const holding =
      frozen && (nextPhase === 'ready' || nextPhase === 'uploading');
    set({
      fileDownloadActive: {
        ...active,
        uploadedBytes: holding
          ? Math.max(
              active.uploadedBytes,
              download.uploadedBytes ?? active.uploadedBytes,
            )
          : download.uploadedBytes ?? active.uploadedBytes,
        totalBytes: download.totalBytes ?? active.totalBytes,
        url: download.url ?? active.url,
        reason: download.reason ?? active.reason,
      },
      fileDownloadPhase: holding ? current : nextPhase,
    });
  },

  refreshStatus: async () => {
    const active = get().fileDownloadActive;
    // No record (or still awaiting the start POST) — nothing to reconcile.
    if (!active || !active.requestId) return;
    try {
      const status = await fetchProjectFileDownload(
        active.projectId,
        active.requestId,
      );
      get().handleFileDownloadEvent(
        toEventPayload(status, active.requestId),
      );
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 404) {
        // The request died with a server restart — drop the stale record.
        get().resetFileDownload();
        return;
      }
      // Transient network/server errors: leave the WS-driven state untouched.
    }
  },

  cancelDownload: async () => {
    const active = get().fileDownloadActive;
    if (!active) return;
    if (!active.requestId) {
      // Still requesting — the POST-in-flight guard in startDownload absorbs
      // the late 202; just retire the local record.
      set({ fileDownloadActive: null, fileDownloadPhase: 'idle' });
      return;
    }
    try {
      await cancelProjectFileDownload(active.projectId, active.requestId);
      set({ fileDownloadActive: null, fileDownloadPhase: 'cancelled' });
    } catch (error) {
      get().markFailed(
        error instanceof Error ? error.message : 'Failed to cancel download',
      );
    }
  },

  markSaving: () => set({ fileDownloadPhase: 'saving' }),
  markDone: () => set({ fileDownloadPhase: 'done' }),

  markFailed: reason => {
    set(state => ({
      fileDownloadActive: state.fileDownloadActive
        ? { ...state.fileDownloadActive, reason }
        : state.fileDownloadActive,
      fileDownloadPhase: 'failed',
    }));
  },

  resetFileDownload: () =>
    set({ fileDownloadActive: null, fileDownloadPhase: 'idle' }),
});

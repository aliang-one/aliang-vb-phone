import { apiGet, apiPost } from './client';

/**
 * Device-to-device file transfer (same account). The server orchestrates:
 * the source device packs the file and uploads to COS, the target device
 * pulls it into its inbox. The phone only creates/cancels/watches — bytes
 * never touch the phone.
 *
 * Wire shapes mirror the server's `publicTransfer` snake_case whitelist:
 * cos_key / upload_id / etags / user_id deliberately never leave the server.
 */

/** Server-side lifecycle (publicTransfer.state). */
export type TransferState =
  | 'pending'
  | 'uploading'
  | 'completing'
  | 'ready'
  | 'receiving'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface TransferStatus {
  transfer_id: string;
  filename: string;
  size_bytes: number;
  sha256?: string;
  is_directory_archive: boolean;
  state: TransferState;
  bytes_done: number;
  source_device_id: string;
  target_device_id: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  error_code?: string;
  error_message?: string;
  /** 目标设备回报的最终落盘绝对路径（done 后有值）。 */
  path?: string;
}

export interface StartTransferInput {
  source_device_id: string;
  target_device_id: string;
  source_path: string;
  filename: string;
  is_directory_archive?: boolean;
  /** Optional landing subdirectory under the target's inbox (fenced server-
   * and device-side). Empty/omitted = inbox root. */
  target_dir?: string;
}

/** Ask the server to orchestrate the transfer (201 + initial snapshot). */
export const startTransfer = (input: StartTransferInput): Promise<TransferStatus> =>
  apiPost<{ transfer: TransferStatus }>('/api/transfers', input).then(
    body => body.transfer,
  );

/** Reconcile one transfer's authoritative status (404 = unknown/foreign). */
export const fetchTransfer = (transferId: string): Promise<TransferStatus> =>
  apiGet<{ transfer: TransferStatus }>(
    `/api/transfers/${encodeURIComponent(transferId)}`,
  ).then(body => body.transfer);

/**
 * Cancel an in-flight transfer (idempotent on already-terminal rows; 409
 * once done — the snapshot came back anyway, like projects.ts complete).
 */
export const cancelTransfer = (transferId: string): Promise<TransferStatus> =>
  apiPost<{ transfer: TransferStatus }>(
    `/api/transfers/${encodeURIComponent(transferId)}/cancel`,
  ).then(body => body.transfer);

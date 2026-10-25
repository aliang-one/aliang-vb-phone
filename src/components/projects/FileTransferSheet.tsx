import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';
import { DevicePicker, type DevicePickerEntry } from '../terminal/DevicePicker';
import { formatBytes } from '../../utils/format';
import { useControlCenterStore } from '../../store/controlCenterStore';
import type { ProjectFileEntry } from '../../store/types';
import type { Device } from '../../data/platformModels';

/**
 * Map a server transfer failure code (carried on `active.reason`) to a
 * friendly i18n key. Unknown codes return null — the caller shows the raw
 * reason so the user still gets the server's words for unmapped failures.
 */
export function transferReasonKey(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.includes('device_capability_unsupported')) {
    return 'fileBrowser.transfer.capabilityDetail';
  }
  if (reason.includes('self_transfer_not_allowed')) {
    return 'fileBrowser.transfer.selfDetail';
  }
  if (reason.includes('pair_busy')) {
    return 'fileBrowser.transfer.busyDetail';
  }
  if (reason.includes('transfer_disabled')) {
    return 'fileBrowser.transfer.disabledDetail';
  }
  return null;
}

interface FileTransferSheetProps {
  /** File picked via the long-press menu; null once the caller closes the sheet. */
  pendingFile: ProjectFileEntry | null;
  /** The device the file lives on (source of the transfer). */
  sourceDevice: Device;
  /** Every account device — filtered down to online non-source targets. */
  devices: Device[];
  onClose: () => void;
}

/**
 * Target-picker / progress / failure sheet for a device-to-device transfer.
 * Lives next to the download menu item (long-press a file → 下载 / 同步到别的
 * 设备). The bytes go source device → COS → target device; the phone only
 * orchestrates and watches.
 *
 * Phase → body mapping:
 *   idle                    confirm (file facts + target device picker)
 *   requesting              "发起同步…" (no transferId yet)
 *   transferring            progress bar (coarse snapshots) + cancel
 *   failed                  reason (known codes → friendly copy) + retry
 *   done                    "已同步" + close (close resets the store phase)
 *   cancelled               transient — the sheet resets and closes itself
 *
 * Progress cadence: the server only pushes `transfer.updated` on state
 * changes (per-byte progress frames stay device↔server), so while
 * transferring we reconcile with GET /api/transfers/:id on a slow interval
 * as a progress backstop on top of the WS snapshots.
 */
export const FileTransferSheet: React.FC<FileTransferSheetProps> = ({
  pendingFile,
  sourceDevice,
  devices,
  onClose,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation(['projects', 'common']);
  const phase = useControlCenterStore(state => state.transferPhase);
  const active = useControlCenterStore(state => state.transferActive);
  const startTransferAction = useControlCenterStore(state => state.startTransfer);
  const cancelTransferAction = useControlCenterStore(state => state.cancelTransfer);
  const refreshTransferStatus = useControlCenterStore(state => state.refreshTransferStatus);
  const resetTransfer = useControlCenterStore(state => state.resetTransfer);

  // Candidate targets: same account, online, not the source itself. The
  // server rejects self-transfers (409) — filter it here so the picker
  // cannot even offer it.
  const targets = useMemo<DevicePickerEntry[]>(
    () =>
      devices
        .filter(item => item.id !== sourceDevice.id && item.status === 'online')
        .map(item => ({
          id: item.id,
          name: item.name,
          platform: item.os,
          online: item.status === 'online',
          cwd: '',
        })),
    [devices, sourceDevice.id],
  );
  const [targetId, setTargetId] = useState<string | undefined>(undefined);
  useEffect(() => {
    // Re-seed when the candidate set changes (sheet open/close, devices refresh).
    setTargetId(previous =>
      previous && targets.some(entry => entry.id === previous)
        ? previous
        : targets[0]?.id,
    );
  }, [targets]);

  const open = pendingFile !== null || phase !== 'idle';
  const title = pendingFile?.name ?? active?.filename;
  const subtitle = pendingFile?.path ?? active?.sourcePath;

  // Retry reuses the pending file when the caller still holds it, else the
  // active record the failed attempt left behind.
  const retryTarget = pendingFile
    ? { path: pendingFile.path, name: pendingFile.name }
    : active
    ? { path: active.sourcePath, name: active.filename }
    : null;

  // Low-frequency reconcile while a transfer runs: WS pushes only fire on
  // state changes, so without this the progress bar would jump 0→100.
  const transferring = phase === 'requesting' || phase === 'transferring';
  useEffect(() => {
    if (!transferring) return;
    const timer = setInterval(() => {
      void refreshTransferStatus();
    }, 10_000);
    return () => clearInterval(timer);
  }, [transferring, refreshTransferStatus]);

  const handleConfirm = () => {
    if (!pendingFile || !targetId) return;
    // Phase flips come from the store — never await-and-set UI state here.
    void startTransferAction({
      sourceDeviceId: sourceDevice.id,
      targetDeviceId: targetId,
      sourcePath: pendingFile.path,
      filename: pendingFile.name,
      isDirectoryArchive: false,
    });
  };

  const handleCancel = () => {
    void cancelTransferAction();
    onClose();
  };

  const handleRetry = () => {
    if (!retryTarget || !targetId) return;
    void startTransferAction({
      sourceDeviceId: sourceDevice.id,
      targetDeviceId: targetId,
      sourcePath: retryTarget.path,
      filename: retryTarget.name,
      isDirectoryArchive: false,
    });
  };

  // Terminal-but-not-idle phases have no background task left to preserve:
  // reset so the `open` condition can go false.
  const handleClose = () => {
    if (phase === 'done' || phase === 'cancelled' || phase === 'failed') {
      resetTransfer();
    }
    onClose();
  };

  // `cancelled` (set by cancelTransfer or a foreign cancel push) is
  // transient — close the sheet the moment it lands.
  useEffect(() => {
    if (phase !== 'cancelled') return;
    resetTransfer();
    onClose();
  }, [phase, resetTransfer, onClose]);

  const renderConfirm = () => (
    <View style={styles.body}>
      <View style={styles.facts}>
        <Text
          style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}
          numberOfLines={1}>
          {pendingFile?.path}
        </Text>
        <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
          {formatBytes(pendingFile?.sizeBytes)}
        </Text>
        <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
          {t('fileBrowser.transfer.sourceLabel', { name: sourceDevice.name })}
        </Text>
      </View>
      {targets.length > 0 ? (
        <>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {t('fileBrowser.transfer.targetLabel')}
          </Text>
          <DevicePicker entries={targets} selectedId={targetId} onSelect={entry => setTargetId(entry.id)} />
        </>
      ) : (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {t('fileBrowser.transfer.noTargets')}
        </Text>
      )}
      <GlowButton
        title={t('fileBrowser.transfer.confirmAction')}
        onPress={handleConfirm}
        disabled={targets.length === 0 || !targetId}
        style={styles.action}
      />
      <GlowButton
        title={t('common:close')}
        onPress={onClose}
        variant="outline"
        style={styles.action}
      />
    </View>
  );

  const renderTransferring = () => {
    const totalBytes = active?.totalBytes ?? 0;
    const bytesDone = active?.bytesDone ?? 0;
    const percent =
      totalBytes > 0 ? Math.round((bytesDone / totalBytes) * 100) : null;
    return (
      <View style={styles.body}>
        <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
          {t('fileBrowser.transfer.transferring')}
        </Text>
        <View
          style={[
            styles.track,
            { backgroundColor: theme.colors.surfaceContainerHighest },
          ]}>
          {percent !== null ? (
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.min(100, Math.max(0, percent))}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
          ) : null}
        </View>
        {percent !== null ? (
          <>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {percent}%
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {formatBytes(bytesDone)} / {formatBytes(totalBytes)}
            </Text>
          </>
        ) : null}
        <GlowButton
          title={t('fileBrowser.transfer.cancel')}
          onPress={handleCancel}
          variant="outline"
          style={styles.action}
        />
      </View>
    );
  };

  const renderFailed = () => {
    const reason = active?.reason;
    const key = transferReasonKey(reason);
    const detail = key ? t(key) : reason;
    return (
      <View style={styles.body}>
        <Text style={[theme.typography.titleMd, { color: theme.colors.error }]}>
          {t('fileBrowser.transfer.failedTitle')}
        </Text>
        {detail ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {detail}
          </Text>
        ) : null}
        {retryTarget && targets.length > 0 && targetId ? (
          <GlowButton
            title={t('fileBrowser.transfer.retry')}
            onPress={handleRetry}
            style={styles.action}
          />
        ) : null}
        <GlowButton
          title={t('common:close')}
          onPress={handleClose}
          variant="outline"
          style={styles.action}
        />
      </View>
    );
  };

  const renderDone = () => (
    <View style={styles.body}>
      <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
        {t('fileBrowser.transfer.doneTitle')}
      </Text>
      <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
        {t('fileBrowser.transfer.doneDetail', {
          name: targets.find(entry => entry.id === (active?.targetDeviceId ?? targetId))?.name ?? '',
        })}
      </Text>
      <GlowButton
        title={t('common:close')}
        onPress={handleClose}
        style={styles.action}
      />
    </View>
  );

  const renderBody = () => {
    switch (phase) {
      case 'requesting':
      case 'transferring':
        return renderTransferring();
      case 'failed':
        return renderFailed();
      case 'done':
        return renderDone();
      default:
        return renderConfirm();
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title={title}
      subtitle={subtitle}
      badge={{ label: t('fileBrowser.transfer.menuItem'), tone: 'neutral' }}>
      {renderBody()}
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: {
    padding: 16,
    gap: 12,
  },
  facts: {
    gap: 6,
  },
  action: {
    marginTop: 4,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
});

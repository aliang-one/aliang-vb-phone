import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';
import { formatBytes } from '../../utils/format';
import { useControlCenterStore } from '../../store/controlCenterStore';
import type { ProjectFileEntry } from '../../store/types';

/**
 * Map a server download failure code (carried on `active.reason`) to a friendly
 * i18n key. Unknown codes return null — the caller shows the raw reason so the
 * user still gets the server's words for unmapped failures.
 */
export function downloadReasonKey(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.includes('download_in_progress')) {
    return 'fileBrowser.download.inProgressDetail';
  }
  if (reason.includes('download_not_configured')) {
    return 'fileBrowser.download.notConfiguredDetail';
  }
  if (reason.includes('file_too_large')) {
    return 'fileBrowser.download.tooLargeDetail';
  }
  return null;
}

interface FileDownloadSheetProps {
  /** File picked via the long-press menu; null once the caller closes the sheet. */
  pendingFile: ProjectFileEntry | null;
  projectId: string;
  onClose: () => void;
}

/**
 * Confirm / progress / failure sheet for a single file download (Task 16).
 *
 * Visibility: `pendingFile` (confirm hand-off) OR a non-idle store phase — so
 * closing the sheet mid-download merely abandons the UI (the background task
 * keeps running and re-opens the sheet on the next long-press) while the
 * cancel button is the explicit way out of a running download.
 *
 * Phase → body mapping:
 *   idle                    confirm (file facts + size gate + destination copy)
 *   requesting / uploading  progress bar + percent (indeterminate w/o totalBytes)
 *   ready / saving          "Downloading…" — the local save phase (Task 17)
 *   failed                  reason (known codes → friendly copy) + retry
 *   done                    "Saved" + close (close resets the store phase)
 *   cancelled               transient — the sheet resets and closes itself
 */
export const FileDownloadSheet: React.FC<FileDownloadSheetProps> = ({
  pendingFile,
  projectId,
  onClose,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation(['projects', 'common']);
  const phase = useControlCenterStore(state => state.fileDownloadPhase);
  const active = useControlCenterStore(state => state.fileDownloadActive);
  const capability = useControlCenterStore(state => state.fileDownloadCapability);
  const startDownload = useControlCenterStore(state => state.startDownload);
  const cancelDownload = useControlCenterStore(state => state.cancelDownload);
  const resetFileDownload = useControlCenterStore(state => state.resetFileDownload);

  const open = pendingFile !== null || phase !== 'idle';
  const title = pendingFile?.name ?? active?.filename;
  const subtitle = pendingFile?.path ?? active?.path;

  // Pre-flight size gate against the server capability. A file already over
  // the limit cannot pass the 413 anyway — disable instead of letting the
  // user start a doomed request.
  const maxBytes = capability?.max_bytes ?? 0;
  const limitLabel = formatBytes(maxBytes);
  const tooLarge =
    pendingFile !== null &&
    maxBytes > 0 &&
    (pendingFile.sizeBytes ?? 0) > maxBytes;

  // Retry reuses the pending file when the caller still holds it, else the
  // active record the failed attempt left behind.
  const retryTarget = pendingFile
    ? { path: pendingFile.path, name: pendingFile.name }
    : active
    ? { path: active.path, name: active.filename }
    : null;

  const handleConfirm = () => {
    if (!pendingFile) return;
    // Phase flips come from the store — never await-and-set UI state here.
    void startDownload(projectId, pendingFile.path, pendingFile.name);
  };

  const handleCancel = () => {
    void cancelDownload();
    onClose();
  };

  const handleRetry = () => {
    if (!retryTarget) return;
    void startDownload(projectId, retryTarget.path, retryTarget.name);
  };

  // Terminal-but-not-idle phases have no background task left to preserve:
  // reset so the `open` condition can go false. Running phases keep their
  // store state — closing then only abandons the UI (the sheet re-opens on
  // the next long-press while the download continues).
  const handleClose = () => {
    if (phase === 'done' || phase === 'cancelled' || phase === 'failed') {
      resetFileDownload();
    }
    onClose();
  };

  // `cancelled` (set by cancelDownload) is transient — close the sheet the
  // moment it lands instead of rendering an empty body for it.
  useEffect(() => {
    if (phase !== 'cancelled') return;
    resetFileDownload();
    onClose();
  }, [phase, resetFileDownload, onClose]);

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
        <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
          {pendingFile?.language}
        </Text>
        <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
          {t(
            Platform.OS === 'android'
              ? 'fileBrowser.download.destinationAndroid'
              : 'fileBrowser.download.destinationIos',
          )}
        </Text>
        {tooLarge ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
            {t('fileBrowser.download.tooLargeDetail', { limit: limitLabel })}
          </Text>
        ) : null}
      </View>
      <GlowButton
        title={t('fileBrowser.download.confirmAction')}
        onPress={handleConfirm}
        disabled={tooLarge}
        style={styles.action}
      />
      <GlowButton
        title={t('fileBrowser.download.cancel')}
        onPress={onClose}
        variant="outline"
        style={styles.action}
      />
    </View>
  );

  const renderUploading = () => {
    const totalBytes = active?.totalBytes ?? 0;
    const uploadedBytes = active?.uploadedBytes ?? 0;
    const percent =
      totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : null;
    return (
      <View style={styles.body}>
        <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
          {t('fileBrowser.download.uploading')}
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
              {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
            </Text>
          </>
        ) : null}
        <GlowButton
          title={t('fileBrowser.download.cancel')}
          onPress={handleCancel}
          variant="outline"
          style={styles.action}
        />
      </View>
    );
  };

  const renderDownloading = () => (
    <View style={styles.body}>
      <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
        {t('fileBrowser.download.downloading')}
      </Text>
      <GlowButton
        title={t('fileBrowser.download.cancel')}
        onPress={handleCancel}
        variant="outline"
        style={styles.action}
      />
    </View>
  );

  const renderFailed = () => {
    const reason = active?.reason;
    const key = downloadReasonKey(reason);
    const detail = key ? t(key, { limit: limitLabel }) : reason;
    return (
      <View style={styles.body}>
        <Text style={[theme.typography.titleMd, { color: theme.colors.error }]}>
          {t('fileBrowser.download.failedTitle')}
        </Text>
        {detail ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {detail}
          </Text>
        ) : null}
        {retryTarget ? (
          <GlowButton
            title={t('fileBrowser.download.retry')}
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
        {t('fileBrowser.download.doneTitle')}
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
      case 'uploading':
        return renderUploading();
      case 'ready':
      case 'saving':
        return renderDownloading();
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
      badge={{ label: t('fileBrowser.download.menuItem'), tone: 'neutral' }}>
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

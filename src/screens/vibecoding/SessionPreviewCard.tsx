/**
 * Session preview card with optional auto-created public tunnel mapping.
 * Pure presentational: data in via `preview`, actions out via callbacks.
 * - mapped:    公网 badge + publicUrl + copy/open/revoke
 * - failed/unavailable: neutral notice line (agent shortUrl unaffected)
 * - revoked:   grey chip, action buttons removed (already-copied links may
 *              resolve until gateway expiry — that's the user's copy, not ours)
 * State convergence is server-authoritative: revoke DELETE 联动广播
 * preview.updated，store 收敛本组件的 preview prop（本地不做乐观翻转）。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import type { PreviewLink } from '../../data/platformModels';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { useTheme } from '../../theme/useTheme';

interface SessionPreviewCardProps {
  preview: PreviewLink;
  /** Legacy behaviour: tapping the card opens the full Preview screen. */
  onNavigate: () => void;
  /** Performs the DELETE; the preview.updated broadcast converges `preview`. */
  onRevoke: () => Promise<void>;
}

export const SessionPreviewCard: React.FC<SessionPreviewCardProps> = ({
  preview,
  onNavigate,
  onRevoke,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const publicUrl = preview.publicUrl;
  const status = preview.mappingStatus;
  const showActions = status === 'mapped' && !!publicUrl;

  const handleCopy = () => {
    if (!publicUrl) return;
    Clipboard.setString(publicUrl);
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopied(false);
    }, 1800);
  };

  const handleOpen = async () => {
    if (!publicUrl) return;
    try {
      await Linking.openURL(publicUrl);
    } catch {
      // Best-effort: this card has no error channel; PortMappingsScreen owns
      // the full mapping surface for detailed feedback.
    }
  };

  const confirmRevoke = () => {
    Alert.alert(
      t('sessionPreview.revokeTitle'),
      t('sessionPreview.revokeBody'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('sessionPreview.revoke'),
          style: 'destructive',
          onPress: () => {
            void onRevoke();
          },
        },
      ],
    );
  };

  return (
    <View>
      <TouchableOpacity activeOpacity={0.75} onPress={onNavigate}>
        <GlassPanel glowColor="primary" style={styles.card}>
          <View style={styles.top}>
            <Text
              style={[
                theme.typography.titleMd,
                { color: theme.colors.onSurface },
              ]}>
              Preview ready
            </Text>
            <StatusChip label={`${preview.port}`} type="info" />
          </View>
          <Text
            style={[
              theme.typography.codeSm,
              { color: theme.colors.primary },
            ]}>
            {preview.shortUrl}
          </Text>
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {preview.access.toUpperCase()} / expires in {preview.expiresIn}
          </Text>
          {status === 'mapped' && publicUrl ? (
            <View style={styles.publicRow}>
              <StatusChip
                label={t('sessionPreview.publicBadge')}
                type="success"
              />
              <Text
                selectable
                numberOfLines={1}
                style={[
                  theme.typography.codeSm,
                  styles.publicUrl,
                  { color: theme.colors.primary },
                ]}>
                {publicUrl}
              </Text>
            </View>
          ) : null}
          {status === 'failed' || status === 'unavailable' ? (
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {preview.mappingError
                ? `${t('sessionPreview.failed')} · ${preview.mappingError}`
                : t('sessionPreview.failed')}
            </Text>
          ) : null}
          {status === 'revoked' ? (
            <StatusChip label={t('sessionPreview.revoked')} type="neutral" />
          ) : null}
        </GlassPanel>
      </TouchableOpacity>
      {showActions ? (
        // Outside the navigation TouchableOpacity so taps don't open Preview.
        <View style={styles.actionsRow}>
          <TouchableOpacity
            testID="preview-copy-public"
            accessibilityRole="button"
            accessibilityLabel={t('sessionPreview.copy')}
            activeOpacity={0.68}
            style={styles.actionButton}
            onPress={handleCopy}>
            <Text
              style={[
                theme.typography.labelSm,
                {
                  color: copied ? theme.colors.primary : theme.colors.onSurface,
                },
              ]}>
              {copied ? t('sessionPreview.copied') : t('sessionPreview.copy')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="preview-open-public"
            accessibilityRole="button"
            accessibilityLabel={t('sessionPreview.open')}
            activeOpacity={0.68}
            style={styles.actionButton}
            onPress={() => {
              void handleOpen();
            }}>
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurface },
              ]}>
              {t('sessionPreview.open')}
            </Text>
          </TouchableOpacity>
          <View style={styles.actionSpacer} />
          <TouchableOpacity
            testID="preview-revoke"
            accessibilityRole="button"
            accessibilityLabel={t('sessionPreview.revoke')}
            activeOpacity={0.68}
            style={styles.actionButton}
            onPress={confirmRevoke}>
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.error },
              ]}>
              {t('sessionPreview.revoke')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  publicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  publicUrl: {
    flex: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  actionSpacer: {
    flex: 1,
  },
});

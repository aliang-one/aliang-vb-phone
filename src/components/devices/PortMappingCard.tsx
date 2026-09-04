import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { PortMapping } from '../../api/portMappings';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { IconBadge, IconName } from '../visual/IconBadge';
import { useTheme } from '../../theme/useTheme';

// Effective display status: server status first, then wall-clock expiry
// (the sweeper may not have flipped an elapsed mapping yet). Shared with
// useProjectPortMappings, which counts "转发中" mappings off this helper.
export const effectiveStatus = (mapping: PortMapping) => {
  if (mapping.status === 'revoked') return 'revoked' as const;
  if (new Date(mapping.expires_at).getTime() <= Date.now()) {
    return 'expired' as const;
  }
  return 'active' as const;
};

export interface PortMappingCardProps {
  mapping: PortMapping;
  copied: boolean;
  revoking: boolean;
  onCopy: () => void;
  onOpen: () => void;
  onRevoke: () => void;
}

export const PortMappingCard = ({
  mapping,
  copied,
  revoking,
  onCopy,
  onOpen,
  onRevoke,
}: PortMappingCardProps) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('devices');
  const status = effectiveStatus(mapping);
  const active = status === 'active';
  const statusType = active ? 'success' : 'neutral';
  const urlSurfaceStyle = {
    backgroundColor: isDark
      ? 'rgba(0,0,0,0.20)'
      : theme.colors.surfaceContainerLow,
    borderRadius: theme.borderRadius.sm,
  };

  return (
    <GlassPanel style={styles.mappingCard} glowColor={active ? 'primary' : 'none'}>
      <View style={styles.mappingHeader}>
        <View style={styles.mappingTarget}>
          <IconBadge
            name="port"
            tone={active ? 'primary' : 'neutral'}
            size={36}
            iconSize={18}
          />
          <View style={styles.mappingTargetCopy}>
            <Text
              style={[theme.typography.codeMd, { color: theme.colors.onSurface }]}>
              {t('portMappings.target', {
                host: mapping.target_host,
                port: mapping.target_port,
              })}
            </Text>
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {t('portMappings.expires', {
                time: new Date(mapping.expires_at).toLocaleString(),
              })}
            </Text>
          </View>
        </View>
        <StatusChip label={t(`portMappings.${status}`)} type={statusType} />
      </View>

      {mapping.tag?.project_name ? (
        <View style={styles.tagRow}>
          <StatusChip label={mapping.tag.project_name} type="info" />
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {t(
              mapping.tag.source === 'session_preview'
                ? 'portMappings.sourceSessionPreview'
                : mapping.tag.source === 'project_manual'
                ? 'portMappings.sourceProjectManual'
                : 'portMappings.sourceDeviceManual',
            )}
          </Text>
        </View>
      ) : null}

      <View style={[styles.urlRow, urlSurfaceStyle]}>
        <Text
          selectable
          numberOfLines={2}
          style={[
            theme.typography.codeSm,
            styles.url,
            { color: active ? theme.colors.primary : theme.colors.onSurfaceVariant },
          ]}>
          {mapping.short_url}
        </Text>
        {copied ? (
          <Text style={[theme.typography.labelCaps, { color: theme.colors.success }]}>
            {t('portMappings.copied')}
          </Text>
        ) : null}
      </View>

      <View style={styles.mappingActions}>
        <IconAction
          name="copy"
          label={t('portMappings.copy')}
          disabled={!active}
          onPress={onCopy}
        />
        <IconAction
          name="external"
          label={t('portMappings.open')}
          disabled={!active}
          onPress={onOpen}
        />
        <View style={styles.actionSpacer} />
        <IconAction
          name="trash"
          label={t('portMappings.revoke')}
          tone="error"
          loading={revoking}
          disabled={!active}
          onPress={onRevoke}
        />
      </View>
    </GlassPanel>
  );
};

interface IconActionProps {
  name: IconName;
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'error';
  loading?: boolean;
  disabled?: boolean;
}

const IconAction = ({
  name,
  label,
  onPress,
  tone = 'primary',
  loading = false,
  disabled = false,
}: IconActionProps) => {
  const { theme, isDark } = useTheme();
  const actionStyle = {
    borderColor: isDark
      ? 'rgba(255,255,255,0.10)'
      : theme.colors.outlineVariant,
    backgroundColor: isDark
      ? 'rgba(255,255,255,0.04)'
      : theme.colors.surfaceContainerLow,
    borderRadius: theme.borderRadius.sm,
    opacity: disabled ? 0.38 : 1,
  };
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.68}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.iconAction, actionStyle]}>
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.error} />
      ) : (
        <IconBadge
          name={name}
          tone={tone}
          size={28}
          iconSize={15}
          style={styles.iconBadgeBorderless}
        />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  mappingCard: {
    padding: 12,
    gap: 11,
    marginBottom: 10,
  },
  mappingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mappingTarget: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mappingTargetCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  urlRow: {
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  url: {
    flex: 1,
    minWidth: 0,
  },
  mappingActions: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionSpacer: {
    flex: 1,
  },
  iconAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconBadgeBorderless: {
    borderWidth: 0,
  },
});

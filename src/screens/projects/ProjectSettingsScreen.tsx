import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { IconBadge } from '../../components/visual/IconBadge';
import { ApprovalPolicyCard } from '../../components/devices/ApprovalPolicyCard';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { useTranslation } from 'react-i18next';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type ProjectSettingsRoute = RouteProp<RootStackParamList, 'ProjectSettings'>;

export const ProjectSettingsScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('projects');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<ProjectSettingsRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const refreshFromServer = useControlCenterStore(
    state => state.refreshFromServer,
  );
  const [refreshing, setRefreshing] = useState(false);

  const project = projects.find(item => item.id === route.params.projectId);
  const device =
    devices.find(item => item.id === route.params.deviceId) ||
    devices.find(item => project?.deviceId && item.id === project.deviceId) ||
    devices.find(item => item.projectIds.includes(route.params.projectId));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshFromServer();
    } finally {
      setRefreshing(false);
    }
  }, [refreshFromServer]);

  if (!project) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title={t('projectSettings.title')} subtitle={t('projectSettings.notFoundSubtitle')} onBack={navigation.goBack} />
      </SafeAreaWrapper>
    );
  }

  const approvalScheme = project.approvalScheme ?? 'balanced';
  const approvalSchemeLabel =
    approvalScheme === 'allow_all'
      ? t('projectSettings.scheme.allowAll')
      : approvalScheme === 'custom'
      ? t('projectSettings.scheme.custom')
      : t('projectSettings.scheme.balanced');
  const summaryMetaCellStyle = [
    styles.summaryMetaCell,
    {
      borderRadius: theme.borderRadius.md,
      borderColor: isDark
        ? 'rgba(255,255,255,0.08)'
        : theme.colors.outlineVariant,
      backgroundColor: isDark
        ? 'rgba(255,255,255,0.04)'
        : theme.colors.surfaceContainerLow,
    },
  ];

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={t('projectSettings.title')}
        subtitle={project.name}
        onBack={navigation.goBack}
      />
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.scrollView}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }>
          <GlassPanel style={styles.summaryPanel}>
            <View style={styles.summaryHead}>
              <View style={styles.summaryTitleRow}>
                <IconBadge name="settings" tone="primary" size={40} iconSize={20} />
                <View style={styles.summaryCopy}>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.titleMd,
                      { color: theme.colors.onSurface },
                    ]}>
                    {project.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.bodySm,
                      { color: theme.colors.onSurfaceVariant },
                    ]}>
                    {device?.name ?? t('projectSettings.noDevice')} · {project.path || '~'}
                  </Text>
                </View>
              </View>
              <StatusChip
                label={project.status.toUpperCase()}
                type={
                  project.status === 'active'
                    ? 'success'
                    : project.status === 'error'
                    ? 'error'
                    : 'neutral'
                }
              />
            </View>
            <View style={styles.summaryMetaRow}>
              <View style={summaryMetaCellStyle}>
                <Text
                  style={[
                    theme.typography.labelCaps,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {t('projectSettings.approval')}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurface },
                  ]}>
                  {approvalSchemeLabel}
                </Text>
              </View>
            </View>
          </GlassPanel>

          <ApprovalPolicyCard
            projectId={project.id}
            scheme={approvalScheme}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 48,
  },
  summaryPanel: {
    padding: 14,
    gap: 12,
    marginBottom: 14,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  summaryMetaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryMetaCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    borderWidth: 1,
  },
});

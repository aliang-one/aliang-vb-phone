import React from 'react';
import { Linking, View, Text, StyleSheet, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type PreviewRoute = RouteProp<RootStackParamList, 'Preview'>;

export const PreviewScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<PreviewRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const previewLinks = useControlCenterStore(state => state.previewLinks);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const preview =
    previewLinks.find(item => item.id === route.params.previewId) ??
    previewLinks[0];
  const session = vibeRuns.find(item => item.id === preview.sessionId);
  const project = session
    ? projects.find(item => item.id === session.projectId)
    : undefined;
  const device = session
    ? devices.find(item => item.id === session.deviceId)
    : undefined;
  const displayTitle = formatVibeSessionTitle(
    session?.title ?? 'Remote preview',
    {
      directory: session?.directory,
      projectName: project?.name,
    },
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Preview"
        subtitle={project?.name ?? preview.targetUrl}
        onBack={navigation.goBack}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        <GlassPanel glowColor="primary" style={styles.browserFrame}>
          <View style={styles.browserTop}>
            <View style={styles.dotRow}>
              <View style={[styles.dot, { backgroundColor: '#ff6b6b' }]} />
              <View style={[styles.dot, { backgroundColor: '#feb127' }]} />
              <View style={[styles.dot, { backgroundColor: '#2ff801' }]} />
            </View>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}
              numberOfLines={1}
            >
              {preview.shortUrl}
            </Text>
          </View>
          <View
            style={[
              styles.previewSurface,
              {
                backgroundColor: isDark
                  ? 'rgba(0,0,0,0.35)'
                  : theme.colors.surfaceContainer,
              },
            ]}
          >
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.primary },
              ]}
            >
              LIVE PORT {preview.port}
            </Text>
            <Text
              style={[
                theme.typography.headlineMd,
                { color: theme.colors.onSurface },
                styles.previewTitle,
              ]}
            >
              {displayTitle}
            </Text>
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onSurfaceVariant },
                styles.previewCopy,
              ]}
            >
              {session?.currentStep ?? preview.targetUrl}
            </Text>
            <View style={styles.placeholderScreen}>
              <View style={styles.placeholderHeader} />
              <View style={styles.placeholderRow} />
              <View
                style={[styles.placeholderRow, styles.placeholderRowShort]}
              />
              <View style={styles.placeholderGrid}>
                <View style={styles.placeholderTile} />
                <View style={styles.placeholderTile} />
              </View>
            </View>
          </View>
        </GlassPanel>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}
        >
          LINK DETAILS
        </Text>
        <GlassPanel style={styles.detailPanel}>
          <DetailRow label="Short link" value={preview.shortUrl} />
          <View style={styles.divider} />
          <DetailRow label="Target" value={preview.targetUrl} />
          <View style={styles.divider} />
          <DetailRow label="Access" value={preview.access.toUpperCase()} />
          <View style={styles.divider} />
          <DetailRow label="Expires" value={preview.expiresIn} />
        </GlassPanel>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}
        >
          SOURCE
        </Text>
        <GlassPanel style={styles.sourcePanel}>
          <View style={styles.sourceRow}>
            <Text
              style={[
                theme.typography.bodyMd,
                { color: theme.colors.onSurface },
              ]}
            >
              Device
            </Text>
            <StatusChip
              label={device?.status.toUpperCase() ?? 'UNKNOWN'}
              type="info"
            />
          </View>
          <Text
            style={[
              theme.typography.codeSm,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {device?.name ?? 'Unknown device'}
          </Text>
          <Text
            style={[theme.typography.codeSm, { color: theme.colors.primary }]}
          >
            {session?.branch ?? 'preview branch'}
          </Text>
        </GlassPanel>

        <View style={styles.actions}>
          <GlowButton
            title="OPEN PREVIEW"
            onPress={() => Linking.openURL(preview.targetUrl)}
            variant="primary"
            style={styles.action}
          />
          <GlowButton
            title="REVOKE"
            onPress={() => {}}
            variant="outline"
            style={styles.action}
          />
        </View>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

interface DetailRowProps {
  label: string;
  value: string;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value }) => {
  const { theme } = useTheme();

  return (
    <View style={styles.detailRow}>
      <Text
        style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}
      >
        {label}
      </Text>
      <Text
        style={[
          theme.typography.codeSm,
          { color: theme.colors.onSurfaceVariant },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 12,
  },
  browserFrame: {
    minHeight: 360,
  },
  browserTop: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  dotRow: {
    flexDirection: 'row',
    gap: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewSurface: {
    minHeight: 318,
    padding: 16,
  },
  previewTitle: {
    marginTop: 8,
  },
  previewCopy: {
    marginTop: 8,
  },
  placeholderScreen: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 14,
    gap: 12,
  },
  placeholderHeader: {
    width: '58%',
    height: 18,
    borderRadius: 4,
    backgroundColor: 'rgba(86, 156, 214, 0.35)',
  },
  placeholderRow: {
    width: '100%',
    height: 12,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  placeholderRowShort: {
    width: '72%',
  },
  placeholderGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  placeholderTile: {
    flex: 1,
    height: 74,
    borderRadius: 8,
    backgroundColor: 'rgba(204, 204, 204, 0.08)',
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  detailPanel: {
    padding: 0,
  },
  detailRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginHorizontal: 12,
  },
  sourcePanel: {
    padding: 12,
    gap: 8,
  },
  sourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  action: {
    flex: 1,
  },
});

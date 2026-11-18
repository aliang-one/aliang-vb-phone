import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { RootStackParamList } from '../../app/navigation/types';
import {
  useControlCenterStore,
  useDevice,
  useVibeRun,
} from '../../store/controlCenterStore';
import {
  catalogModelOptions,
  degradeEffort,
  intensityToEffort,
  parseModelIntensity,
  providerLabel,
  supportedEffortsFor,
  type EffortProvider,
} from '../../utils/modelIntensity';
import { catalogEffortOptions, useModelOptions } from '../../hooks/useModelOptions';
import { useRecentModelOptions } from '../../hooks/useRecentModelOptions';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionSettingsRoute = RouteProp<RootStackParamList, 'SessionSettings'>;

// 内核审批挡位线格式(2026-11-15 三端统一,与 api/sessions.ts ServerAiSession
// 的 approval_mode 词表一致)。
type ApprovalModeWire = '' | 'ask_all' | 'bypass_all' | 'read_only';

// Resolve the effort-provider discriminant from a session, falling back to the
// model label only for legacy snapshots that lack the authoritative field.
const resolveProvider = (
  provider?: EffortProvider,
  model?: string,
): EffortProvider =>
  provider ??
  (model?.toLowerCase().includes('codex')
    ? 'codex'
    : model?.toLowerCase().includes('opencode')
      ? 'opencode'
      : 'claude_code');

export const SessionSettingsScreen: React.FC = () => {
  const { t } = useTranslation('vibecoding');
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<SessionSettingsRoute>();
  const session = useVibeRun(route.params.sessionId);
  const updateAgentSession = useControlCenterStore(
    state => state.updateAgentSession,
  );
  const device = useDevice(session?.deviceId);

  const provider = resolveProvider(session?.provider, session?.model);
  // 设备 CLI 实测支持的 effort 档(agent 能力上报)→ 置灰 + 保存钳制。
  // undefined = 未上报,不设障。
  const supportedEfforts = useMemo(
    () => supportedEffortsFor(device?.tools, provider),
    [device?.tools, provider],
  );
  // Live catalog drives the effort chips (codex 4, claude 6) with a hardcoded
  // fallback before it loads.
  const { providerCatalog } = useModelOptions();
  const effortOptions = catalogEffortOptions(provider, providerCatalog);
  // 内核审批挡位(approval_mode)——2026-11-15 三端统一:挡位是唯一权威
  // (内核执行语义),手机在此可编辑(PATCH approval_mode),网页权限面板与
  // 内核同步生效。原 approvalScheme(创建页那套)已映射收敛到挡位,不再
  // 独立展示。'' = 默认推荐(项目策略现状)。
  const approvalChips = useMemo(
    () => [
      { label: t('sessionSettings.approvalDefault'), value: '' },
      { label: t('sessionSettings.approvalReadOnly'), value: 'read_only' },
      { label: t('sessionSettings.approvalAskAll'), value: 'ask_all' },
      { label: t('sessionSettings.approvalBypassAll'), value: 'bypass_all' },
    ],
    [t],
  );
  const approvalModeLabel = session?.approvalMode || t('sessionSettings.approvalDefault');
  // Provider-aware model chips (codex: gpt-5.4/5.5, claude_code: glm-5.1/5.2),
  // led by "默认" (clear → inherit).
  const serverModelOptions = useMemo(
    () => catalogModelOptions(provider, providerCatalog),
    [provider, providerCatalog],
  );
  const { modelOptions: recentFirstModelOptions, rememberModel } =
    useRecentModelOptions(provider, serverModelOptions);
  const modelOptions = useMemo(
    () => [
      { label: t('sessionSettings.defaultChip'), value: '' },
      ...recentFirstModelOptions,
    ],
    [recentFirstModelOptions, t],
  );
  const effective = session?.effectiveModelConfig;
  const userDefaultLabel = t('sessionSettings.userDefault');
  const effectiveLabel = effective
    ? [
        `model=${effective.model || userDefaultLabel}`,
        effective.source?.model ? `(${effective.source.model})` : '',
        `· effort=${effective.effort || userDefaultLabel}`,
        effective.source?.effort ? `(${effective.source.effort})` : '',
        // 内核审批挡位(approval_mode,与 approvalScheme 权限策略无关):
        // undefined(含空串归一)→ 默认推荐文案。
        `· approval=${approvalModeLabel}`,
      ]
        .filter(Boolean)
        .join(' ')
    : null;
  const parsed = parseModelIntensity(session?.model);
  const [modelBase, setModelBase] = useState(parsed.base);
  // Prefer the authoritative effort field; fall back to a legacy baked suffix
  // so old sessions migrate to the clean model + separate effort on first save.
  const [effortDraft, setEffortDraft] = useState(
    session?.effort?.trim() || intensityToEffort(parsed.intensity),
  );
  // 审批挡位草稿(undefined=会话未加载前不动)。"dirty 才发键"语义:保存时
  // 只在用户真正切过挡位时携带 approval_mode,与模型配置的 CAS 互不干扰。
  const [approvalDraft, setApprovalDraft] = useState<string | undefined>(
    undefined,
  );
  React.useEffect(() => {
    // 会话快照到达后初始化草稿(挡位在 store 里是 approvalMode ?? '')
    if (session && approvalDraft === undefined) {
      setApprovalDraft(session.approvalMode ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.approvalMode]);
  // 用户是否真的切过挡位(草稿 ≠ 会话当前值)——只有 dirty 才在保存时发键,
  // 避免「打开设置页点保存」把挡位无意义地重写一遍。
  const approvalDirty =
    approvalDraft !== undefined &&
    approvalDraft !== (session?.approvalMode ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      // Send a CLEAN model base + a separate effort field. "" clears each
      // (revert to CLI default). Takes effect on the NEXT user message — the
      // server re-emits ai.session.create before each ai.message carrying both;
      // the gateway injects --model and derives reasoning effort from `effort`.
      await updateAgentSession(session.id, {
        model: modelBase.trim(),
        // 钳到设备 CLI 实测支持的档(全局阶梯向下),旧会话的高档位不会
        // 打崩降级后的 CLI;全不支持回落 ''(CLI 默认)。
        effort: degradeEffort(effortDraft.trim(), supportedEfforts),
        // 审批挡位(2026-11-15 三端统一):用户切过才发键(undefined=不动
        // 存量),'' = 显式回默认推荐。服务端 PATCH 落库后随下一回合
        // ai.run.start/create 恒带键透传内核,网页 chip 同步显示。
        approval_mode: approvalDirty ? (approvalDraft as ApprovalModeWire) : undefined,
      });
      rememberModel(modelBase);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sessionSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!session) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title={t('sessionSettings.title')} onBack={navigation.goBack} />
        <View style={styles.emptyContainer}>
          <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
            {t('sessionSettings.empty')}
          </Text>
        </View>
      </SafeAreaWrapper>
    );
  }

  if (session.purpose === 'goal') {
    return (
      <SafeAreaWrapper>
        <TopAppBar title={t('sessionSettings.title')} onBack={navigation.goBack} />
        <View style={styles.goalReadOnly}>
          <GlassPanel style={styles.noteCard}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>GOAL 配置</Text>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>模型与推理强度在 Goal 创建时固定。</Text>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>规划、任务执行和重新规划使用同一份配置，普通会话设置不会覆盖它。</Text>
            {effectiveLabel ? <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>{effectiveLabel}</Text> : null}
          </GlassPanel>
        </View>
      </SafeAreaWrapper>
    );
  }

  return (
    <SafeAreaWrapper>
      <TopAppBar title={t('sessionSettings.title')} subtitle={t('sessionSettings.subtitle')} onBack={navigation.goBack} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          {t('sessionSettings.sectionModel')}
        </Text>
        <TextInput
          value={modelBase}
          onChangeText={setModelBase}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('sessionSettings.modelPlaceholder')}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          style={[
            theme.typography.bodyMd,
            styles.modelInput,
            {
              color: theme.colors.onSurface,
              borderRadius: theme.borderRadius.md,
              borderColor: isDark
                ? 'rgba(255,255,255,0.08)'
                : theme.colors.outlineVariant,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.04)'
                : theme.colors.surfaceContainerLow,
            },
          ]}
        />
        <View style={styles.chipRow}>
          {modelOptions.map(preset => {
            const active =
              preset.value === ''
                ? modelBase.trim() === ''
                : modelBase.trim() === preset.value;
            return (
              <TouchableOpacity
                key={preset.label}
                activeOpacity={0.75}
                onPress={() => setModelBase(preset.value)}
                style={[
                  styles.chip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.hint,
          ]}>
          {t('sessionSettings.modelHint')}
        </Text>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          {t('sessionSettings.sectionEffort')}
        </Text>
        <View style={styles.chipRow}>
          {effortOptions.map(option => {
            const active = effortDraft === option.value;
            // 置灰规则同创建页:设备上报的 efforts 不含该档(大小写不敏感)
            // → disabled+0.35;''(默认)永远可点;未上报 → 全部可点。
            const effortEnabled =
              option.value === '' ||
              !supportedEfforts ||
              supportedEfforts.some(
                item => item.trim().toLowerCase() === option.value.toLowerCase(),
              );
            return (
              <TouchableOpacity
                key={option.value || 'default'}
                accessibilityState={{ disabled: !effortEnabled }}
                activeOpacity={0.75}
                disabled={!effortEnabled}
                onPress={() => setEffortDraft(option.value)}
                style={[
                  styles.chip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                    opacity: effortEnabled ? 1 : 0.35,
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.hint,
          ]}>
          {t('sessionSettings.effortHint', {
            provider: providerLabel(provider),
            levels: effortOptions.filter(o => o.value).map(o => o.value).join('/'),
          })}
        </Text>

        {/* 内核审批挡位(approval_mode)可编辑区块:2026-11-15 三端统一——挡位
            是唯一权威,手机在此切换,服务端 PATCH 落库后随下一回合
            ai.run.start/create 恒带键透传内核,网页权限面板同步显示。
            bypass_all 会弹确认(真·全放,含危险命令)。 */}
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          {t('sessionSettings.approvalSection')}
        </Text>
        <View style={styles.chipRow}>
          {approvalChips.map(option => {
            const active = (approvalDraft ?? session.approvalMode ?? '') === option.value;
            const isBypass = option.value === 'bypass_all';
            return (
              <TouchableOpacity
                key={option.value || 'default'}
                testID={`approval-chip-${option.value || 'default'}`}
                accessibilityState={{ disabled: saving }}
                activeOpacity={0.75}
                disabled={saving}
                onPress={() => {
                  if (isBypass && active) return;
                  if (isBypass) {
                    Alert.alert(
                      t('sessionSettings.approvalBypassAll'),
                      t('sessionSettings.approvalHint'),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('common.confirm'),
                          style: 'destructive',
                          onPress: () => setApprovalDraft(option.value),
                        },
                      ],
                    );
                    return;
                  }
                  setApprovalDraft(option.value);
                }}
                style={[
                  styles.chip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.hint,
          ]}>
          {t('sessionSettings.approvalHint')}
        </Text>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.hint,
          ]}>
          {t('sessionSettings.approvalReadOnlyHint')}
        </Text>

        {effectiveLabel ? (
          <GlassPanel style={styles.noteCard}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.secondary }]}>
              {t('sessionSettings.effective')}
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
              {effectiveLabel}
            </Text>
          </GlassPanel>
        ) : null}

        <GlassPanel style={styles.noteCard}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            {t('sessionSettings.timingTitle')}
          </Text>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {t('sessionSettings.timingDetail')}
          </Text>
        </GlassPanel>

        {error && (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error }, styles.errorText]}>
            {error}
          </Text>
        )}

        <GlowButton
          title={saving ? t('sessionSettings.saving') : t('sessionSettings.saveButton')}
          onPress={handleSave}
          disabled={saving}
          style={styles.saveButton}
        />
      </ScrollView>
      {saving && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      )}
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  goalReadOnly: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 8,
  },
  modelInput: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  hint: {
    marginTop: 10,
  },
  noteCard: {
    marginTop: 18,
    padding: 12,
    gap: 8,
  },
  errorText: {
    marginTop: 12,
  },
  saveButton: {
    marginTop: 16,
  },
  emptyContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
});

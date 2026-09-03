import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';
import { useTheme } from '../../theme/useTheme';
import { useModelOptions } from '../../hooks/useModelOptions';
import { resolveEffectiveModelChoice, type ModelChoiceSource } from '../../utils/effectiveModelConfig';
import { providerLabel, type EffortProvider } from '../../utils/modelIntensity';

/**
 * 创建页 Start 时的模型/effort 二次确认弹窗。仅在 model/effort 任一未手动
 * 指定时由创建页打开;展示将生效值及其来源(与 server resolver 同规则,
 * 见 effectiveModelConfig.ts),Me 无适用默认时引导去 Me 页配置。
 */
export const ModelConfirmSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  provider: EffortProvider;
  manualModel: string;
  manualEffort: string;
  onConfirm: () => void;
  onGoToMeSettings: () => void;
}> = ({ open, onClose, provider, manualModel, manualEffort, onConfirm, onGoToMeSettings }) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const { userDefault } = useModelOptions();
  const choice = resolveEffectiveModelChoice(provider, manualModel, manualEffort, userDefault);
  const hasMeSource = choice.modelSource === 'me' || choice.effortSource === 'me';
  // BottomSheet 关闭动画期间 children 仍挂载约 240ms;内容随 open 立即收起,
  // 让调用方与测试都能同步断言「已关闭」(无需 fake timers)。
  // 该门控有测试钉住(__tests__/ModelConfirmSheet.test.tsx「关闭转场」用例),
  // 删除门控会导致那些同步断言在 240ms 动画窗口内误判——勿删。
  const visible = open;

  const sourceText = (s: ModelChoiceSource) =>
    s === 'manual' ? t('createScreen.confirmSheet.sourceManual')
    : s === 'me' ? t('createScreen.confirmSheet.sourceMe')
    : t('createScreen.confirmSheet.sourceCli');

  const renderRow = (label: string, value: string | undefined, source: ModelChoiceSource, valueTestID: string, sourceTestID: string) => (
    <View style={styles.row}>
      <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text
        testID={valueTestID}
        style={[theme.typography.bodyMd, { color: theme.colors.onSurface, flexShrink: 1 }]}
        numberOfLines={1}>
        {value ?? t('createScreen.confirmSheet.cliModelValue')}
      </Text>
      <View style={[styles.sourceChip, { borderColor: isDark ? 'rgba(255,255,255,0.12)' : theme.colors.outlineVariant }]}>
        <Text testID={sourceTestID} style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
          {sourceText(source)}
        </Text>
      </View>
    </View>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('createScreen.confirmSheet.title')}
      subtitle={t('createScreen.confirmSheet.subtitle', { provider: providerLabel(provider) })}>
      <View style={styles.body}>
        {visible ? renderRow(
          t('createScreen.confirmSheet.modelLabel'),
          choice.model,
          choice.modelSource,
          'sheet-model-value',
          'sheet-model-source',
        ) : null}
        {visible ? renderRow(
          t('createScreen.confirmSheet.effortLabel'),
          choice.effort,
          choice.effortSource,
          'sheet-effort-value',
          'sheet-effort-source',
        ) : null}
        {visible && !hasMeSource ? (
          <Text testID="sheet-no-me-hint" style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {t('createScreen.confirmSheet.noMeHint')}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {!visible ? null : hasMeSource ? (
            <>
              <GlowButton
                title={t('createScreen.confirmSheet.btnBack')}
                onPress={onClose}
                variant="outline"
                style={styles.btn}
                testID="sheet-btn-back"
              />
              <GlowButton
                title={t('createScreen.confirmSheet.btnConfirm')}
                onPress={onConfirm}
                style={styles.btn}
                testID="sheet-btn-confirm"
              />
            </>
          ) : (
            <>
              <GlowButton
                title={t('createScreen.confirmSheet.btnGoMe')}
                onPress={onGoToMeSettings}
                style={styles.btn}
                testID="sheet-btn-go-me"
              />
              <GlowButton
                title={t('createScreen.confirmSheet.btnStartAnyway')}
                onPress={onConfirm}
                variant="outline"
                style={styles.btn}
                testID="sheet-btn-start-anyway"
              />
            </>
          )}
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: { gap: 12, paddingHorizontal: 14, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 'auto',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1 },
});

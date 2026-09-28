// Status strip rendered above the terminal bottom bar while the AI-suggest
// flow is active (spec 2026-09-21): live STT caption while recording, the
// commandGen tool-loop progress while generating/recovering, retry/dismiss on
// error, and the editable text input that backs the FAB long-press.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import type { AiSuggestPhase, AiSuggestProgress } from '../../hooks/useAiCommandSuggestions';

export interface TerminalAiStatusStripProps {
  phase: AiSuggestPhase;
  textMode: boolean;
  liveCaption: string;
  progress: AiSuggestProgress | null;
  errorText: string;
  onRetry: () => void;
  onDismissError: () => void;
  onSendText: (text: string) => void;
  onCloseText: () => void;
}

export const TerminalAiStatusStrip: React.FC<TerminalAiStatusStripProps> = ({
  phase,
  textMode,
  liveCaption,
  progress,
  errorText,
  onRetry,
  onDismissError,
  onSendText,
  onCloseText,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('terminal');
  const [draft, setDraft] = useState('');
  // 秒级心跳:生成/恢复期间让已耗时一直走字,用户感知得到"它在干活"。
  const [nowMs, setNowMs] = useState(() => Date.now());
  const running = (phase === 'generating' || phase === 'recovering') && !!progress?.startedAt;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const surface = {
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : theme.colors.surfaceContainerLow,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant,
  };

  if (textMode) {
    return (
      <View testID="terminal-ai-text-strip" style={[styles.strip, surface]}>
        <TextInput
          testID="terminal-ai-text-input"
          value={draft}
          onChangeText={setDraft}
          placeholder={t('aiSuggest.textPlaceholder')}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          autoFocus
          multiline
          style={[theme.typography.bodySm, styles.textInput, { color: theme.colors.onSurface }]}
        />
        <TouchableOpacity
          testID="terminal-ai-text-send"
          accessibilityRole="button"
          disabled={!draft.trim()}
          onPress={() => {
            onSendText(draft.trim());
            setDraft('');
          }}
          style={[styles.pillButton, { borderColor: theme.colors.primary }, !draft.trim() && styles.disabled]}
        >
          <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
            {t('aiSuggest.textSend')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="terminal-ai-text-cancel"
          accessibilityRole="button"
          onPress={() => {
            setDraft('');
            onCloseText();
          }}
          style={[styles.pillButton, { borderColor: theme.colors.outlineVariant }]}
        >
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {t('aiSuggest.textCancel')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'recording') {
    return (
      <View testID="terminal-ai-strip" style={[styles.strip, surface]}>
        <View style={[styles.recDot, { backgroundColor: theme.colors.error }]} />
        <Text
          testID="terminal-ai-caption"
          numberOfLines={1}
          style={[theme.typography.bodySm, styles.flexText, { color: theme.colors.onSurface }]}
        >
          {liveCaption || t('aiSuggest.listening')}
        </Text>
      </View>
    );
  }

  if (phase === 'generating' || phase === 'recovering') {
    const elapsed =
      progress?.startedAt != null ? Math.max(0, Math.round((nowMs - progress.startedAt) / 1000)) : null;
    let statusText: string;
    if (!progress || (progress.stepsDone === 0 && !progress.currentTool)) {
      statusText = t('aiSuggest.generating');
    } else if (progress.currentTool) {
      const toolLabel = t(`aiSuggest.tool.${progress.currentTool}`, {
        defaultValue: progress.currentTool,
      });
      statusText = `${t('aiSuggest.stepN', { n: progress.stepsDone + 1 })} · ${toolLabel}`;
    } else {
      statusText = t('aiSuggest.stepsDone', { n: progress.stepsDone });
    }
    if (elapsed !== null) statusText += ` · ${elapsed}s`;
    return (
      <View testID="terminal-ai-strip" style={[styles.strip, surface]}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text
          testID="terminal-ai-progress"
          numberOfLines={1}
          style={[theme.typography.bodySm, styles.flexText, { color: theme.colors.onSurfaceVariant }]}
        >
          {phase === 'recovering' ? `${t('aiSuggest.recovering')} · ${statusText}` : statusText}
        </Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View testID="terminal-ai-strip" style={[styles.strip, surface, { borderColor: theme.colors.error }]}>
        <Text
          testID="terminal-ai-error"
          numberOfLines={2}
          style={[theme.typography.bodySm, styles.flexText, { color: theme.colors.error }]}
        >
          {errorText || t('aiSuggest.errorVoice')}
        </Text>
        <TouchableOpacity
          testID="terminal-ai-retry"
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.pillButton, { borderColor: theme.colors.primary }]}
        >
          <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
            {t('aiSuggest.errorRetry')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="terminal-ai-error-dismiss"
          accessibilityRole="button"
          accessibilityLabel={t('aiSuggest.errorDismissA11y')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onDismissError}
          style={styles.dismiss}
        >
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 40,
  },
  flexText: { flex: 1, minWidth: 0 },
  recDot: { width: 8, height: 8, borderRadius: 4 },
  textInput: { flex: 1, minWidth: 0, paddingVertical: 0 },
  pillButton: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismiss: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});

// Global terminal output-quota challenge modal.
//
// Mounted once at the App root (next to ToastViewport). The server pushes
// `terminal.quota.challenge` when a terminal crosses its output warning
// watermark; the store queues those (C3) and this modal renders the queue
// HEAD only — `pendingChallenges[0]` is referentially stable across appends,
// so a second queued challenge does not re-render the first, and answering
// (optimistic dequeue) promotes the next one automatically.
//
// The verdict goes out via `respondToPendingChallenge` (send + optimistic
// dequeue in one store action, mirroring how the other terminal actions own
// their transport calls); the server's `challenge_resolved` broadcast then
// dequeues idempotently.
import React, { useCallback } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/useTheme';
import { useControlCenterStore } from '../store/controlCenterStore';
import { GlassPanel } from './shared/GlassPanel';

/** MB display value for a byte count. Rounded (not floored) so 3.6 MB reads 4. */
export const challengeBytesToMb = (bytes: number): number =>
  Math.round(bytes / 1024 / 1024);

export const ChallengeModal: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('terminals');
  const challenge = useControlCenterStore(s => s.pendingChallenges[0]);
  const respondToPendingChallenge = useControlCenterStore(
    s => s.respondToPendingChallenge,
  );

  const respond = useCallback(
    (verdict: 'granted' | 'denied') => {
      if (!challenge) return;
      respondToPendingChallenge(challenge.challengeId, verdict);
    },
    [challenge, respondToPendingChallenge],
  );

  const handleContinue = useCallback(() => respond('granted'), [respond]);
  const handleTerminate = useCallback(() => respond('denied'), [respond]);

  // Empty queue → render nothing at all (no Modal shell).
  if (!challenge) {
    return null;
  }

  const terminalName =
    challenge.terminalName?.trim() || t('quotaChallenge.nameFallback');

  return (
    // onRequestClose is a deliberate no-op: the Android hardware back button
    // must neither dismiss nor answer the challenge — the user has to pick
    // 继续运行 or 终止 explicitly.
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <GlassPanel opaque bordered style={styles.panel}>
          <Text
            style={[
              theme.typography.titleMd,
              { color: theme.colors.onSurface },
            ]}
          >
            {t('quotaChallenge.title')}
          </Text>
          <Text
            testID="quota-challenge-name"
            numberOfLines={1}
            style={[theme.typography.labelMd, { color: theme.colors.primary }]}
          >
            {terminalName}
          </Text>
          <Text testID="quota-challenge-usage" style={theme.typography.bodyMd}>
            {t('quotaChallenge.usage', {
              used: challengeBytesToMb(challenge.usedBytes),
              kill: challengeBytesToMb(challenge.killAtBytes),
            })}
          </Text>
          <View
            style={[
              styles.warning,
              {
                backgroundColor: theme.colors.errorContainer,
                borderColor: theme.colors.error,
              },
            ]}
          >
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onErrorContainer },
              ]}
            >
              {t('quotaChallenge.warning')}
            </Text>
          </View>
          <View style={styles.footerRow}>
            <Pressable
              testID="quota-challenge-terminate"
              accessibilityRole="button"
              accessibilityLabel={t('quotaChallenge.terminate')}
              onPress={handleTerminate}
              style={styles.textBtn}
            >
              <Text
                style={[
                  theme.typography.labelMd,
                  { color: theme.colors.error },
                ]}
              >
                {t('quotaChallenge.terminate')}
              </Text>
            </Pressable>
            <Pressable
              testID="quota-challenge-continue"
              accessibilityRole="button"
              accessibilityLabel={t('quotaChallenge.continue')}
              onPress={handleContinue}
              style={[
                styles.primaryBtn,
                {
                  borderRadius: theme.borderRadius.md,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            >
              <Text
                style={[
                  theme.typography.labelMd,
                  { color: theme.colors.onPrimary },
                ]}
              >
                {t('quotaChallenge.continue')}
              </Text>
            </Pressable>
          </View>
        </GlassPanel>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  panel: {
    width: '100%',
    maxWidth: 380,
    padding: 18,
    borderRadius: 16,
    gap: 12,
  },
  warning: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  textBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  primaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});

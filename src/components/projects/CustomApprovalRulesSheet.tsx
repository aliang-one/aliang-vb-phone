import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import {
  fetchProjectApprovalPolicy,
  patchProjectCustomPolicy,
  type ServerApprovalRule,
} from '../../api/projects';
import type { ApprovalDecision } from '../../api/devices';

// 开关微调 (custom-rule fine-tuning): the custom template is a copy of the
// balanced preset's rules. The editor shows each rule with a 3-way decision
// toggle — 放行 (auto_approve) / 审批 (require_approval) / 拒绝 (auto_deny).
// Match conditions (tool / command_regex) are read-only and rules cannot be
// added or removed; only the per-rule decision is editable.

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const DECISIONS: { key: ApprovalDecision; labelKey: 'autoApprove' | 'requireApproval' | 'autoDeny' }[] = [
  { key: 'auto_approve', labelKey: 'autoApprove' },
  { key: 'require_approval', labelKey: 'requireApproval' },
  { key: 'auto_deny', labelKey: 'autoDeny' },
];

const decisionLabelKey = (decision: ApprovalDecision): 'autoApprove' | 'requireApproval' | 'autoDeny' =>
  decision === 'auto_approve'
    ? 'autoApprove'
    : decision === 'require_approval'
    ? 'requireApproval'
    : 'autoDeny';

/** Tiny read-only hint describing what a rule matches. */
const matchHint = (rule: ServerApprovalRule): string => {
  const tools = rule.match.tool;
  if (tools && tools.length > 0) {
    return tools.join(', ');
  }
  if (rule.match.command_regex) {
    return `/${rule.match.command_regex}/`;
  }
  return '—';
};

export function CustomApprovalRulesSheet({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('projects');
  const [state, setState] = useState<LoadState>('idle');
  const [rules, setRules] = useState<ServerApprovalRule[]>([]);
  const [defaultDecision, setDefaultDecision] = useState<ApprovalDecision | null>(null);
  // ruleId -> changed decision (only entries that differ from the server value).
  const [overrides, setOverrides] = useState<Record<string, ApprovalDecision>>({});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setErrorMsg(null);
    try {
      const policy = await fetchProjectApprovalPolicy(projectId);
      setRules(policy.rules ?? []);
      setDefaultDecision(policy.default_decision ?? null);
      setOverrides({});
      setState('ready');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('customRules.loadFailed'));
      setState('error');
    }
  }, [projectId, t]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const setDecision = (ruleId: string, original: ApprovalDecision, next: ApprovalDecision) => {
    setOverrides(prev => {
      const draft = { ...prev };
      if (next === original) {
        delete draft[ruleId];
      } else {
        draft[ruleId] = next;
      }
      return draft;
    });
  };

  const dirty = Object.keys(overrides).length > 0;

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await patchProjectCustomPolicy(projectId, overrides);
      setOverrides({});
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('customRules.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const renderBody = () => {
    if (state === 'loading') {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant, marginTop: 8 }]}>
            {t('customRules.loading')}
          </Text>
        </View>
      );
    }
    if (state === 'error') {
      return (
        <View style={styles.center}>
          <Text style={[theme.typography.bodyMd, { color: theme.colors.error, marginBottom: 8 }]}>
            {errorMsg ?? t('customRules.loadError')}
          </Text>
          <TouchableOpacity onPress={() => void load()} style={styles.retryBtn}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>{t('customRules.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (state === 'ready' && rules.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
            {t('customRules.emptyRules')}
          </Text>
        </View>
      );
    }
    return (
      <ScrollView contentContainerStyle={styles.list}>
        {rules.map(rule => {
          const original = rule.decision;
          const current = overrides[rule.id] ?? original;
          return (
            <View key={rule.id} style={styles.ruleRow}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]} numberOfLines={1}>
                  {rule.id}
                </Text>
                {rule.reason ? (
                  <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                    {rule.reason}
                  </Text>
                ) : null}
                <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant, marginTop: 2 }]}>
                  {matchHint(rule)}
                </Text>
              </View>
              <View style={styles.segmented}>
                {DECISIONS.map(opt => {
                  const active = current === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      disabled={saving}
                      onPress={() => setDecision(rule.id, original, opt.key)}
                      style={[
                        styles.segBtn,
                        {
                          backgroundColor: active
                            ? theme.colors.primary
                            : 'transparent',
                          borderColor: active
                            ? theme.colors.primary
                            : theme.colors.outline,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          theme.typography.bodySm,
                          {
                            color: active ? theme.colors.onPrimary : theme.colors.onSurfaceVariant,
                          },
                        ]}
                      >
                        {t(`customRules.decision.${opt.labelKey}`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <BottomSheet
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={t('customRules.title')}
      subtitle={t('customRules.subtitle')}
    >
      <View style={styles.fill}>
        {renderBody()}

        {defaultDecision ? (
          <View style={styles.footerNote}>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {t('customRules.defaultDecision', {
                decision: t(`customRules.decision.${decisionLabelKey(defaultDecision)}`),
              })}
            </Text>
          </View>
        ) : null}

        {errorMsg && state !== 'error' ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error, marginHorizontal: 14, marginTop: 4 }]}>
            {errorMsg}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: theme.colors.outline }]}
            disabled={saving}
            onPress={onClose}
          >
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              {t('customRules.cancel')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              {
                backgroundColor: dirty ? theme.colors.primary : theme.colors.surfaceContainerHigh,
                borderColor: theme.colors.primary,
                opacity: dirty && !saving ? 1 : 0.6,
              },
            ]}
            disabled={!dirty || saving}
            onPress={() => void handleSave()}
          >
            {saving ? (
              <ActivityIndicator color={theme.colors.onPrimary} size="small" />
            ) : (
              <Text
                style={[
                  theme.typography.labelCaps,
                  { color: dirty ? theme.colors.onPrimary : theme.colors.onSurfaceVariant },
                ]}
              >
                {t('customRules.save')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  list: {
    paddingVertical: 8,
    gap: 8,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
  },
  segBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderLeftWidth: 0,
  },
  footerNote: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.2)',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
});

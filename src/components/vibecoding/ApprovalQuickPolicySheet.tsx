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
import { addMcpAutoApprovePrefix, fetchProjectApprovalPolicy } from '../../api/projects';
import { platformTransport } from '../../services/platformTransport';
import { deriveMcpTiers } from '../../utils/mcpTiers';

// Quick approval-policy toggle reached from a pending approval card's "更多"
// button. Three presets:
//   - allow_all   : default_decision=auto_approve, no rules → everything passes
//   - common_auto : custom + default_decision=auto_approve (balanced rules keep
//                   dangerous-bash gated) → MCP/unknown/common all pass, only
//                   catastrophic bash still asks
//   - balanced    : restore per-approval prompting (no current-approval auto-approve)
// On open the sheet fetches the resolved policy to highlight the active preset.

export type QuickPolicyMode = 'allow_all' | 'common_auto' | 'balanced';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function deriveCurrentMode(
  scheme?: string,
  defaultDecision?: string,
): QuickPolicyMode | 'custom_other' {
  if (scheme === 'allow_all') return 'allow_all';
  if (scheme === 'balanced') return 'balanced';
  if (scheme === 'custom') {
    return defaultDecision === 'auto_approve' ? 'common_auto' : 'custom_other';
  }
  return 'balanced';
}

export function ApprovalQuickPolicySheet({
  projectId,
  open,
  onClose,
  // Raw tool name of the pending approval (e.g. 'mcp__serena__find_symbol').
  // When it's an MCP tool, the sheet shows extra server/all-MCP tier rows above
  // the global mode presets. Absent for non-MCP approvals → MCP rows hidden.
  toolName,
  // Fired after a successful switch to an auto-approving option (allow_all,
  // common_auto, or any MCP tier) so the parent can also approve the pending
  // approval the user is acting on. balanced does not fire it.
  onApplied,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  toolName?: string;
  onApplied?: (mode: 'allow_all' | 'common_auto' | 'mcp') => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');
  const [state, setState] = useState<LoadState>('idle');
  const [currentMode, setCurrentMode] = useState<QuickPolicyMode | 'custom_other'>('balanced');
  // MCP prefixes already active on the project (from GET approval-policy), used
  // to highlight the matching tier row as the current selection.
  const [currentPrefixes, setCurrentPrefixes] = useState<string[]>([]);
  const [applying, setApplying] = useState<QuickPolicyMode | null>(null);
  const [applyingMcp, setApplyingMcp] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mcpTiers = deriveMcpTiers(toolName);

  const load = useCallback(async () => {
    setState('loading');
    setErrorMsg(null);
    try {
      const policy = await fetchProjectApprovalPolicy(projectId);
      setCurrentMode(deriveCurrentMode(policy.scheme, policy.default_decision));
      setCurrentPrefixes(policy.mcp_auto_approve_prefixes ?? []);
      setState('ready');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('session.approval.quickPolicy.loadFailed'));
      setState('error');
    }
  }, [projectId, t]);

  useEffect(() => {
    if (open) {
      void load();
    }
    // Reset transient apply state when reopening.
    if (!open) {
      setApplying(null);
      setApplyingMcp(null);
      setErrorMsg(null);
    }
  }, [open, load]);

  const applyMcp = useCallback(
    async (prefix: string) => {
      if (applying !== null || applyingMcp !== null) return;
      setApplyingMcp(prefix);
      setErrorMsg(null);
      try {
        await addMcpAutoApprovePrefix(projectId, prefix);
        setCurrentPrefixes(prev => (prev.includes(prefix) ? prev : [...prev, prefix]));
        onApplied?.('mcp');
        onClose();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : t('session.approval.quickPolicy.mcpApplyFailed'));
      } finally {
        setApplyingMcp(null);
      }
    },
    [applying, applyingMcp, projectId, onApplied, onClose, t],
  );

  const apply = useCallback(
    async (mode: QuickPolicyMode) => {
      if (applying !== null || applyingMcp !== null) return;
      setApplying(mode);
      setErrorMsg(null);
      try {
        if (mode === 'allow_all') {
          await platformTransport.updateProject(projectId, {
            approval_policy: { scheme: 'allow_all' },
          });
        } else if (mode === 'common_auto') {
          await platformTransport.updateProject(projectId, {
            approval_policy: { scheme: 'custom', custom_default_decision: 'auto_approve' },
          });
        } else {
          await platformTransport.updateProject(projectId, {
            approval_policy: { scheme: 'balanced' },
          });
        }
        setCurrentMode(mode);
        if (mode === 'allow_all' || mode === 'common_auto') {
          onApplied?.(mode);
        }
        onClose();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : t('session.approval.quickPolicy.applyFailed'));
      } finally {
        setApplying(null);
      }
    },
    [applying, applyingMcp, projectId, onApplied, onClose, t],
  );

  const OPTIONS: Array<{
    mode: QuickPolicyMode;
    titleKey: string;
    hintKey: string;
  }> = [
    { mode: 'allow_all', titleKey: 'session.approval.quickPolicy.allowAll.title', hintKey: 'session.approval.quickPolicy.allowAll.hint' },
    { mode: 'common_auto', titleKey: 'session.approval.quickPolicy.commonAuto.title', hintKey: 'session.approval.quickPolicy.commonAuto.hint' },
    { mode: 'balanced', titleKey: 'session.approval.quickPolicy.balanced.title', hintKey: 'session.approval.quickPolicy.balanced.hint' },
  ];

  const renderBody = () => {
    if (state === 'loading') {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      );
    }
    return (
      <ScrollView>
        {mcpTiers.map(tier => {
          const active = currentPrefixes.includes(tier.prefix);
          const busy = applyingMcp === tier.prefix;
          const isAll = tier.prefix === 'mcp__';
          const titleKey = isAll
            ? 'session.approval.quickPolicy.mcpAll.title'
            : 'session.approval.quickPolicy.mcpTier.title';
          const hintKey = isAll
            ? 'session.approval.quickPolicy.mcpAll.hint'
            : 'session.approval.quickPolicy.mcpTier.hint';
          return (
            <TouchableOpacity
              key={tier.prefix}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              disabled={applying !== null || applyingMcp !== null}
              onPress={() => void applyMcp(tier.prefix)}
              style={[
                styles.row,
                {
                  borderColor: active ? theme.colors.primary : theme.colors.outline,
                  backgroundColor: active ? theme.colors.surfaceContainerHigh : 'transparent',
                  opacity: (applying !== null || applyingMcp !== null) && !busy ? 0.6 : 1,
                },
              ]}
            >
              <View style={styles.radioOuter}>
                {active ? <View style={[styles.radioInner, { backgroundColor: theme.colors.primary }]} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                  {isAll ? t(titleKey) : t(titleKey, { label: tier.label })}
                </Text>
                <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant, marginTop: 2 }]}>
                  {t(hintKey)}
                </Text>
              </View>
              {busy ? <ActivityIndicator color={theme.colors.primary} /> : null}
            </TouchableOpacity>
          );
        })}
        {OPTIONS.map(opt => {
          const active = currentMode === opt.mode;
          const busy = applying === opt.mode;
          return (
            <TouchableOpacity
              key={opt.mode}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              disabled={applying !== null || applyingMcp !== null}
              onPress={() => void apply(opt.mode)}
              style={[
                styles.row,
                {
                  borderColor: active ? theme.colors.primary : theme.colors.outline,
                  backgroundColor: active ? theme.colors.surfaceContainerHigh : 'transparent',
                  opacity: (applying !== null || applyingMcp !== null) && !busy ? 0.6 : 1,
                },
              ]}
            >
              <View style={styles.radioOuter}>
                {active ? <View style={[styles.radioInner, { backgroundColor: theme.colors.primary }]} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                  {t(opt.titleKey)}
                </Text>
                <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant, marginTop: 2 }]}>
                  {t(opt.hintKey)}
                </Text>
              </View>
              {busy ? <ActivityIndicator color={theme.colors.primary} /> : null}
            </TouchableOpacity>
          );
        })}
        {currentMode === 'custom_other' ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant, marginTop: 8, paddingHorizontal: 4 }]}>
            {t('session.approval.quickPolicy.customOtherNote')}
          </Text>
        ) : null}
        {errorMsg ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error, marginTop: 10, paddingHorizontal: 4 }]}>
            {errorMsg}
          </Text>
        ) : null}
      </ScrollView>
    );
  };

  return (
    <BottomSheet
      open={open}
      onClose={applying !== null || applyingMcp !== null ? () => undefined : onClose}
      title={t('session.approval.quickPolicy.title')}
      subtitle={t('session.approval.quickPolicy.subtitle')}
    >
      <View style={styles.fill}>{renderBody()}</View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(127,127,127,0.6)',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

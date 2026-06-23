import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { GlassPanel } from '../shared/GlassPanel';
import { IconBadge } from '../visual/IconBadge';
import { useTheme } from '../../theme/useTheme';
import { platformTransport } from '../../services/platformTransport';
import { CustomApprovalRulesSheet } from '../projects/CustomApprovalRulesSheet';
import type { ApprovalScheme } from '../../api/devices';

// Project-scoped approval-policy scheme picker. The server stores the choice
// on the project (not the device), bumps version + rehashes, and pushes
// `project.settings.updated` to the agent so it refetches and evaluates
// locally. Only the "custom" row exposes a gear that opens 开关微调
// (the balanced-preset rule editor).
const SCHEMES: { key: ApprovalScheme; label: string; hint: string }[] = [
  { key: 'balanced', label: 'Balanced', hint: '只读自动放行；改写/危险命令才审批' },
  { key: 'allow_all', label: 'Allow all', hint: '全部自动放行（仅可信项目）' },
  { key: 'custom', label: 'Custom', hint: '基于 balanced 自定义规则' },
];

export function ApprovalPolicyCard({
  projectId,
  scheme,
}: {
  projectId: string;
  scheme: ApprovalScheme;
}) {
  const { theme } = useTheme();
  const [current, setCurrent] = useState<ApprovalScheme>(scheme);
  const [saving, setSaving] = useState<ApprovalScheme | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    setCurrent(scheme);
  }, [scheme]);

  const select = async (next: ApprovalScheme) => {
    if (next === current || saving) return;
    setSaving(next);
    try {
      await platformTransport.updateProject(projectId, {
        approval_policy: { scheme: next },
      });
      setCurrent(next);
    } catch {
      // leave current unchanged on error
    } finally {
      setSaving(null);
    }
  };

  return (
    <GlassPanel style={{ paddingVertical: 12, paddingHorizontal: 16, marginBottom: 12 }}>
      <Text
        style={[
          theme.typography.labelCaps,
          { color: theme.colors.primary, marginBottom: 8 },
        ]}
      >
        APPROVAL POLICY
      </Text>
      {SCHEMES.map(opt => {
        const active = opt.key === current;
        const busy = saving === opt.key;
        const isCustom = opt.key === 'custom';
        return (
          <TouchableOpacity
            key={opt.key}
            disabled={saving !== null}
            onPress={() => select(opt.key)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 10,
              opacity: saving !== null ? 0.6 : 1,
            }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                marginRight: 12,
                borderWidth: 2,
                borderColor: active ? theme.colors.primary : theme.colors.onSurfaceVariant,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {active ? (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.primary,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                {opt.label}
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                {opt.hint}
              </Text>
            </View>
            {busy ? <ActivityIndicator color={theme.colors.primary} /> : null}
            {/* Gear only on the Custom row — opens 开关微调 rule editor. */}
            {isCustom ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="自定义审批规则"
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                style={{ marginLeft: 10, padding: 4 }}
                disabled={saving !== null}
                onPress={() => setEditorOpen(true)}
              >
                <IconBadge name="settings" tone="neutral" size={32} iconSize={16} />
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
        );
      })}

      <CustomApprovalRulesSheet
        projectId={projectId}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
      />
    </GlassPanel>
  );
}

import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
  LayoutAnimation,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge } from '../visual/IconBadge';

interface CollapsiblePanelProps {
  title: string;
  icon?: 'device' | 'code' | 'project' | 'agent' | 'terminal';
  defaultExpanded?: boolean;
  badge?: string;
  badgeType?: 'info' | 'success' | 'warning' | 'error';
  children: React.ReactNode;
}

export const CollapsiblePanel: React.FC<CollapsiblePanelProps> = ({
  title,
  icon,
  defaultExpanded = false,
  badge,
  badgeType = 'info',
  children,
}) => {
  const { theme, isDark } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  const headerBg = isDark
    ? 'rgba(255, 255, 255, 0.06)'
    : theme.colors.surfaceContainer;

  const borderColor = isDark
    ? 'rgba(255, 255, 255, 0.08)'
    : theme.colors.outlineVariant;

  return (
    <View style={[styles.container, { borderColor }]}>
      <TouchableOpacity
        style={[
          styles.header,
          { backgroundColor: headerBg, borderRadius: theme.borderRadius.md },
        ]}
        onPress={toggleExpand}
        activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          {icon ? (
            <IconBadge
              name={icon}
              tone="primary"
              size={28}
              iconSize={14}
            />
          ) : null}
          <Text
            style={[
              theme.typography.labelMd,
              { color: theme.colors.onSurface },
              styles.title,
            ]}>
            {title}
          </Text>
          {badge ? (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    badgeType === 'success'
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.15)'
                        : 'rgba(0, 81, 174, 0.1)'
                      : badgeType === 'warning'
                      ? isDark
                        ? 'rgba(206, 145, 120, 0.15)'
                        : 'rgba(180, 120, 0, 0.1)'
                      : isDark
                      ? 'rgba(86, 156, 214, 0.15)'
                      : 'rgba(0, 81, 174, 0.1)',
                  borderRadius: theme.borderRadius.full,
                },
              ]}>
              <Text
                style={[
                  theme.typography.labelSm,
                  {
                    color:
                      badgeType === 'success'
                        ? '#569CD6'
                        : badgeType === 'warning'
                        ? '#CE9178'
                        : theme.colors.primary,
                  },
                ]}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        <IconBadge
          name={expanded ? 'minus' : 'plus'}
          tone="neutral"
          size={24}
          iconSize={12}
        />
      </TouchableOpacity>
      {expanded ? (
        <View style={[styles.content, { borderRadius: theme.borderRadius.md }]}>
          {children}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  title: {
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  content: {
    padding: 12,
    gap: 8,
  },
});

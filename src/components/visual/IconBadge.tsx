import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Line,
  Path,
  Polyline,
  Rect,
} from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';

export type IconName =
  | 'home'
  | 'device'
  | 'agent'
  | 'terminal'
  | 'approval'
  | 'bell'
  | 'scan'
  | 'project'
  | 'event'
  | 'preview'
  | 'chat'
  | 'goal'
  | 'user'
  | 'git'
  | 'code'
  | 'port'
  | 'shield'
  | 'check'
  | 'warning'
  | 'play'
  | 'pause'
  | 'stop'
  | 'quota'
  | 'plus'
  | 'minus'
  | 'refresh'
  | 'copy'
  | 'external'
  | 'trash'
  | 'chevron'
  | 'settings'
  | 'close';

type Tone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral';

interface IconBadgeProps {
  name: IconName;
  tone?: Tone;
  size?: number;
  iconSize?: number;
  filled?: boolean;
  style?: object;
  /** 强制强调色(hex)——覆盖 tone 派生色。会话卡片按相位着色(绿/黄/蓝/红)时传入。 */
  colorOverride?: string;
}

const toneToColor = (tone: Tone, colors: ReturnType<typeof useTheme>['theme']['colors']) => {
  switch (tone) {
    case 'secondary':
      return colors.secondary;
    case 'tertiary':
      return colors.tertiary;
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'error':
      return colors.error;
    case 'neutral':
      return colors.onSurfaceVariant;
    default:
      return colors.primary;
  }
};

export const IconBadge: React.FC<IconBadgeProps> = ({
  name,
  tone = 'primary',
  size = 44,
  iconSize = 22,
  filled = false,
  style,
  colorOverride,
}) => {
  const { theme, isDark } = useTheme();
  const color = colorOverride ?? toneToColor(tone, theme.colors);
  const backgroundColor = filled
    ? color
    : isDark
    ? `${color}22`
    : `${color}14`;
  const stroke = filled ? theme.colors.onPrimary : color;

  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size / 2),
          backgroundColor,
          borderColor: filled ? 'transparent' : `${color}55`,
        },
        style,
      ]}>
      <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24">
        <IconShape name={name} stroke={stroke} />
      </Svg>
    </View>
  );
};

interface IconShapeProps {
  name: IconName;
  stroke: string;
}

const common = {
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
};

const IconShape: React.FC<IconShapeProps> = ({ name, stroke }) => {
  switch (name) {
    case 'home':
      return (
        <>
          <Path d="M4 11.5 12 5l8 6.5" stroke={stroke} {...common} />
          <Path d="M6.5 10.5V20h11v-9.5" stroke={stroke} {...common} />
          <Path d="M10 20v-5h4v5" stroke={stroke} {...common} />
        </>
      );
    case 'device':
      return (
        <>
          <Rect x="4" y="5" width="16" height="11" rx="2" stroke={stroke} {...common} />
          <Path d="M9 20h6M12 16v4" stroke={stroke} {...common} />
        </>
      );
    case 'agent':
      return (
        <>
          <Rect x="5" y="7" width="14" height="11" rx="3" stroke={stroke} {...common} />
          <Path d="M12 7V4M9 4h6" stroke={stroke} {...common} />
          <Circle cx="9.5" cy="12.5" r="1" fill={stroke} />
          <Circle cx="14.5" cy="12.5" r="1" fill={stroke} />
          <Path d="M9 16h6" stroke={stroke} {...common} />
        </>
      );
    case 'terminal':
      return (
        <>
          <Rect x="4" y="5" width="16" height="14" rx="3" stroke={stroke} {...common} />
          <Path d="m8 10 3 2.5L8 15M13 15h3" stroke={stroke} {...common} />
        </>
      );
    case 'approval':
      return (
        <>
          <Path d="M12 4 19 7v5c0 4-2.8 7-7 8-4.2-1-7-4-7-8V7l7-3Z" stroke={stroke} {...common} />
          <Path d="m8.5 12 2.2 2.2 4.8-5" stroke={stroke} {...common} />
        </>
      );
    case 'bell':
      return (
        <>
          <Path d="M7 10a5 5 0 0 1 10 0v4l2 3H5l2-3v-4Z" stroke={stroke} {...common} />
          <Path d="M10 20h4" stroke={stroke} {...common} />
        </>
      );
    case 'scan':
      return (
        <>
          <Path d="M5 8V5h3M16 5h3v3M19 16v3h-3M8 19H5v-3" stroke={stroke} {...common} />
          <Rect x="8" y="8" width="3" height="3" rx="0.5" stroke={stroke} {...common} />
          <Rect x="13" y="8" width="3" height="3" rx="0.5" stroke={stroke} {...common} />
          <Path d="M8 15h8" stroke={stroke} {...common} />
        </>
      );
    case 'project':
      return (
        <>
          <Path d="M4 7h6l2 2h8v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" stroke={stroke} {...common} />
          <Path d="M8 13h8M8 16h5" stroke={stroke} {...common} />
        </>
      );
    case 'event':
      return (
        <>
          <Path d="M7 5v14M17 5v14" stroke={stroke} {...common} />
          <Circle cx="7" cy="8" r="2" stroke={stroke} {...common} />
          <Circle cx="17" cy="12" r="2" stroke={stroke} {...common} />
          <Circle cx="7" cy="17" r="2" stroke={stroke} {...common} />
        </>
      );
    case 'preview':
      return (
        <>
          <Path d="M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" stroke={stroke} {...common} />
          <Circle cx="12" cy="12" r="2.5" stroke={stroke} {...common} />
        </>
      );
    case 'chat':
      return (
        <>
          <Path d="M5 6.5h14v8.5a3 3 0 0 1-3 3H10l-4 3v-3H5a3 3 0 0 1-3-3V9.5a3 3 0 0 1 3-3Z" stroke={stroke} {...common} />
          <Path d="M7.5 11h9M7.5 14h5" stroke={stroke} {...common} />
        </>
      );
    case 'goal':
      return (
        <>
          <Circle cx="12" cy="12" r="7" stroke={stroke} {...common} />
          <Circle cx="12" cy="12" r="2" fill={stroke} />
          <Path d="M12 3v2M12 19v2M3 12h2M19 12h2" stroke={stroke} {...common} />
        </>
      );
    case 'user':
      return (
        <>
          <Circle cx="12" cy="8" r="3" stroke={stroke} {...common} />
          <Path d="M5 20c1.2-4 12.8-4 14 0" stroke={stroke} {...common} />
        </>
      );
    case 'git':
      return (
        <>
          <Circle cx="7" cy="6" r="2" stroke={stroke} {...common} />
          <Circle cx="17" cy="18" r="2" stroke={stroke} {...common} />
          <Circle cx="7" cy="18" r="2" stroke={stroke} {...common} />
          <Path d="M7 8v8M9 6c4 0 8 4 8 10" stroke={stroke} {...common} />
        </>
      );
    case 'code':
      return (
        <>
          <Path d="m9 8-4 4 4 4M15 8l4 4-4 4" stroke={stroke} {...common} />
          <Path d="m13 6-2 12" stroke={stroke} {...common} />
        </>
      );
    case 'port':
      return (
        <>
          <Rect x="5" y="7" width="14" height="10" rx="2" stroke={stroke} {...common} />
          <Path d="M8 17v3M16 17v3M9 11h6" stroke={stroke} {...common} />
        </>
      );
    case 'shield':
      return (
        <Path d="M12 4 19 7v5c0 4-2.8 7-7 8-4.2-1-7-4-7-8V7l7-3Z" stroke={stroke} {...common} />
      );
    case 'check':
      return <Path d="m5 12 4 4 10-9" stroke={stroke} {...common} />;
    case 'warning':
      return (
        <>
          <Path d="M12 5 21 20H3L12 5Z" stroke={stroke} {...common} />
          <Path d="M12 10v4M12 17h.01" stroke={stroke} {...common} />
        </>
      );
    case 'play':
      return <Path d="M8 5v14l11-7L8 5Z" stroke={stroke} {...common} />;
    case 'pause':
      return (
        <>
          <Line x1="9" y1="6" x2="9" y2="18" stroke={stroke} {...common} />
          <Line x1="15" y1="6" x2="15" y2="18" stroke={stroke} {...common} />
        </>
      );
    case 'stop':
      return <Rect x="7" y="7" width="10" height="10" rx="1.5" stroke={stroke} {...common} />;
    case 'quota':
      return (
        <>
          <Circle cx="12" cy="12" r="8" stroke={stroke} {...common} />
          <Polyline points="12,8 12,12 15,14" stroke={stroke} {...common} />
        </>
      );
    case 'plus':
      return <Path d="M12 6v12M6 12h12" stroke={stroke} {...common} />;
    case 'minus':
      return <Path d="M6 12h12" stroke={stroke} {...common} />;
    case 'close':
      return <Path d="M6 6L18 18M18 6L6 18" stroke={stroke} {...common} />;
    case 'refresh':
      return (
        <>
          <Path d="M21 12a9 9 0 1 1-2.6-6.3" stroke={stroke} {...common} />
          <Path d="M21 3v5h-5" stroke={stroke} {...common} />
        </>
      );
    case 'copy':
      return (
        <>
          <Rect x="8" y="8" width="11" height="11" rx="2" stroke={stroke} {...common} />
          <Path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke={stroke} {...common} />
        </>
      );
    case 'external':
      return (
        <>
          <Path d="M14 5h5v5M19 5l-8 8" stroke={stroke} {...common} />
          <Path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" stroke={stroke} {...common} />
        </>
      );
    case 'trash':
      return (
        <>
          <Path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" stroke={stroke} {...common} />
          <Path d="M10 11v5M14 11v5" stroke={stroke} {...common} />
        </>
      );
    case 'chevron':
      return <Path d="M6 9l6 6 6-6" stroke={stroke} {...common} />;
    case 'settings':
      // Clean 8-tooth gear: body ring + 8 radial teeth + center hole. Drawn
      // with Lines/Circles (not a complex filled cog path) so it stays crisp at
      // the small header size instead of collapsing into a blob.
      return (
        <>
          <Circle cx="12" cy="12" r="6.4" stroke={stroke} {...common} />
          <Circle cx="12" cy="12" r="2.6" stroke={stroke} {...common} />
          <Line x1="18.3" y1="12" x2="21" y2="12" stroke={stroke} {...common} />
          <Line x1="16.5" y1="16.5" x2="18.4" y2="18.4" stroke={stroke} {...common} />
          <Line x1="12" y1="18.3" x2="12" y2="21" stroke={stroke} {...common} />
          <Line x1="7.5" y1="16.5" x2="5.6" y2="18.4" stroke={stroke} {...common} />
          <Line x1="5.7" y1="12" x2="3" y2="12" stroke={stroke} {...common} />
          <Line x1="7.5" y1="7.5" x2="5.6" y2="5.6" stroke={stroke} {...common} />
          <Line x1="12" y1="5.7" x2="12" y2="3" stroke={stroke} {...common} />
          <Line x1="16.5" y1="7.5" x2="18.4" y2="5.6" stroke={stroke} {...common} />
        </>
      );
  }
};

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});

import React from 'react';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';

// Mix a hex color toward white by `ratio` (0..1) — gives a lighter shade for the
// gradient stop so the logo's "A" reads with a subtle sheen in the theme primary.
const lighten = (hex: string, ratio: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  return `#${[mix(r), mix(g), mix(b)]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')}`;
};

// The Aliang logo ("A" + terminal chevrons + a check curve + dot), rendered from
// the master SVG so it stays crisp at any size. Colored in the theme primary — a
// VSCode-blue family (#569CD6 dark / #0051AE light) — so it always matches the
// app's accent; the left chevron stays VSCode's neutral comment-gray #767676.
// (Previously a fixed green palette.) viewBox 269×245.
export const Logo: React.FC<{ size?: number }> = ({ size = 120 }) => {
  const { theme } = useTheme();
  const primary = theme.colors.primary;
  const primaryLight = lighten(primary, 0.25);
  return (
    <Svg width={size} height={(size * 245) / 269} viewBox="0 0 269 245" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M102 0H142L219.5 181.5L186.5 195.5L174 166H70L44 222H0L102 0ZM87 128H158L122 48L87 128Z"
        fill="url(#aliangLogoGrad)"
      />
      <Path
        d="M58 150L88 170L58 190"
        stroke="#767676"
        strokeWidth={15}
        strokeLinecap="square"
      />
      <Path
        d="M99 190H131"
        stroke={primary}
        strokeWidth={15}
        strokeLinecap="square"
      />
      <Path
        d="M157 203C172.747 207.168 183.484 210.011 194.221 212.853C203.526 215.316 213.547 217.968 225 221"
        stroke={primary}
        strokeWidth={12}
        strokeLinecap="round"
      />
      <Path
        d="M244 239C254.493 239 263 230.493 263 220C263 209.507 254.493 201 244 201C233.507 201 225 209.507 225 220C225 230.493 233.507 239 244 239Z"
        stroke={primary}
        strokeWidth={11}
      />
      <Defs>
        <LinearGradient
          id="aliangLogoGrad"
          x1="26"
          y1="22"
          x2="276"
          y2="262"
          gradientUnits="userSpaceOnUse">
          <Stop stopColor={primaryLight} />
          <Stop offset={0.913462} stopColor={primary} />
        </LinearGradient>
      </Defs>
    </Svg>
  );
};

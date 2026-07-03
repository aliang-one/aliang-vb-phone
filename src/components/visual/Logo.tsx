import React from 'react';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

// The Aliang logo (green-gradient "A" + terminal chevrons + a check curve),
// rendered from the master SVG so it stays crisp at any size. viewBox 269×245.
export const Logo: React.FC<{ size?: number }> = ({ size = 120 }) => (
  <Svg
    width={size}
    height={(size * 245) / 269}
    viewBox="0 0 269 245"
    fill="none">
    <Path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M102 0H142L219.5 181.5L186.5 195.5L174 166H70L44 222H0L102 0ZM87 128H158L122 48L87 128Z"
      fill="url(#paint0_linear_932_28)"
    />
    <Path
      d="M58 150L88 170L58 190"
      stroke="#767676"
      strokeWidth={15}
      strokeLinecap="square"
    />
    <Path
      d="M99 190H131"
      stroke="#22C55E"
      strokeWidth={15}
      strokeLinecap="square"
    />
    <Path
      d="M157 203C172.747 207.168 183.484 210.011 194.221 212.853C203.526 215.316 213.547 217.968 225 221"
      stroke="#0E932E"
      strokeWidth={12}
      strokeLinecap="round"
    />
    <Path
      d="M244 239C254.493 239 263 230.493 263 220C263 209.507 254.493 201 244 201C233.507 201 225 209.507 225 220C225 230.493 233.507 239 244 239Z"
      stroke="#0E932E"
      strokeWidth={11}
    />
    <Defs>
      <LinearGradient
        id="paint0_linear_932_28"
        x1="26"
        y1="22"
        x2="276"
        y2="262"
        gradientUnits="userSpaceOnUse">
        <Stop stopColor="#64C57C" />
        <Stop offset={0.913462} stopColor="#0E932E" />
      </LinearGradient>
    </Defs>
  </Svg>
);

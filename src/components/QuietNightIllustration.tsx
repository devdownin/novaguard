import React from 'react';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { color } from '../theme';

/**
 * A camera on watch under a crescent moon: the history before anything was
 * filmed. Decorative — the text beside it says what the screen means.
 */
export function QuietNightIllustration({ width = 180 }: { width?: number }) {
  return (
    <Svg width={width} height={width * (120 / 180)} viewBox="0 0 180 120" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color.accent800} />
          <Stop offset="1" stopColor={color.accent900} />
        </LinearGradient>
      </Defs>
      {/* Moon and stars */}
      <Path d="M140 14a16 16 0 1 0 14 24 13 13 0 1 1-14-24z" fill={color.accent300} opacity={0.9} />
      <Circle cx={30} cy={18} r={1.6} fill={color.neutral300} />
      <Circle cx={58} cy={8} r={1.1} fill={color.neutral400} />
      <Circle cx={112} cy={30} r={1.3} fill={color.neutral300} />
      <Circle cx={18} cy={46} r={1} fill={color.neutral400} />
      <Circle cx={164} cy={58} r={1.2} fill={color.neutral400} />
      {/* Wall mount */}
      <Rect x={40} y={52} width={6} height={30} rx={2} fill={color.neutral800} />
      <Path d="M43 60 L62 66" stroke={color.neutral700} strokeWidth={4} strokeLinecap="round" />
      {/* Camera body */}
      <Rect x={58} y={54} width={72} height={34} rx={9} fill="url(#body)" stroke={color.accent600} strokeWidth={1.5} />
      <Rect x={124} y={60} width={14} height={22} rx={4} fill={color.accent800} stroke={color.accent600} strokeWidth={1.5} />
      {/* Lens */}
      <Circle cx={142} cy={71} r={9} fill="#0c0e15" stroke={color.accent400} strokeWidth={2} />
      <Circle cx={139.5} cy={68.5} r={2.2} fill={color.accent200} opacity={0.7} />
      {/* Watching light */}
      <Circle cx={70} cy={63} r={2.6} fill={color.watching} />
      {/* Light cone */}
      <Path d="M150 66 L178 52 L178 92 L150 76 Z" fill={color.accent} opacity={0.08} />
      {/* Ground */}
      <Ellipse cx={92} cy={112} rx={70} ry={5} fill={color.neutral900} />
    </Svg>
  );
}

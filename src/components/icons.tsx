import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

interface IconProps {
  size?: number;
  color: string;
}

export function CameraIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2.5} y={6.5} width={19} height={12} rx={3} stroke={color} strokeWidth={1.4} />
      <Path d="M8.5 6.5l1.4-2.2h4.2l1.4 2.2" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <Circle cx={12} cy={12.5} r={3.2} stroke={color} strokeWidth={1.4} />
    </Svg>
  );
}

export function HistoryIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.4} />
      <Path d="M12 7.5V12l3.2 2" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </Svg>
  );
}

export function SetupIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8h16M4 16h16" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      <Circle cx={9.5} cy={8} r={2.3} stroke={color} strokeWidth={1.4} />
      <Circle cx={15} cy={16} r={2.3} stroke={color} strokeWidth={1.4} />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 9, color }: IconProps) {
  const h = size * (6 / 9);
  return (
    <Svg width={size} height={h} viewBox="0 0 10 6" fill="none">
      <Path d="M1 1l4 4 4-4" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </Svg>
  );
}

export function ChevronRightIcon({ size = 7, color }: IconProps) {
  const h = size * (12 / 7);
  return (
    <Svg width={size} height={h} viewBox="0 0 7 12" fill="none">
      <Path d="M1 1l5 5-5 5" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </Svg>
  );
}

export function ShieldCheckIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3l7 3v6c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6l7-3z" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <Path d="M9 12.5l2 2 4-4" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PlayIcon({ size = 16, color }: IconProps) {
  const h = size * (18 / 16);
  return (
    <Svg width={size} height={h} viewBox="0 0 16 18" fill="none">
      <Path d="M2 1.5l12 7.5-12 7.5V1.5z" fill={color} />
    </Svg>
  );
}

export function PersonIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={7} r={3} fill={color} />
      <Path d="M6 21v-2a6 6 0 0 1 12 0v2" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </Svg>
  );
}

export function DogIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 5.5c-1.6-.6-3 .4-2.6 2.1.3 1.4 1.6 2.9 3.1 3.7" fill={color} />
      <Path d="M18 5.5c1.6-.6 3 .4 2.6 2.1-.3 1.4-1.6 2.9-3.1 3.7" fill={color} />
      <Path
        d="M12 8c-3.3 0-5.5 2.3-5.5 5.4 0 2.6 1.7 4.7 4 5.3l-.2 1.3h1.4l.1-1h.4l.1 1h1.4l-.2-1.3c2.3-.6 4-2.7 4-5.3C17.5 10.3 15.3 8 12 8z"
        fill={color}
      />
    </Svg>
  );
}

export function ShieldHomeIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3l7 3v6c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6l7-3z" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <Path d="M8.7 12.3L12 9.7l3.3 2.6" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9.4 11.8v3.4h5.2v-3.4" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
  );
}

export function ShieldLockIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3l7 3v6c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6l7-3z" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <Rect x={9.6} y={12} width={4.8} height={3.8} rx={0.8} stroke={color} strokeWidth={1.3} />
      <Path d="M10.4 12v-1.2a1.6 1.6 0 0 1 3.2 0V12" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

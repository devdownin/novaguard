import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { encodeQr } from '../utils/qr';

/** Four modules of white margin: the quiet zone a scanner needs to find the symbol. */
const QUIET = 4;

/**
 * A QR code, always dark on white whatever the theme: an inverted symbol is
 * one many scanners do not read, and this one carries a credential the owner
 * is trying to hand over in one go.
 */
export function QrCode({ value, size, accessibilityLabel }: { value: string; size: number; accessibilityLabel: string }) {
  const { path, side } = useMemo(() => {
    const matrix = encodeQr(value);
    let d = '';
    matrix.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    }));
    return { path: d, side: matrix.length + QUIET * 2 };
  }, [value]);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${side} ${side}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID="mcp-qr"
    >
      <Rect x={0} y={0} width={side} height={side} fill="#FFFFFF" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}

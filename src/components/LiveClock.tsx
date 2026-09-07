import React, { useEffect, useState } from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';
import { MAX_FONT_SCALE } from '../theme';
import { formatClock } from '../utils/date';

/**
 * The viewfinder's wall clock, ticking in its own leaf.
 *
 * It used to be provider state, so every second the whole provider re-rendered
 * and the viewfinder re-ran its entire render — re-projecting every detection
 * box — to change one string. Nothing else in the app reads it.
 */
export function LiveClock({ style }: { style?: StyleProp<TextStyle> }) {
  const [now, setNow] = useState(() => formatClock(new Date()));

  useEffect(() => {
    const iv = setInterval(() => setNow(formatClock(new Date())), 1000);
    return () => clearInterval(iv);
  }, []);

  return <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={style}>{now}</Text>;
}

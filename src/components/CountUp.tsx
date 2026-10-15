import React, { useEffect, useRef, useState } from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';
import { MAX_FONT_SCALE } from '../theme';
import { useReducedMotion } from '../utils/useReducedMotion';

const DURATION_MS = 600;

/**
 * A number that rolls to its new value when it changes. The first render shows
 * the value as is: counting up from zero at every visit to the screen would say
 * something changed when nothing did. A leaf, so only this text re-renders per
 * step.
 */
export function CountUp({ value, style }: { value: number; style?: StyleProp<TextStyle> }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (reduced || start === value) { setShown(value); return; }
    const began = Date.now();
    const timer = setInterval(() => {
      const k = Math.min(1, (Date.now() - began) / DURATION_MS);
      // Ease-out: fast at first, settling on the value.
      setShown(Math.round(start + (value - start) * (1 - (1 - k) ** 3)));
      if (k >= 1) clearInterval(timer);
    }, 30);
    return () => { clearInterval(timer); setShown(value); };
  }, [value, reduced]);
  return <Text style={style} maxFontSizeMultiplier={MAX_FONT_SCALE}>{shown}</Text>;
}

import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';
import { useReducedMotion } from '../utils/useReducedMotion';

/** Rows past this one appear together, so a long list never waits on its own cascade. */
const MAX_STAGGER = 8;
const STAGGER_MS = 35;
const DURATION_MS = 220;
const RISE = 10;

/** Fades and lifts its children in once, on mount. */
export function FadeInView({ index = 0, style, children }: {
  index?: number; style?: StyleProp<ViewStyle>; children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { progress.setValue(1); return; }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      delay: Math.min(index, MAX_STAGGER) * STAGGER_MS,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, index, reduced]);
  return (
    <Animated.View
      style={[style, {
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] }) }],
      }]}
    >
      {children}
    </Animated.View>
  );
}

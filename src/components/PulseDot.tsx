import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';

export type Pulse = 'none' | 'breathe' | 'beat';

/** One cycle, ms: a slow breath while watching, a heartbeat while filming. */
const PERIOD: Record<Exclude<Pulse, 'none'>, number> = { breathe: 2600, beat: 1100 };

/** True while the system asks for reduced motion; a looping halo is exactly what that setting is for. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }, () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}

/**
 * A status dot with a halo that grows and fades around it. The dot itself never
 * moves or dims, so the colour is readable at every instant of the loop.
 */
export function PulseDot({ color, size, pulse }: { color: string; size: number; pulse: Pulse }) {
  const reduced = useReducedMotion();
  const animate = pulse !== 'none' && !reduced;
  const phase = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) return;
    phase.setValue(0);
    // Native driver: the loop runs on the UI thread and costs the JS thread —
    // which carries the detection path — nothing.
    const loop = Animated.loop(
      Animated.timing(phase, { toValue: 1, duration: PERIOD[pulse], useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, pulse, phase]);

  const dot = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  return (
    <View testID="pulse-dot" style={[styles.slot, { width: size, height: size }]}>
      {animate && (
        <Animated.View
          testID="pulse-halo"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            dot,
            {
              opacity: phase.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scale: phase.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
            },
          ]}
        />
      )}
      <View style={dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { alignItems: 'center', justifyContent: 'center' },
});

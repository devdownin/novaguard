import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color as palette } from '../theme';
import { useReducedMotion } from '../utils/useReducedMotion';

const RISE_MS = 650;

/**
 * The NovaGuard shield, revealed from the bottom up, then its house mark.
 *
 * The reveal is a sliding window — an outer view moving up while the drawing
 * inside moves down by the same amount, so the shield stays put and only the
 * clip edge travels. Both are transforms, so the whole thing runs on the native
 * driver: the splash this sits on is drawn while the JS thread hydrates the app,
 * and a stroke animation driven from JS would compete with it.
 */
export function ShieldLogo({ size, color = palette.accent }: { size: number; color?: string }) {
  const reduced = useReducedMotion();
  const rise = useRef(new Animated.Value(0)).current;
  const mark = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) { rise.setValue(1); mark.setValue(1); return; }
    const anim = Animated.sequence([
      Animated.timing(rise, { toValue: 1, duration: RISE_MS, useNativeDriver: true }),
      Animated.spring(mark, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [reduced, rise, mark]);

  const window = rise.interpolate({ inputRange: [0, 1], outputRange: [size, 0] });
  const counter = rise.interpolate({ inputRange: [0, 1], outputRange: [-size, 0] });

  return (
    <View testID="shield-logo" style={{ width: size, height: size }} accessible={false}>
      <Animated.View style={[styles.clip, { transform: [{ translateY: window }] }]}>
        <Animated.View style={{ transform: [{ translateY: counter }] }}>
          <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <Path d="M12 3l7 3v6c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6l7-3z" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
          </Svg>
        </Animated.View>
      </Animated.View>
      <Animated.View
        testID="shield-logo-mark"
        style={[StyleSheet.absoluteFill, {
          opacity: mark.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        }]}
      >
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M8.7 12.3L12 9.7l3.3 2.6" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M9.4 11.8v3.4h5.2v-3.4" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});

import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { color } from '../theme';

interface SwitchProps {
  value: boolean;
  onValueChange: () => void;
  accessibilityLabel?: string;
  /**
   * A setting this device cannot honour — the history lock on a phone with no
   * screen lock. Dimmed and inert rather than absent: a row that disappears
   * takes its explanation with it, and the explanation is the whole answer.
   */
  disabled?: boolean;
}

const TRACK_ON = color.accent800;
const TRACK_OFF = 'transparent';
const BORDER_ON = color.accent;
const BORDER_OFF = color.neutral700;
const KNOB_ON = color.accent200;
const KNOB_OFF = color.neutral600;

export function Switch({ value, onValueChange, accessibilityLabel, disabled = false }: SwitchProps) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 160,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [2, 19] });
  const borderColor = value ? BORDER_ON : BORDER_OFF;
  const knobColor = value ? KNOB_ON : KNOB_OFF;
  const trackColor = value ? TRACK_ON : TRACK_OFF;

  return (
    <Pressable
      onPress={disabled ? undefined : onValueChange}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, disabled && styles.trackDisabled, { borderColor, backgroundColor: trackColor }]}
    >
      <Animated.View style={[styles.knob, { backgroundColor: knobColor, transform: [{ translateX }] }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trackDisabled: { opacity: 0.4 },
  track: {
    width: 44,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    padding: 0,
    justifyContent: 'center',
  },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
});

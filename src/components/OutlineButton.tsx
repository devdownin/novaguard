import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { color, font } from '../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** For the end-to-end flows, which have no other handle on a button. */
  testID?: string;
}

export function PrimaryOutlineButton({ label, onPress, style, disabled, testID }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.base,
        styles.primary,
        pressed && styles.primaryPressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.text, { color: color.accent }]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryOutlineButton({ label, onPress, style, disabled, testID }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.base,
        styles.secondary,
        pressed && styles.secondaryPressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.text, { color: color.neutral300 }]}>{label}</Text>
    </Pressable>
  );
}

export function TextButton({ label, onPress, style, disabled, testID }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.base, styles.text_, pressed && { opacity: 0.6 }, style]}
    >
      <Text style={[styles.text, { color: color.neutral500 }]}>{label}</Text>
    </Pressable>
  );
}

export function SolidAccentButton({ label, onPress, style, disabled }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.solidBase,
        {
          backgroundColor: disabled ? 'transparent' : color.accent900,
          borderColor: disabled ? color.neutral800 : color.accent,
        },
        pressed && !disabled && { backgroundColor: color.accent800 },
        style,
      ]}
    >
      <Text style={[styles.solidText, { color: disabled ? color.neutral600 : color.accent200 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  primary: {
    borderColor: color.accent,
    backgroundColor: 'transparent',
  },
  primaryPressed: {
    backgroundColor: color.accent900,
  },
  secondary: {
    borderColor: color.neutral800,
    backgroundColor: 'transparent',
  },
  secondaryPressed: {
    backgroundColor: color.neutral900,
  },
  text_: {
    borderColor: 'transparent',
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    fontFamily: font.regular,
    fontSize: 11.5,
  },
  solidBase: {
    paddingVertical: 14,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  solidText: {
    fontFamily: font.semibold,
    fontSize: 13,
    letterSpacing: 1.04,
  },
});

import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { color, font } from '../theme';
import { IconProps } from './icons';

interface ButtonProps {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** For the end-to-end flows, which have no other handle on a button. */
  testID?: string;
  /** Drawn in the label's own colour, before it or above it. */
  icon?: React.ComponentType<IconProps>;
  /** `top` stacks the icon over the label, as the tab bar does; for narrow buttons sharing a row. */
  iconPosition?: 'start' | 'top';
}

/** The label, preceded by its icon when there is one. The icon is drawn, never read: the label names the action. */
function Content({ label, tint, icon: Icon, iconPosition = 'start' }: {
  label: string; tint: string; icon?: React.ComponentType<IconProps>; iconPosition?: 'start' | 'top';
}) {
  const text = <Text style={[styles.text, { color: tint }]}>{label}</Text>;
  if (!Icon) return text;
  const top = iconPosition === 'top';
  return (
    <View style={top ? styles.stack : styles.row}>
      <Icon size={top ? 18 : 13} color={tint} />
      {text}
    </View>
  );
}

export function PrimaryOutlineButton({ label, onPress, style, disabled, testID, icon, iconPosition }: ButtonProps) {
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
      <Content label={label} tint={color.accent} icon={icon} iconPosition={iconPosition} />
    </Pressable>
  );
}

export function SecondaryOutlineButton({ label, onPress, style, disabled, testID, icon, iconPosition }: ButtonProps) {
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
      <Content label={label} tint={color.neutral300} icon={icon} iconPosition={iconPosition} />
    </Pressable>
  );
}

export function TextButton({ label, onPress, style, disabled, testID, icon, iconPosition }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.base, styles.text_, pressed && { opacity: 0.6 }, style]}
    >
      <Content label={label} tint={color.neutral500} icon={icon} iconPosition={iconPosition} />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stack: {
    alignItems: 'center',
    gap: 4,
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

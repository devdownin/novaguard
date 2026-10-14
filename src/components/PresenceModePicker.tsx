import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PresenceMode } from '../state/types';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { t } from '../i18n';

export function PresenceModePicker({
  value,
  onChange,
}: {
  value: PresenceMode;
  onChange: (value: PresenceMode) => void;
}) {
  return (
    <View style={styles.options}>
      {(['strict', 'tolerant'] as PresenceMode[]).map(mode => {
        const selected = value === mode;
        const label = t(
          mode === 'strict' ? 'setup.mode.strict' : 'setup.mode.tolerant',
        );
        const description = t(
          mode === 'strict'
            ? 'setup.mode.strict.sub'
            : 'setup.mode.tolerant.sub',
        );
        return (
          <Pressable
            key={mode}
            onPress={() => onChange(mode)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            accessibilityHint={description}
            style={({ pressed }) => [
              styles.option,
              selected && styles.selected,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.titleRow}>
              <View style={[styles.dot, selected && styles.dotSelected]} />
              <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {label}
              </Text>
            </View>
            <Text
              style={styles.description}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {description}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  options: { gap: 8 },
  option: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.neutral700,
  },
  selected: { backgroundColor: color.accent900, borderColor: color.accent500 },
  pressed: { opacity: 0.75 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.neutral500,
  },
  dotSelected: { backgroundColor: color.accent, borderColor: color.accent },
  title: {
    fontFamily: font.medium,
    fontSize: 14,
    color: color.text,
    flexShrink: 1,
  },
  description: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: color.neutral400,
    marginTop: 6,
  },
});

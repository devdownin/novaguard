import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';

interface Option<T extends string> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  fontSize?: number;
  paddingVertical?: number;
  segmentRadius?: number;
}

export function SegmentedControl<T extends string>({
  options, value, onChange, fontSize = 12, paddingVertical = 8, segmentRadius = 8,
}: SegmentedControlProps<T>) {
  return (
    <View style={styles.track}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              pressed && { opacity: 0.62 },
              styles.segment,
              {
                paddingVertical,
                borderRadius: segmentRadius,
                backgroundColor: active ? color.accent900 : 'transparent',
              },
            ]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: font.medium, fontSize, color: active ? color.accent200 : color.neutral500 }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: 1,
    backgroundColor: color.divider,
    borderRadius: 9,
    padding: 1,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
  },
});

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, TOUCH_SLOP } from '../theme';

export function SettingRow({
  label, subtitle, children,
}: { label: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.labelCol}>
        <Text style={styles.label}>{label}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function StaticValue({ label }: { label: string }) {
  return <Text style={styles.staticValue}>{label}</Text>;
}

export function ValueButton({
  label, onPress, active = false, pill = false, accessibilityLabel, testID,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  pill?: boolean;
  /** For the end-to-end flows, which have no other handle on a value that changes. */
  testID?: string;
  /**
   * What a screen reader announces, when the visible label does not stand on
   * its own. "7 jours" says nothing without the row it belongs to; "Autoriser"
   * says nothing when three of them sit in a column.
   */
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!active }}
      // ~28 dp tall by design; the finger gets the 48 dp Android asks for.
      hitSlop={TOUCH_SLOP}
      style={({ pressed }) => [
        styles.valueButton,
        pill && { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11 },
        active && { backgroundColor: color.accent900, borderColor: color.accent },
        // These cycle through their values on tap, so several presses in a row
        // are normal — and a value that happens to look similar to the last one
        // makes a press that did work look like one that did not.
        pressed && { opacity: 0.62 },
      ]}
    >
      <Text style={[styles.valueButtonText, active && { color: color.accent200 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: color.divider,
  },
  labelCol: {
    flex: 1,
    flexDirection: 'column',
  },
  label: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.text,
  },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 10.5,
    color: color.neutral600,
    marginTop: 2,
  },
  valueButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: color.neutral800,
    backgroundColor: 'transparent',
  },
  valueButtonText: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.neutral200,
  },
  staticValue: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.neutral400,
  },
});

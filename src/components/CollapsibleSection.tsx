import React from 'react';
import {
  LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View,
} from 'react-native';
import { color, font, radius, shadow } from '../theme';
import { ChevronDownIcon } from './icons';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface CollapsibleSectionProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, expanded, onToggle, children }: CollapsibleSectionProps) {
  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <View style={styles.card}>
      <Pressable
        onPress={handleToggle}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.62 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={styles.title}>{title}</Text>
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
          <ChevronDownIcon size={10} color={color.neutral600} />
        </View>
      </Pressable>
      {expanded && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg - 3,
    backgroundColor: color.surface,
    overflow: 'hidden',
    ...shadow.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  title: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: color.neutral300,
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
});

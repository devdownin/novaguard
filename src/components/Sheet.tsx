import React, { useEffect, useRef } from 'react';
import {
  Animated, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View,
} from 'react-native';
import { color, shadow } from '../theme';
import { t } from '../i18n';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  maxHeightPercent?: number;
  children: React.ReactNode;
}

export function Sheet({ visible, onClose, maxHeightPercent = 88, children }: SheetProps) {
  // Re-read on every render rather than captured once: the window is half as
  // tall after a rotation, and a sheet opened from the stale value started its
  // slide from far below the screen — or, closing, stopped short of leaving it.
  const screenHeight = useWindowDimensions().height;
  const translateY = useRef(new Animated.Value(screenHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = React.useState(visible);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      // The ref holds whatever the window was at first mount; an open always
      // starts from the current one.
      translateY.setValue(screenHeight);
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.spring(translateY, {
          toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220, mass: 0.9,
        }),
      ]).start();
    } else if (rendered) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 140, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: screenHeight, duration: 180, useNativeDriver: true }),
      ]).start(() => setRendered(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!rendered) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.dismiss')}
        />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { maxHeight: `${maxHeightPercent}%`, transform: [{ translateY }] }]}
      >
        <View style={styles.grabberRow}>
          <View style={styles.grabber} />
        </View>
        <ScrollView bounces={false} contentContainerStyle={styles.content}>
          {children}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(10,11,18,0.66)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: color.surface,
    ...shadow.lg,
  },
  grabberRow: {
    alignItems: 'center',
    paddingTop: 9,
    paddingBottom: 3,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.neutral700,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 18,
    paddingTop: 6,
  },
});

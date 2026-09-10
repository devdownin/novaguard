import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { useAppState, useViewfinderState } from '../state/AppStateContext';
import { uprightBoxToViewBox, viewBoxToUprightBox } from '../camera/framing';
import { isUsableZone } from '../ml/zone';
import { DetectionBox } from '../ml/types';
import { t } from '../i18n';

/**
 * The detection zone: what it looks like while surveillance runs, and how it is
 * drawn.
 *
 * A leaf of its own, like `RecTimer` and `DetectionOverlay`, because it needs
 * `frameAspect` — which lives in the per-frame context. Reading it from
 * `Viewfinder` would subscribe the whole viewfinder to a value that is pushed
 * on every analysed frame, which is exactly the split `ViewfinderProvider`
 * exists to keep.
 *
 * Everything is stored in upright-frame space and converted for display, never
 * the other way round: what was drawn is a rectangle on a particular viewfinder
 * at a particular size, and a phone that is rotated has a different one.
 */

/** Corners of a drag, in view pixels. */
interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function rectOf(drag: Drag) {
  return {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };
}

/** Dims everything the zone leaves out, in four pieces around it. */
function Mask({ box }: { box: DetectionBox }) {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return (
    <>
      <View style={[styles.mask, styles.maskTop, { height: `${box.y * 100}%` }]} />
      <View style={[styles.mask, styles.maskBottom, { top: `${bottom * 100}%` }]} />
      <View style={[styles.mask, styles.maskLeft, {
        top: `${box.y * 100}%`, width: `${box.x * 100}%`, height: `${box.height * 100}%`,
      }]} />
      <View style={[styles.mask, styles.maskRight, {
        left: `${right * 100}%`, top: `${box.y * 100}%`, height: `${box.height * 100}%`,
      }]} />
    </>
  );
}

export function ZoneLayer({ viewWidth, viewHeight }: { viewWidth: number; viewHeight: number }) {
  const { settings, zoneEditing, saveZone, cancelZoneEdit } = useAppState();
  const { frameAspect } = useViewfinderState();
  const [drag, setDrag] = useState<Drag | null>(null);

  // Held in a ref as well as state: the responder callbacks are captured once,
  // when the responder is built, so what they read has to be the live value and
  // not the one that existed at that render.
  const dragRef = useRef<Drag | null>(null);
  const setBoth = (next: Drag | null) => { dragRef.current = next; setDrag(next); };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => {
      const { locationX, locationY } = e.nativeEvent;
      setBoth({ x0: locationX, y0: locationY, x1: locationX, y1: locationY });
    },
    onPanResponderMove: (e, gesture) => {
      const start = dragRef.current;
      if (!start) return;
      // From the gesture's own displacement rather than `locationX`, which is
      // relative to whatever view is under the finger at the time and jumps
      // when the drag crosses one of the chips drawn over the preview.
      setBoth({ ...start, x1: start.x0 + gesture.dx, y1: start.y0 + gesture.dy });
    },
  }), []);

  if (viewWidth <= 0 || viewHeight <= 0) return null;

  if (!zoneEditing) {
    if (!settings.zone) return null;
    const shown = uprightBoxToViewBox(settings.zone, frameAspect, viewWidth, viewHeight);
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Mask box={shown} />
        <View style={[styles.zoneOutline, {
          left: `${shown.x * 100}%`, top: `${shown.y * 100}%`,
          width: `${shown.width * 100}%`, height: `${shown.height * 100}%`,
        }]} />
      </View>
    );
  }

  const rect = drag ? rectOf(drag) : null;
  const drawn: DetectionBox | null = rect && {
    x: rect.left / viewWidth,
    y: rect.top / viewHeight,
    width: rect.width / viewWidth,
    height: rect.height / viewHeight,
  };
  const usable = drawn != null && isUsableZone(drawn);

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={StyleSheet.absoluteFill} {...responder.panHandlers}>
        {rect && (
          <View style={[styles.drawn, usable ? styles.drawnUsable : styles.drawnTooSmall, {
            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
          }]} />
        )}
      </View>

      <View style={styles.editorBar}>
        <Text style={styles.editorHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {t(drawn && !usable ? 'zone.tooSmall' : 'zone.hint')}
        </Text>
        <View style={styles.editorButtons}>
          <Pressable
            style={({ pressed }) => [styles.editorButton, pressed && styles.editorButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('zone.cancel')}
            onPress={cancelZoneEdit}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.editorButtonText}>{t('zone.cancel')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.editorButton, pressed && styles.editorButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('zone.all')}
            onPress={() => saveZone(null)}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.editorButtonText}>{t('zone.all')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.editorButton, styles.editorButtonPrimary,
              !usable && styles.editorButtonOff, pressed && usable && styles.editorButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !usable }}
            accessibilityLabel={t('zone.save')}
            disabled={!usable}
            // Converted on the way in, once: the stored zone has to mean the
            // same part of the room after the phone is turned or the viewfinder
            // is a different size.
            onPress={() => saveZone(viewBoxToUprightBox(drawn!, frameAspect, viewWidth, viewHeight))}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.editorButtonText, styles.editorButtonTextPrimary]}>{t('zone.save')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(8,9,14,0.55)',
  },
  maskTop: { left: 0, top: 0, right: 0 },
  maskBottom: { left: 0, right: 0, bottom: 0 },
  maskLeft: { left: 0 },
  maskRight: { right: 0 },
  zoneOutline: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(145,132,217,0.45)',
    borderRadius: 4,
  },
  drawn: {
    position: 'absolute',
    borderWidth: 1.5,
    borderRadius: 4,
  },
  drawnUsable: {
    borderColor: color.accent,
    backgroundColor: 'rgba(145,132,217,0.14)',
  },
  drawnTooSmall: {
    borderColor: color.neutral600,
    backgroundColor: 'rgba(145,132,217,0.06)',
  },
  editorBar: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    padding: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(22,24,38,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(233,233,237,0.10)',
    gap: 8,
  },
  editorHint: {
    fontFamily: font.regular,
    fontSize: 10.5,
    color: color.neutral300,
    textAlign: 'center',
  },
  editorButtons: {
    flexDirection: 'row',
    gap: 7,
  },
  editorButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 7,
    alignItems: 'center',
    backgroundColor: color.neutral900,
    borderWidth: 1,
    borderColor: color.neutral800,
  },
  editorButtonPrimary: {
    backgroundColor: color.accent900,
    borderColor: color.accent700,
  },
  editorButtonOff: {
    opacity: 0.45,
  },
  editorButtonPressed: {
    opacity: 0.62,
  },
  editorButtonText: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.neutral300,
  },
  editorButtonTextPrimary: {
    color: color.accent300,
  },
});

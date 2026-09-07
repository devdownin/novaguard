import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { useViewfinderState } from '../state/AppStateContext';
import { uprightBoxToViewBox } from '../camera/framing';

/**
 * The per-frame half of the viewfinder: one box per confirmed subject.
 *
 * Its own leaf so that it, and not the whole viewfinder, is what re-renders at
 * the frame-processor rate. That is also what keeps the camera below it out of
 * the frame path — it renders as a sibling, from state this component never
 * touches.
 */
export function DetectionOverlay({ viewWidth, viewHeight }: { viewWidth: number; viewHeight: number }) {
  const { tracks, primaryTrackId, frameAspect } = useViewfinderState();

  if (viewWidth <= 0) return null;

  return (
    <>
      {tracks.map(track => {
        const viewBox = uprightBoxToViewBox(track.box, frameAspect, viewWidth, viewHeight);
        const isPrimary = track.id === primaryTrackId;
        return (
          <View
            key={track.id}
            pointerEvents="none"
            style={[
              styles.detBox,
              isPrimary ? styles.detBoxPrimary : styles.detBoxSecondary,
              {
                left: `${viewBox.x * 100}%`,
                top: `${viewBox.y * 100}%`,
                width: `${viewBox.width * 100}%`,
                height: `${viewBox.height * 100}%`,
              },
            ]}
          >
            <View style={[styles.detLabelChip, !isPrimary && styles.detLabelChipSecondary]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.detLabelText}>{track.kind}</Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.detConfText}>{Math.round(track.confidence * 100)} %</Text>
            </View>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  detBox: {
    position: 'absolute',
    borderRadius: 6,
  },
  detBoxPrimary: {
    borderWidth: 1.5,
    borderColor: color.accent,
  },
  // Extra subjects stay visible without competing with the one driving the recording.
  detBoxSecondary: {
    borderWidth: 1,
    borderColor: color.accent700,
  },
  detLabelChip: {
    position: 'absolute',
    top: -25,
    left: -1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 5,
    backgroundColor: 'rgba(22,24,38,0.82)',
    borderWidth: 1,
    borderColor: color.accent700,
  },
  detLabelChipSecondary: {
    opacity: 0.75,
  },
  detLabelText: {
    fontFamily: font.medium,
    fontSize: 10.5,
    letterSpacing: 0.4,
    color: color.accent300,
  },
  detConfText: {
    fontFamily: font.regular,
    fontSize: 10.5,
    color: color.neutral400,
  },
});

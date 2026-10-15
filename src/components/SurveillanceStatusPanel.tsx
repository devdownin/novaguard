import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppState } from '../state/AppStateContext';
import { STATUS_LABEL, statusColor, statusIsFault } from '../surveillance/status';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { presenceModeFor } from '../recording/presenceMode';
import { PrimaryOutlineButton } from './OutlineButton';
import { t } from '../i18n';
import { PulseDot } from './PulseDot';

export function SurveillanceStatusPanel() {
  const {
    surveillanceStatus: status,
    settings,
    perms,
    monitoring,
    retryCapture,
    acknowledgeMove,
    grantPermission,
    openCaptureSettings,
    openStorageSettings,
  } = useAppState();
  const fault = statusIsFault(status);
  const tint = statusColor(status);
  const mode = presenceModeFor(settings.post);
  const label = t(STATUS_LABEL[status]);
  const action = !perms.cam
    ? {
        label: t('surv.action.permission'),
        press: () => grantPermission('cam'),
      }
    : status === 'storage-insufficient'
    ? { label: t('surv.action.storage'), press: openStorageSettings }
    : status === 'camera-moved'
    ? { label: t('surv.action.moved'), press: acknowledgeMove }
    // Nothing to retry: the camera works, it just sees nothing.
    : status === 'camera-obstructed'
    ? null
    : fault && monitoring
    ? { label: t('surv.action.retry'), press: retryCapture }
    : null;
  return (
    <View style={styles.panel}>
      <View
        testID="surveillance-status"
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={label}
        style={styles.statusRow}
      >
        <PulseDot
          color={tint}
          size={12}
          pulse={status === 'recording' ? 'beat' : status === 'active' ? 'breathe' : 'none'}
        />
        <Text
          style={[styles.statusLabel, { color: tint }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          {label}
        </Text>
      </View>
      <Pressable
        onPress={openCaptureSettings}
        accessibilityRole="button"
        accessibilityLabel={t('surv.mode.change')}
        accessibilityHint={t(
          mode === 'strict'
            ? 'setup.mode.strict.sub'
            : 'setup.mode.tolerant.sub',
        )}
        style={({ pressed }) => [styles.modeButton, pressed && styles.pressed]}
      >
        <Text style={styles.mode} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {mode === 'strict'
            ? t('setup.mode.strict')
            : t('surv.mode.tolerant', { duration: settings.post })}
        </Text>
      </Pressable>
      {fault && (
        <Text style={styles.help} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {t(
            !perms.cam
              ? 'surv.recovery.permission'
              : status === 'camera-unavailable'
              ? 'surv.recovery.camera'
              : status === 'storage-insufficient'
              ? 'surv.recovery.storage'
              : status === 'camera-obstructed'
              ? 'surv.recovery.obstructed'
              : status === 'camera-moved'
              ? 'surv.recovery.moved'
              : 'surv.recovery.retry',
          )}
        </Text>
      )}
      {action && (
        <PrimaryOutlineButton
          testID="surveillance-recovery"
          label={action.label}
          onPress={action.press}
          style={styles.action}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    padding: 14,
    gap: 5,
    backgroundColor: color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    borderLeftColor: 'rgba(255,255,255,0.03)',
    borderRightColor: 'rgba(255,255,255,0.03)',
    borderBottomColor: 'transparent',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusLabel: {
    fontFamily: font.semibold,
    fontSize: 23,
    flexShrink: 1,
    lineHeight: 29,
  },
  modeButton: { minHeight: 44, justifyContent: 'center' },
  mode: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.neutral300,
    textDecorationLine: 'underline',
  },
  help: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: color.neutral400,
    marginBottom: 6,
  },
  pressed: { opacity: 0.7 },
  action: { minHeight: 44 },
});

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { color, font, radius, shadow, MAX_FONT_SCALE } from '../theme';
import { useAppState } from '../state/AppStateContext';
import { Permissions } from '../state/types';
import { SolidAccentButton } from './OutlineButton';
import { StringKey, t } from '../i18n';

const STEPS: { n: string; title: StringKey; body: StringKey }[] = [
  { n: '1', title: 'onb.step1', body: 'onb.step1.body' },
  { n: '2', title: 'onb.step2', body: 'onb.step2.body' },
  { n: '3', title: 'onb.step3', body: 'onb.step3.body' },
];

export function OnboardingModal() {
  const { onb, onbNext, onbFinish, perms, grantPermission } = useAppState();

  if (!onb) return null;

  const permRows: {
    key: keyof Permissions; label: string; note: string; enabled: boolean;
  }[] = [
    { key: 'cam', label: t('info.perm.cam'), note: t('onb.perm.cam.note'), enabled: true },
    // Both optional permissions unlock together, on the camera. Chaining
    // notifications behind the microphone contradicted the line right above
    // them — refusing the mic, which this screen invites, left the alerts of a
    // surveillance app permanently out of reach, and nothing else in the app
    // asks for them.
    { key: 'mic', label: t('info.perm.mic'), note: t('onb.perm.mic.note'), enabled: perms.cam },
    { key: 'notif', label: t('info.perm.notif'), note: t('onb.perm.notif.note'), enabled: perms.cam },
  ];

  const blocked = !perms.cam;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <LinearGradient colors={['rgba(16,18,32,0.9)', 'rgba(16,18,32,0.98)']} style={styles.backdrop}>
        {/* Scrollable, because this panel is taller than a landscape window:
            the backdrop pins it to the bottom, so anything that does not fit —
            the headline, and on the second step the camera row every other
            permission is gated behind — is cut off the top with no way to
            reach it. */}
        <ScrollView
          bounces={false}
          style={styles.panelScroll}
          contentContainerStyle={styles.panel}
        >
          {onb === 'intro' && (
            <View>
              <Text style={styles.kicker}>{t('onb.welcome')}</Text>
              <Text style={styles.headline}>{t('onb.headline')}</Text>
              <View style={{ gap: 14 }}>
                {STEPS.map(step => (
                  <View key={step.n} style={styles.stepRow}>
                    <View style={styles.stepBadge}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.stepBadgeText}>{step.n}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepTitle}>{t(step.title)}</Text>
                      <Text style={styles.stepBody}>{t(step.body)}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <SolidAccentButton label={t('onb.continue')} onPress={onbNext} style={{ width: '100%', marginTop: 22 }} />
            </View>
          )}

          {onb === 'perms' && (
            <View>
              <Text style={styles.kicker}>{t('onb.perms')}</Text>
              <Text style={styles.headlineSm}>{t('onb.perms.headline')}</Text>
              <Text style={styles.subtext}>{t('onb.perms.sub')}</Text>
              <View style={{ gap: 8 }}>
                {permRows.map(row => {
                  const granted = perms[row.key];
                  const disabled = !row.enabled || granted;
                  return (
                    <View
                      key={row.key}
                      style={[
                        styles.permRow,
                        {
                          opacity: row.enabled ? 1 : 0.4,
                          backgroundColor: granted ? color.accent900 : 'transparent',
                          borderColor: granted ? color.accent700 : color.neutral800,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.permLabel}>{row.label}</Text>
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.permNote}>{row.note}</Text>
                      </View>
                      <Pressable
                        testID={`onb-${row.key}`}
                        onPress={() => grantPermission(row.key)}
                        disabled={disabled}
                        accessibilityRole="button"
                        // Three buttons reading "Autoriser" in a column say
                        // nothing about which permission each one grants.
                        accessibilityLabel={t('a11y.allow', { name: row.label })}
                        accessibilityState={{ disabled }}
                        style={({ pressed }) => [
                          styles.permButton,
                          pressed && !disabled && { opacity: 0.62 },
                          {
                            borderColor: granted ? color.accent700 : row.enabled ? color.accent : color.neutral800,
                          },
                        ]}
                      >
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE}
                          style={[
                            styles.permButtonText,
                            { color: granted ? color.accent300 : row.enabled ? color.accent : color.neutral600 },
                          ]}
                        >
                          {t(granted ? 'onb.granted' : 'onb.grant')}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
              <SolidAccentButton
                label={t(blocked ? 'onb.blocked' : 'onb.start')}
                onPress={onbFinish}
                disabled={blocked}
                style={{ width: '100%', marginTop: 18 }}
              />
            </View>
          )}
        </ScrollView>
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  panelScroll: {
    flexGrow: 0,
    maxHeight: '92%',
  },
  panel: {
    padding: 20,
    paddingTop: 24,
    paddingBottom: 26,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: color.surface,
    ...shadow.lg,
  },
  kicker: {
    fontFamily: font.regular,
    fontSize: 11,
    letterSpacing: 1.5,
    color: color.accent300,
    marginBottom: 8,
  },
  headline: {
    fontFamily: font.medium,
    fontSize: 24,
    lineHeight: 27.6,
    color: color.text,
    marginBottom: 18,
  },
  headlineSm: {
    fontFamily: font.medium,
    fontSize: 21,
    lineHeight: 25.2,
    color: color.text,
    marginBottom: 6,
  },
  subtext: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.neutral500,
    marginBottom: 16,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.accent700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.accent300,
  },
  stepTitle: {
    fontFamily: font.medium,
    fontSize: 13.5,
    color: color.text,
  },
  stepBody: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.neutral500,
    marginTop: 2,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.lg - 3,
    borderWidth: 1,
  },
  permLabel: { fontFamily: font.medium, fontSize: 13, color: color.text },
  permNote: { fontFamily: font.regular, fontSize: 11, color: color.neutral600, marginTop: 1 },
  permButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  permButtonText: {
    fontFamily: font.regular,
    fontSize: 11.5,
  },
});

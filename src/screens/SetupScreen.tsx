import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Slider from '@react-native-community/slider';
import { color, font, radius } from '../theme';
import { useAppState } from '../state/AppStateContext';
import { Retention, Sensitivity } from '../state/types';
import { formatBytes } from '../recording/library';
import { describeClipGap, formatClipGap } from '../recording/clipGap';
import { describeAutoTune, formatAutoTune } from '../camera/autoTune';
import { APP_LICENSE, APP_VERSION, ISSUES_URL, REPO_URL } from '../constants/app';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { SettingRow, StaticValue, ValueButton } from '../components/SetupRows';
import { Switch } from '../components/Switch';
import { SegmentedControl } from '../components/SegmentedControl';
import { PrimaryOutlineButton, SecondaryOutlineButton } from '../components/OutlineButton';
import { ShieldCheckIcon } from '../components/icons';
import { StringKey, t, tValue } from '../i18n';
import { useLandscape } from '../utils/useLandscape';

// Labels translated, values not: the variants are written to disk. See the
// note at the end of `i18n/fr.ts`.
const SENS_OPTIONS: { label: string; value: Sensitivity }[] = [
  { label: tValue('value.sens.Basse'), value: 'Basse' },
  { label: tValue('value.sens.Moyenne'), value: 'Moyenne' },
  { label: tValue('value.sens.Haute'), value: 'Haute' },
];

const RETENTION_OPTIONS: Retention[] = ['1 jour', '7 jours', '30 jours', '90 jours', 'Toujours'];

// The sensitivity setting is really an analysis rate: it decides how often the
// scene is looked at, so it decides how fast a subject is confirmed. Saying so
// beats leaving three words the user has to guess at.
const SENS_HINT: Record<Sensitivity, StringKey> = {
  Basse: 'setup.sens.hint.Basse',
  Moyenne: 'setup.sens.hint.Moyenne',
  Haute: 'setup.sens.hint.Haute',
};

export function SetupScreen() {
  const s = useAppState();
  const landscape = useLandscape();
  const { settings, events, storage: store, clipGap, autoTune, deviceLoad } = s;

  // Share of the whole volume taken by NovaGuard's own clips. Kept visible at a
  // sliver once anything is stored, so the bar never reads as "nothing on disk".
  const usedPercent = store.total > 0
    ? Math.min(100, Math.max(store.used > 0 ? 1 : 0, (store.used / store.total) * 100))
    : 0;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('setup.title')}</Text>
      {/* Landscape is ~800 dp wide: full-bleed rows would put a switch a whole
          screen away from the label it belongs to. */}
      <ScrollView
        contentContainerStyle={[styles.list, landscape && styles.listCentered]}
        showsVerticalScrollIndicator={false}
      >

        <CollapsibleSection title={t('setup.section.surv')} expanded={settings.exp.surv} onToggle={() => s.toggleSection('surv')}>
          <SettingRow label={t('setup.camera')}>
            <ValueButton
              label={tValue(`value.camera.${settings.camera}`)}
              onPress={s.cycleCamera}
              accessibilityLabel={t('a11y.setting', { name: t('setup.camera'), value: tValue(`value.camera.${settings.camera}`) })}
            />
          </SettingRow>
          <SettingRow
            label={t('setup.resume')}
            subtitle={t('setup.resume.sub')}
          >
            <Switch value={settings.resumeOnLaunch} onValueChange={s.toggleResumeOnLaunch} accessibilityLabel={t('setup.resume')} />
          </SettingRow>
          <SettingRow label={t('setup.night')} subtitle={t('setup.night.sub')}>
            <Switch value={settings.night} onValueChange={s.toggleNight} accessibilityLabel={t('setup.night')} />
          </SettingRow>
        </CollapsibleSection>

        <CollapsibleSection title={t('setup.section.det')} expanded={settings.exp.det} onToggle={() => s.toggleSection('det')}>
          <SettingRow label={t('setup.person')}>
            <Switch value={settings.person} onValueChange={s.togglePerson} accessibilityLabel={t('setup.person')} />
          </SettingRow>
          <SettingRow label={t('setup.animal')}>
            <Switch value={settings.animal} onValueChange={s.toggleAnimal} accessibilityLabel={t('setup.animal')} />
          </SettingRow>
          <SettingRow label={t('setup.autoZoom')} subtitle={t('setup.autoZoom.sub')}>
            <Switch value={settings.autoZoom} onValueChange={s.toggleAutoZoom} accessibilityLabel={t('setup.autoZoom')} />
          </SettingRow>
          <SettingRow
            label={t('setup.precise')}
            subtitle={t('setup.precise.sub')}
          >
            <Switch
              value={settings.preciseDetection}
              onValueChange={s.togglePreciseDetection}
              accessibilityLabel={t('setup.precise')}
            />
          </SettingRow>
          <SettingRow label={t('setup.autoTuneSwitch')} subtitle={t('setup.autoTuneSwitch.sub')}>
            <Switch
              value={settings.autoTune}
              onValueChange={s.toggleAutoTune}
              accessibilityLabel={t('setup.autoTuneSwitch')}
            />
          </SettingRow>
          {/* Under the switch it belongs to, not in "À propos": what the app
              has taken away from itself is a detection setting that moved, not
              a fact about the build. The value is the current one, and pressing
              it opens the series behind it. */}
          <SettingRow
            label={t('setup.autoTune')}
            subtitle={describeAutoTune(autoTune, deviceLoad.current)}
          >
            <ValueButton
              testID="autotune-open"
              label={formatAutoTune(autoTune)}
              onPress={() => s.openInfo('autotune')}
              accessibilityLabel={t('a11y.setting', {
                name: t('setup.autoTune'), value: formatAutoTune(autoTune),
              })}
            />
          </SettingRow>
          <SettingRow label={t('setup.zone')} subtitle={t('setup.zone.sub')}>
            <ValueButton
              label={t(settings.zone ? 'setup.zone.set' : 'setup.zone.all')}
              onPress={s.beginZoneEdit}
              active={settings.zone != null}
              accessibilityLabel={t('a11y.setting', {
                name: t('setup.zone'),
                value: t(settings.zone ? 'setup.zone.set' : 'setup.zone.all'),
              })}
            />
          </SettingRow>
          <SettingRow
            label={t('setup.forceCpu')}
            subtitle={t('setup.forceCpu.sub')}
          >
            <Switch value={settings.forceCpu} onValueChange={s.toggleForceCpu} accessibilityLabel={t('setup.forceCpu')} />
          </SettingRow>
          <View style={styles.subBlock}>
            <Text style={styles.subLabel}>{t('setup.sens')}</Text>
            <SegmentedControl
              options={SENS_OPTIONS}
              value={settings.sens}
              onChange={s.setSensitivity}
              fontSize={11.5}
              paddingVertical={7}
              segmentRadius={7}
            />
            <Text style={styles.hint}>
              {t(SENS_HINT[settings.sens])}
            </Text>
          </View>
          <View style={[styles.subBlock, { paddingTop: 14, paddingBottom: 2 }]}>
            <View style={styles.thresholdRow}>
              <Text style={styles.subLabel}>{t('setup.threshold')}</Text>
              <Text style={styles.thresholdValue}>{t('detail.percent', { value: settings.threshold })}</Text>
            </View>
            <Slider
              accessibilityRole="adjustable"
              accessibilityLabel={t('setup.threshold')}
              accessibilityValue={{ min: 50, max: 95, now: settings.threshold }}
              minimumValue={50}
              maximumValue={95}
              step={5}
              value={settings.threshold}
              onSlidingComplete={s.setThreshold}
              minimumTrackTintColor={color.accent}
              maximumTrackTintColor={color.neutral800}
              thumbTintColor={color.accent}
            />
          </View>
        </CollapsibleSection>

        <CollapsibleSection title={t('setup.section.rec')} expanded={settings.exp.rec} onToggle={() => s.toggleSection('rec')}>
          <SettingRow label={t('setup.post')}>
            <ValueButton
              label={settings.post}
              onPress={s.cyclePost}
              accessibilityLabel={t('a11y.setting', { name: t('setup.post'), value: settings.post })}
            />
          </SettingRow>
          <SettingRow
            label={t('setup.max')}
            subtitle={t('setup.max.sub')}
          >
            <ValueButton
              label={settings.max}
              onPress={s.cycleMax}
              accessibilityLabel={t('a11y.setting', { name: t('setup.max'), value: settings.max })}
            />
          </SettingRow>
          {/* Under "Durée max. par clip", which is the setting that creates
              this gap: the cap ends a file without ending the passage, and this
              is what that costs. Only a real device can answer it, so the app
              measures itself rather than shipping a figure nobody took. */}
          <SettingRow label={t('setup.clipGap')} subtitle={describeClipGap(clipGap)}>
            <StaticValue label={formatClipGap(clipGap)} />
          </SettingRow>
          <SettingRow
            label={t('setup.quality')}
            subtitle={settings.quality === '4K' ? t('setup.quality.sub4k') : undefined}
          >
            <ValueButton
              label={settings.quality}
              onPress={s.cycleQuality}
              accessibilityLabel={t('a11y.setting', { name: t('setup.quality'), value: settings.quality })}
            />
          </SettingRow>
        </CollapsibleSection>

        <CollapsibleSection title={t('setup.section.sto')} expanded={settings.exp.sto} onToggle={() => s.toggleSection('sto')}>
          <View style={[styles.subBlock, { borderTopWidth: 1, borderTopColor: color.divider }]}>
            <View style={styles.storageBarTrack}>
              <View style={[styles.storageBarFill, { width: `${usedPercent}%` }]} />
            </View>
            <View style={styles.storageStatsRow}>
              <View>
                <Text style={styles.storageStatLabel}>{t('setup.storage.used')}</Text>
                <Text style={styles.storageStatValue}>{formatBytes(store.used)}</Text>
              </View>
              <View>
                <Text style={styles.storageStatLabel}>{t('setup.storage.free')}</Text>
                <Text style={styles.storageStatValue}>{formatBytes(store.free)}</Text>
              </View>
              <View>
                <Text style={styles.storageStatLabel}>{t('setup.storage.videos')}</Text>
                <Text style={styles.storageStatValue}>{events.length}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.subBlock, { borderTopWidth: 1, borderTopColor: color.divider }]}>
            <Text style={styles.subLabel}>{t('setup.retention')}</Text>
            <View style={styles.retentionWrap}>
              {RETENTION_OPTIONS.map(opt => {
                const on = settings.retention === opt;
                return (
                  <ValueButton
                    key={opt}
                    label={tValue(`value.retention.${opt}`)}
                    onPress={() => s.setRetention(opt)}
                    accessibilityLabel={t('a11y.setting', {
                      name: t('setup.retention'),
                      value: tValue(`value.retention.${opt}`),
                    })}
                    active={on}
                    pill
                  />
                );
              })}
            </View>
          </View>

          <SettingRow label={t('setup.autoDel')} subtitle={t('setup.autoDel.sub')}>
            <Switch value={settings.autoDel} onValueChange={s.toggleAutoDel} accessibilityLabel={t('setup.autoDel')} />
          </SettingRow>

          <SecondaryOutlineButton label={t('setup.wipe')} onPress={s.wipeAllVideos} style={{ marginTop: 10 }} />
        </CollapsibleSection>

        <CollapsibleSection title={t('setup.section.not')} expanded={settings.exp.not} onToggle={() => s.toggleSection('not')}>
          <SettingRow label={t('setup.notif')}>
            <Switch value={settings.notif} onValueChange={s.toggleNotif} accessibilityLabel={t('setup.notif')} />
          </SettingRow>
          <SettingRow label={t('setup.notifDet')}>
            <Switch value={settings.notifDet} onValueChange={s.toggleNotifDet} accessibilityLabel={t('setup.notifDet')} />
          </SettingRow>
          <SecondaryOutlineButton
            label={t('setup.sound')}
            onPress={s.openAlertSoundSettings}
            style={{ marginTop: 10 }}
          />
          <Text style={styles.hint}>{t('setup.sound.hint')}</Text>
        </CollapsibleSection>

        <LinearGradient
          colors={[color.accent900, color.surface]}
          locations={[0, 0.7]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.75, y: 1 }}
          style={styles.privacyCard}
        >
          <Text style={styles.privacyTitle}>{t('setup.privacy')}</Text>
          <View style={styles.privacyBody}>
            <ShieldCheckIcon size={18} color={color.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.privacyHeading}>{t('setup.privacy.heading')}</Text>
              <Text style={styles.privacyText}>{t('setup.privacy.body')}</Text>
            </View>
          </View>
          <View style={styles.privacyActions}>
            <PrimaryOutlineButton label={t('setup.privacy.perms')} onPress={() => s.openInfo('perms')} style={{ flex: 1 }} />
            <SecondaryOutlineButton label={t('setup.privacy.data')} onPress={() => s.openInfo('data')} style={{ flex: 1 }} />
          </View>
        </LinearGradient>

        <CollapsibleSection title={t('setup.section.about')} expanded={settings.exp.about} onToggle={() => s.toggleSection('about')}>
          <SettingRow label={t('setup.version')}>
            <StaticValue label={APP_VERSION} />
          </SettingRow>
          <SettingRow label={t('setup.license')} subtitle={t('setup.license.sub')}>
            <StaticValue label={APP_LICENSE} />
          </SettingRow>
          <View style={[styles.subBlock, { flexDirection: 'row', gap: 7 }]}>
            <PrimaryOutlineButton label={t('setup.source')} onPress={() => Linking.openURL(REPO_URL)} style={{ flex: 1 }} />
            <SecondaryOutlineButton label={t('setup.report')} onPress={() => Linking.openURL(ISSUES_URL)} style={{ flex: 1 }} />
          </View>
          <SecondaryOutlineButton label={t('setup.thirdParty')} onPress={() => s.openInfo('licenses')} style={{ marginTop: 8, marginBottom: 6 }} />
        </CollapsibleSection>

        <Text style={styles.footer}>NovaGuard {APP_VERSION} · open source · détection sur appareil</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: {
    fontFamily: font.medium,
    fontSize: 20,
    color: color.text,
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  list: {
    paddingHorizontal: 14,
    paddingBottom: 18,
    gap: 8,
  },
  listCentered: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  subBlock: {
    paddingVertical: 12,
  },
  subLabel: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.text,
    marginBottom: 9,
  },
  thresholdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  thresholdValue: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.accent300,
    fontVariant: ['tabular-nums'],
  },
  storageBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: color.neutral900,
    overflow: 'hidden',
  },
  storageBarFill: {
    height: '100%',
    backgroundColor: color.accent600,
  },
  storageStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 9,
  },
  storageStatLabel: {
    fontFamily: font.regular,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: color.neutral600,
  },
  storageStatValue: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: color.text,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    color: color.neutral600,
    marginTop: 8,
  },
  retentionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  privacyCard: {
    borderRadius: radius.lg - 3,
    padding: 14,
  },
  privacyTitle: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: color.neutral300,
    marginBottom: 10,
  },
  privacyBody: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  privacyHeading: {
    fontFamily: font.medium,
    fontSize: 13.5,
    color: color.text,
  },
  privacyText: {
    fontFamily: font.regular,
    fontSize: 11.5,
    lineHeight: 17,
    color: color.neutral400,
    marginTop: 2,
  },
  privacyActions: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
  },
  footer: {
    textAlign: 'center',
    fontFamily: font.regular,
    fontSize: 10,
    color: color.neutral700,
    paddingTop: 6,
    paddingBottom: 2,
  },
});

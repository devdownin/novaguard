import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, font } from '../theme';
import { useAppState } from '../state/AppStateContext';
import { THIRD_PARTY_LICENSES } from '../constants/app';
import { formatBytes } from '../recording/library';
import { Sheet } from './Sheet';
import { PrimaryOutlineButton } from './OutlineButton';
import { ValueButton } from './SetupRows';
import { StringKey, t, tn } from '../i18n';

const TITLES: Record<'perms' | 'data' | 'licenses', StringKey> = {
  perms: 'info.perms',
  data: 'info.data',
  licenses: 'info.licenses',
};

export function InfoSheet() {
  const { info, closeInfo, perms, events, storage: store, storedSize, grantPermission } = useAppState();
  /**
   * `autotune` rides the same "which panel is up" state but is a screen of its
   * own (`AutoTuneSheet`), not a list of rows. Filtered out here rather than
   * allowed to fall through to the data rows, which is what it would otherwise
   * draw under the wrong title.
   */
  const panel = info === 'autotune' ? null : info;

  const clipCount = events.filter(e => e.path != null).length;

  /**
   * Refusing a permission has to be recoverable here.
   *
   * Onboarding was the only place in the app that ever asked for one, and it is
   * shown once — so a permission refused there, which that screen explicitly
   * invites for the microphone and the notifications, could never be granted
   * again. This panel was the natural second chance and only reported the
   * state it was powerless to change.
   */
  const rows = panel === 'perms'
    ? [
      { key: 'cam' as const, label: t('info.perm.cam'), note: t('info.perm.cam.note'), value: t('info.perm.cam.granted') },
      { key: 'mic' as const, label: t('info.perm.mic'), note: t('info.perm.mic.note'), value: t('info.perm.mic.granted') },
      { key: 'notif' as const, label: t('info.perm.notif'), note: t('info.perm.notif.note'), value: t('info.perm.notif.granted') },
      // Granted by installing the app: nothing to ask for, so nothing to press.
      { label: t('info.perm.storage'), note: t('info.perm.storage.note'), value: t('info.perm.storage.granted') },
    ]
    : panel === 'licenses'
      ? THIRD_PARTY_LICENSES.map(lib => ({ label: lib.name, note: t(lib.noteKey), value: lib.license }))
      : [
        // Files, not events: a sighting the encoder produced nothing for is
        // kept as history and has nothing on disk to count.
        {
          label: t('info.data.clips'),
          note: t('info.data.clips.note'),
          value: tn('info.data.clips.value.other', clipCount, { size: formatBytes(store.used) }),
        },
        // Measured, both of them. These two rows used to be constants — and one
        // of them billed 2,1 Mo to a thumbnail cache that exists nowhere in this
        // repository. The screen that tells the user what is kept about them is
        // the last place to invent a number.
        { label: t('info.data.journal'), note: t('info.data.journal.note'), value: formatBytes(storedSize.journal) },
        { label: t('info.data.settings'), note: t('info.data.settings.note'), value: formatBytes(storedSize.settings) },
        { label: t('info.data.sent'), note: t('info.data.sent.note'), value: t('info.data.sent.value') },
      ];

  return (
    <Sheet visible={!!panel} onClose={closeInfo} maxHeightPercent={76}>
      <Text style={styles.title}>{panel ? t(TITLES[panel]) : ''}</Text>
      {rows.map(row => {
        const key = 'key' in row ? row.key : null;
        const granted = key ? perms[key] : true;
        return (
          <View key={row.label} style={styles.row} testID={key ? `perm-${key}` : undefined}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.note}>{row.note}</Text>
            </View>
            {granted
              ? <Text style={styles.value}>{row.value}</Text>
              : (
                <ValueButton
                  label={t('info.allow')}
                  onPress={() => grantPermission(key!)}
                  accessibilityLabel={t('a11y.allow', { name: row.label })}
                />
              )}
          </View>
        );
      })}
      <PrimaryOutlineButton label={t('info.close')} onPress={closeInfo} style={{ width: '100%', marginTop: 16 }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: font.medium,
    fontSize: 17,
    color: color.text,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: color.divider,
  },
  label: { fontFamily: font.regular, fontSize: 13, color: color.text },
  note: { fontFamily: font.regular, fontSize: 11, color: color.neutral600, marginTop: 1 },
  value: { fontFamily: font.regular, fontSize: 12, color: color.accent300 },
});

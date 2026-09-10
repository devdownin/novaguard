/**
 * The two catalogues, and the one coupling a translation can silently break.
 *
 * Completeness is already a compile error — `en.ts` is typed as a total record
 * of `StringKey` — so what is left is everything TypeScript cannot see: a
 * placeholder dropped in translation, a plural form that never gets picked, and
 * the error prefixes the camera path matches on.
 *
 * The rest of the suite runs on a French device (`testing/frenchDevice.js`), so
 * this file is also the only place the English catalogue is ever rendered.
 *
 * @format
 */

import { NativeModules } from 'react-native';
import { fr, StringKey } from '../src/i18n/fr';
import { en } from '../src/i18n/en';
import { t, tn, language } from '../src/i18n';

const keys = Object.keys(fr) as StringKey[];

/** `{name}` placeholders, in order of appearance. */
const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();

describe('the two catalogues', () => {
  it('carries the same placeholders in both languages', () => {
    // A dropped `{count}` renders a sentence with its number missing — a
    // grammatical string that says something false. An added one renders the
    // brace and the name, raw, to the user.
    const mismatched = keys.filter(
      key => placeholders(fr[key]).join() !== placeholders(en[key]).join(),
    );
    expect(mismatched).toEqual([]);
  });

  it('translates every string', () => {
    // A key copied over untouched is almost always a forgotten translation.
    // The exceptions are the words that really are identical in both, and they
    // are listed rather than pattern-matched, so a new one is a decision.
    const identical = keys.filter(key => fr[key] === en[key]);
    expect(identical.sort()).toEqual([
      // Punctuation only — there is nothing to translate.
      'a11y.event',
      'detail.percent',
      'detail.type',
      'info.perm.mic',
      'info.perm.notif',
      'info.perms',
      'setup.license',
      'setup.privacy.perms',
      'setup.section.not',
      'setup.title',
      'setup.version',
      'tab.setup',
      'value.kind.Animal',
    ]);
  });

  it('leaves no empty string', () => {
    expect(keys.filter(key => !fr[key].trim() || !en[key].trim())).toEqual([]);
  });
});

describe('on a French device', () => {
  it('renders French', () => {
    expect(language).toBe('fr');
    expect(t('surv.cta.start')).toBe('DÉMARRER LA SURVEILLANCE');
  });

  it('fills placeholders and picks the plural form', () => {
    expect(tn('hist.count.other', 1)).toBe('1 vidéo');
    expect(tn('hist.count.other', 4)).toBe('4 vidéos');
    expect(t('detail.percent', { value: 90 })).toBe('90 %');
  });
});

describe('on an English device', () => {
  /** Re-imports the module against another locale, the way a reboot would. */
  function asEnglish() {
    jest.resetModules();
    const saved = NativeModules.I18nManager;
    NativeModules.I18nManager = {
      getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: false, localeIdentifier: 'en_US' }),
    };
    const mod = require('../src/i18n') as typeof import('../src/i18n');
    NativeModules.I18nManager = saved;
    return mod;
  }

  it('renders English', () => {
    const i18n = asEnglish();
    expect(i18n.language).toBe('en');
    expect(i18n.t('surv.cta.start')).toBe('START MONITORING');
    expect(i18n.tn('hist.count.other', 1)).toBe('1 video');
    expect(i18n.tn('hist.count.other', 4)).toBe('4 videos');
  });

  it('formats sizes the way an English reader reads them', () => {
    // Not a translation detail: "1,5 GB" and "1.5 GB" are different numbers to
    // the two readers, and the separator is the only thing that says which.
    jest.resetModules();
    const saved = NativeModules.I18nManager;
    NativeModules.I18nManager = {
      getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: false, localeIdentifier: 'en_GB' }),
    };
    const { formatBytes } = require('../src/recording/library') as typeof import('../src/recording/library');
    NativeModules.I18nManager = saved;

    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
    expect(formatBytes(400 * 1024)).toBe('400 KB');
  });

  it('keeps a Belgian device on French', () => {
    jest.resetModules();
    const saved = NativeModules.I18nManager;
    NativeModules.I18nManager = {
      getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: false, localeIdentifier: 'fr_BE' }),
    };
    const mod = require('../src/i18n') as typeof import('../src/i18n');
    NativeModules.I18nManager = saved;

    // The language decides, not the country: `fr_BE` asked for French.
    expect(mod.language).toBe('fr');
  });
});

/**
 * `reportCameraProblem` clears only the banners whose text starts with one of
 * three words. Those words are in the catalogue, so a translator can move them
 * — and moving one *without* the sentence built on it leaves an error sitting
 * in the viewfinder for the rest of the session, with nothing to say it is
 * stale. Nothing else in the suite can see that: it is one string starting with
 * another.
 */
describe('the error prefixes the camera path matches on', () => {
  it.each([['fr', fr], ['en', en]] as const)('holds in %s', (_lang, catalogue) => {
    expect(catalogue['error.camera'].startsWith(catalogue['error.prefix.camera'])).toBe(true);
    expect(catalogue['error.model'].startsWith(catalogue['error.prefix.model'])).toBe(true);
    for (const key of ['error.frame.interrupted', 'error.frame.detail', 'error.frame.duringStage'] as const) {
      expect(catalogue[key].startsWith(catalogue['error.prefix.frame'])).toBe(true);
    }
  });
});

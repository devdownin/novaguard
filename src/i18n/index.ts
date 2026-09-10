import { I18nManager, NativeModules } from 'react-native';
import { fr, StringKey } from './fr';
import { en } from './en';

/**
 * The device's language, read once.
 *
 * Once, because it cannot change under a running app: `locale` is *not* in the
 * activity's `configChanges` (unlike `orientation`), so Android recreates the
 * process when the system language changes and this module is loaded again
 * with the new value. Making it reactive would add a subscription that can
 * never fire.
 *
 * `I18nManager` is the authority — it reports what Android itself resolved.
 * `Intl` is the fallback for anything that does not expose it (the Jest
 * environment, chiefly), and a hardcoded `fr` is the last resort so a broken
 * lookup shows the app's own language rather than raw keys.
 */
function deviceLanguage(): string {
  try {
    const identifier =
      (NativeModules?.I18nManager?.getConstants?.() ?? I18nManager.getConstants?.())?.localeIdentifier;
    if (typeof identifier === 'string' && identifier.length >= 2) return identifier;
  } catch {
    // Falls through to Intl.
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'fr';
  }
}

/**
 * French for French-speaking devices, English for everyone else.
 *
 * Not "English unless the catalogue has the language": with two locales, the
 * choice is between showing a Belgian or Swiss user French — which their
 * device asked for — and showing a German user French, which they did not.
 */
export const language: 'fr' | 'en' = deviceLanguage().slice(0, 2).toLowerCase() === 'fr' ? 'fr' : 'en';

const catalogue: Record<StringKey, string> = language === 'fr' ? fr : en;

type Vars = Record<string, string | number>;

/** Fills `{name}` placeholders. A name with no value is left visible on purpose. */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole);
}

/** One string, in the device's language. */
export function t(key: StringKey, vars?: Vars): string {
  return interpolate(catalogue[key] ?? fr[key], vars);
}

/**
 * The singular or plural form of a string, by count.
 *
 * Both locales here split at exactly one, and `count` is always passed on as a
 * variable so the number never has to be concatenated at the call site.
 */
export function tn(key: `${string}.one` | `${string}.other`, count: number, vars?: Vars): string;
export function tn(key: string, count: number, vars?: Vars): string {
  const base = key.replace(/\.(one|other)$/, '');
  const form = (count === 1 ? `${base}.one` : `${base}.other`) as StringKey;
  return t(form, { count, ...vars });
}

/**
 * The display form of a value stored in French.
 *
 * Typed against the catalogue rather than taking a free string: a call like
 * `tValue(`value.sens.${sens}`)` is checked at compile time, so renaming a
 * variant of `Sensitivity` fails the build here instead of rendering the raw
 * identifier to an English reader.
 */
export type ValueKey = Extract<StringKey, `value.${string}`>;

export function tValue(key: ValueKey): string {
  return t(key);
}

export type { StringKey };

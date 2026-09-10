/**
 * Makes the test device a French one, the way Android actually reports it.
 *
 * The suite asserts the French interface — the language every string was
 * written and reviewed in — so the locale has to be pinned, exactly as
 * `jest.config.js` pins the timezone for the same class of reason.
 *
 * Pinned through `NativeModules.I18nManager`, not through `Intl`: that is the
 * source `src/i18n` reads first on a device, so the tests exercise the real
 * path instead of its fallback. (`Intl` could not be pinned here anyway —
 * Node resolves its default locale at process start, before any setup file
 * runs.)
 *
 * `__tests__/i18n.test.ts` re-imports the module with another identifier to
 * exercise the English catalogue.
 *
 * @format
 */

const { NativeModules } = require('react-native');

NativeModules.I18nManager = {
  ...NativeModules.I18nManager,
  getConstants: () => ({
    isRTL: false,
    doLeftAndRightSwapInRTL: true,
    localeIdentifier: 'fr_FR',
  }),
};

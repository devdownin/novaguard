// Europe/Paris rather than the runner's UTC: NovaGuard's day boundaries are
// local, and on UTC a daylight-saving bug in them cannot fail a test.
process.env.TZ = 'Europe/Paris';

module.exports = {
  preset: 'react-native',
  // NovaGuard is Android-only. Without this the preset resolves `.ios.js`
  // files and reports Platform.OS as 'ios', so platform branches (the TFLite
  // GPU delegate choice, for one) would be tested on the wrong path.
  haste: { defaultPlatform: 'android', platforms: ['android', 'native'] },
  setupFiles: [
    '@react-native-async-storage/async-storage/jest',
    // The locale, pinned for the same reason as the timezone above: this suite
    // asserts the French interface. See the file for why it goes through
    // NativeModules rather than Intl.
    '<rootDir>/testing/frenchDevice.js',
  ],
  transform: {
    // Bundled TFLite model — treat it like RN's other binary assets under Jest.
    '^.+\\.tflite$': require.resolve('react-native/jest/assetFileTransformer.js'),
  },
  /**
   * Jest's default is 5 s, which is a hang guard here and nothing more: no
   * assertion in this suite measures elapsed time — everything that depends on
   * a clock drives fake timers, which cost no wall clock at all.
   *
   * 5 s was nonetheless too tight on a loaded CI runner. The suites that mount
   * `AppStateProvider` with the viewfinder take under a second on an idle
   * machine, but two cores shared between twenty-five suites — one of which
   * runs the real Babel worklets compiler — stretched that past the limit and
   * failed a test that asserts an object identity. Raising the guard costs a
   * genuine hang a few extra seconds to report; leaving it there costs a red
   * build on a green tree, which is far more expensive.
   */
  testTimeout: 30_000,
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-native-async-storage|react-native-svg|react-native-linear-gradient|@react-native-community)/)',
  ],
};

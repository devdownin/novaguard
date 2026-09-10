// The worklets-core plugin compiles 'worklet' functions for the real camera
// frame-processor thread — not meaningful under Jest (jest sets NODE_ENV=test),
// where react-native-vision-camera itself is mocked out, so it's skipped there.
const isTest = process.env.NODE_ENV === 'test';

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: isTest ? [] : ['react-native-worklets-core/plugin'],
};

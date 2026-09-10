// No native Worklets module in the Jest environment — see react-native-vision-camera.js.
module.exports = {
  useRunOnJS: callback => (...args) => Promise.resolve(callback(...args)),
  useSharedValue: initial => ({ value: initial }),
  worklet: fn => fn,
  isWorklet: () => false,
};

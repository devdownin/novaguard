// No native resize plugin in the Jest environment — see react-native-vision-camera.js.
module.exports = {
  useResizePlugin: () => ({ resize: () => new Uint8Array() }),
  createResizePlugin: () => ({ resize: () => new Uint8Array() }),
};

// No native ML Kit face detector in the Jest environment — see react-native-vision-camera.js.
//
// The stand-in reproduces the one behaviour of the real hook that matters here:
// `useFaceDetector` memoizes on the options object's *identity*, and every miss
// builds a new native plugin holding an ML Kit FaceDetector that nothing ever
// closes. A mock that always returned the same object would make that leak
// untestable, which is how it survived.
const { useMemo } = require('react');

const created = [];
const stopListeners = jest.fn();

function useFaceDetector(options) {
  return useMemo(() => {
    created.push(options);
    return { detectFaces: () => [], stopListeners };
  }, [options]);
}

module.exports = {
  useFaceDetector,
  /** The options each plugin instance was built with, in order. */
  __created: () => created,
  __stopListeners: stopListeners,
  __reset: () => {
    created.length = 0;
    stopListeners.mockClear();
  },
};

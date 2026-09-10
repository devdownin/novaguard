// No native TFLite module in the Jest environment — see react-native-vision-camera.js.
//
// `useTensorflowModel` is configurable so tests can drive the load states the
// real plugin reports ('loading' | 'loaded' | 'error') and exercise the
// GPU-to-CPU delegate fallback in src/camera/useDetectionModel.ts.
const state = {
  // Called with (source, delegate); returns whatever the test asked for.
  resolve: () => ({ state: 'loading', model: undefined }),
  calls: [],
};

function useTensorflowModel(source, delegate) {
  state.calls.push({ source, delegate });
  return state.resolve(source, delegate);
}

module.exports = {
  useTensorflowModel,
  loadTensorflowModel: () => Promise.reject(new Error('not available in tests')),
  __setResolver: fn => { state.resolve = fn; },
  __calls: () => state.calls,
  __reset: () => {
    state.resolve = () => ({ state: 'loading', model: undefined });
    state.calls = [];
  },
};

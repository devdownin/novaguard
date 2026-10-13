// No native TFLite module in the Jest environment — see react-native-vision-camera.js.
//
// Resolve loading through a Promise, as the native loader does. The dedicated
// initialization suite additionally uses the real library asset loader.
const state = {
  // Called with (source, delegate); returns whatever the test asked for.
  resolve: () => ({ state: 'loading', model: undefined }),
  calls: [],
};

function useTensorflowModel(source, delegate) {
  state.calls.push({ source, delegate });
  return state.resolve(source, delegate);
}

function loadTensorflowModel(source, delegate) {
  state.calls.push({ source, delegate });
  return Promise.resolve().then(() => state.resolve(source, delegate)).then(result => {
    if (result.state === 'loaded') return result.model;
    if (result.state === 'error') throw result.error;
    return new Promise(() => {});
  });
}

module.exports = {
  useTensorflowModel,
  loadTensorflowModel,
  __setResolver: fn => { state.resolve = fn; },
  __calls: () => state.calls,
  __reset: () => {
    state.resolve = () => ({ state: 'loading', model: undefined });
    state.calls = [];
  },
};

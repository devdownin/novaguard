// In-memory AsyncStorage for tests.
//
// The package's `.../jest` setup file registers a stand-in whose legacy methods
// (clear, multiGet) still reach for the native module and throw, and its own
// AsyncStorageMock lives behind a subpath Jest's resolver won't follow. A few
// lines of Map is simpler than either, and lets tests seed and clear state.
const store = new Map();

module.exports = {
  getItem: async key => (store.has(key) ? store.get(key) : null),
  setItem: async (key, value) => { store.set(key, String(value)); },
  removeItem: async key => { store.delete(key); },
  getAllKeys: async () => [...store.keys()],
  clear: async () => { store.clear(); },
  getMany: async keys => Object.fromEntries(keys.map(k => [k, store.get(k) ?? null])),
  setMany: async entries => {
    for (const [k, v] of Object.entries(entries)) store.set(k, String(v));
  },
  removeMany: async keys => { for (const k of keys) store.delete(k); },
};

// Jest can't load the native Camera module (no native bridge in the test
// environment), so tests get a minimal stand-in: permissions denied, no
// device found. That's enough to render the fallback UI without crashing — it
// doesn't exercise real camera or recording behavior.
//
// The permission hooks are jest.fn()s rather than plain arrows so a test can
// say "the camera is authorised" and drive the paths that depend on it.
const denied = { hasPermission: false, requestPermission: jest.fn() };

module.exports = {
  Camera: Object.assign(() => null, {
    // Static permission getters used for the resume-on-launch decision.
    getCameraPermissionStatus: jest.fn(() => 'denied'),
    getMicrophonePermissionStatus: jest.fn(() => 'denied'),
  }),
  useCameraDevice: jest.fn(() => undefined),
  useCameraFormat: jest.fn(() => undefined),
  useCameraPermission: jest.fn(() => denied),
  useMicrophonePermission: jest.fn(() => denied),
  useFrameProcessor: jest.fn(() => undefined),
  runAsync: jest.fn(),
  runAtTargetFps: jest.fn(),
};

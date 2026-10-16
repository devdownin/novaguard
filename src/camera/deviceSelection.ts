import { DeviceFilter } from 'react-native-vision-camera';
import { Camera as CameraSetting } from '../state/types';

export function devicePositionFor(camera: CameraSetting): 'front' | 'back' {
  return camera === 'Avant' ? 'front' : 'back';
}

/** Falls back to the regular wide camera automatically if no ultra-wide exists. */
export function physicalDeviceFilterFor(camera: CameraSetting): DeviceFilter | undefined {
  if (camera === 'Arrière (0,5×)') return { physicalDevices: ['ultra-wide-angle-camera'] };
  return undefined;
}

/** How long the device list may stay empty before "no camera" is believed. */
export const NO_DEVICE_GRACE_MS = 3000;

export type StandbyKey = 'view.grantCamera' | 'view.cameraStarting' | 'view.noCamera' | 'view.standby';

/**
 * What the viewfinder says where the preview is not (yet) drawn.
 *
 * It said "no camera detected" whenever surveillance was on and the preview
 * had not covered it — which is every launch, for the second it takes the
 * session to deliver, and also whenever the device list arrives a render late.
 * "No camera" is now claimed only when none was found and the grace is over.
 */
export function standbyLabelKey(state: {
  cameraPermission: boolean; monitoring: boolean; deviceFound: boolean; graceOver: boolean;
}): StandbyKey {
  if (!state.cameraPermission) return 'view.grantCamera';
  if (!state.monitoring) return 'view.standby';
  return !state.deviceFound && state.graceOver ? 'view.noCamera' : 'view.cameraStarting';
}

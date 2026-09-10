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

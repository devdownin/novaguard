import { StringKey } from '../i18n/fr';
export const APP_VERSION = '1.0.0';
export const APP_LICENSE = 'GPL-3.0';
export const REPO_URL = 'https://github.com/devdownin/novaguard';
export const ISSUES_URL = `${REPO_URL}/issues`;

export interface ThirdPartyLicense {
  name: string;
  /** What it does here, in the reader's language — resolved at render time. */
  noteKey: StringKey;
  license: string;
}

// Keep in sync with package.json dependencies.
export const THIRD_PARTY_LICENSES: ThirdPartyLicense[] = [
  { name: 'React & React Native', noteKey: 'lic.react-react-native', license: 'MIT' },
  { name: 'react-native-vision-camera', noteKey: 'lic.react-native-vision-camera', license: 'MIT' },
  { name: 'react-native-fast-tflite', noteKey: 'lic.react-native-fast-tflite', license: 'MIT' },
  { name: 'react-native-vision-camera-face-detector', noteKey: 'lic.react-native-vision-camera-face-detector', license: 'MIT' },
  { name: 'vision-camera-resize-plugin', noteKey: 'lic.vision-camera-resize-plugin', license: 'MIT' },
  { name: '@dr.pogodin/react-native-fs', noteKey: 'lic.dr-pogodin-react-native-fs', license: 'MIT' },
  { name: 'react-native-video', noteKey: 'lic.react-native-video', license: 'MIT' },
  { name: 'react-native-worklets-core', noteKey: 'lic.react-native-worklets-core', license: 'MIT' },
  { name: 'EfficientDet-Lite0 (COCO)', noteKey: 'lic.efficientdet-lite0-coco', license: 'Apache-2.0' },
  { name: 'EfficientDet-Lite2 (COCO)', noteKey: 'lic.efficientdet-lite2-coco', license: 'Apache-2.0' },
  { name: 'react-native-safe-area-context', noteKey: 'lic.react-native-safe-area-context', license: 'MIT' },
  { name: 'react-native-svg', noteKey: 'lic.react-native-svg', license: 'MIT' },
  { name: 'react-native-linear-gradient', noteKey: 'lic.react-native-linear-gradient', license: 'MIT' },
  { name: '@react-native-community/slider', noteKey: 'lic.react-native-community-slider', license: 'MIT' },
  { name: '@react-native-async-storage/async-storage', noteKey: 'lic.react-native-async-storage-async-storage', license: 'MIT' },
  { name: 'AndroidX Core', noteKey: 'lic.androidx-core', license: 'Apache-2.0' },
  { name: 'Inter', noteKey: 'lic.inter', license: 'SIL OFL 1.1' },
];

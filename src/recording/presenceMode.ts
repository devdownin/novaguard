import { PostRoll, PresenceMode, PresenceTolerance } from '../state/types';

export const TOLERANCE_OPTIONS: PresenceTolerance[] = ['1 s', '2 s', '3 s', '5 s', '10 s', '30 s'];
export const presenceModeFor = (post: PostRoll): PresenceMode => post === '0 s' ? 'strict' : 'tolerant';
/** Old long tails retain their VisionCamera backend for compatibility. */
export const usesBufferedCapture = (post: PostRoll): boolean => ['0 s', '1 s', '2 s', '3 s'].includes(post);

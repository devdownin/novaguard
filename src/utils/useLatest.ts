import { useEffect, useRef } from 'react';

/**
 * Mirrors a value into a ref, so a callback can read the current one without
 * taking it as a dependency.
 *
 * `reportDetections` feeds the camera's frame-processor dependency list: an
 * identity that changed whenever a setting did would rebuild the worklet, and
 * one that changed every render would rebuild it several times a second. The
 * values it needs that way — free space, the alert switches, the post-roll
 * length — all go through here.
 *
 * The ref is written on commit, so a reader running during render sees the
 * previous value. Every caller here reads from an event handler or a timer,
 * which is always after commit.
 */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref;
}

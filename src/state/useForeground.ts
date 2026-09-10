import { useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Whether anyone is actually looking at the app.
 *
 * Surveillance is meant to run with the screen off — that is what the
 * foreground service is for — so the camera, the analysis and the recording all
 * carry on regardless of this. What must *not* carry on is the work whose only
 * product is something on screen: the preview stream, and the viewfinder state
 * the frame path pushes up to five times a second for an overlay nobody can
 * see. Until now the app had no idea it was in the background, and did all of
 * it anyway.
 *
 * Hidden means `background` and only `background`. The two other answers are
 * both wrong to treat as hidden: `inactive` is a transient state where the app
 * may still be perfectly visible — under a permission dialog the user is busy
 * answering — and `currentState` is `undefined` before the first event has
 * been observed at all. Anything but a definite `background` therefore counts
 * as visible, which is also the safe direction to be wrong in: the cost is a
 * little work nobody needed, against blanking the preview of an app somebody
 * is looking at.
 */
const visible = (state: AppStateStatus | undefined) => state !== 'background';

export function useForeground(): boolean {
  const [foreground, setForeground] = useState(() => visible(AppState.currentState));

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (next: AppStateStatus) => setForeground(visible(next)),
    );
    return () => subscription.remove();
  }, []);

  return foreground;
}

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';

export type AppState = ReturnType<typeof useAppState>;

/**
 * Mounts `AppStateProvider` and hands back a live handle on its value.
 *
 * Read state through the handle (`handle.state.events`), not a destructured
 * copy: `state` is reassigned on every render, so destructuring it once pins a
 * snapshot of the first one. Callbacks on it are stable, so those are safe to
 * pull out.
 *
 * Three suites were each carrying their own copy of this, so the
 * hydration-settling contract — one async `act` for the mount, a second for the
 * promises it kicks off — was encoded in three places and drifted between them.
 *
 * Lives outside `__tests__/` on purpose: jest.config sets no
 * `testPathIgnorePatterns`, so a helper in there would be collected as a suite
 * with no tests and fail the run.
 */
export async function mountProvider(extra?: React.ReactNode): Promise<{ state: AppState }> {
  const handle = {} as { state: AppState };

  function Probe() {
    handle.state = useAppState();
    return null;
  }

  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <AppStateProvider>
        <Probe />
        {extra}
      </AppStateProvider>,
    );
  });
  // Hydration and the first storage measurement resolve on the next ticks.
  await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => {});

  return handle;
}

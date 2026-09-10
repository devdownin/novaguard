/**
 * The camera can be taken from this app, and giving up on it is not an option.
 *
 * @format
 */

import {
  cameraDeliveredFrame,
  cameraFailed,
  cameraRetried,
  HEALTHY_CAMERA,
  RETRY_CEILING_MS,
  retryDelayFor,
} from '../src/camera/cameraHealth';

describe('the retry delay', () => {
  it('starts short, because the usual cause is over in seconds', () => {
    // A phone call, a banking app checking a face: the camera comes back on its
    // own, and a first attempt a minute later would miss a whole passage.
    expect(retryDelayFor(0)).toBeLessThanOrEqual(2_000);
  });

  it('backs off with each failed attempt', () => {
    const delays = [0, 1, 2, 3].map(retryDelayFor);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it('never gives up, however long the camera has been held', () => {
    // Not a bounded number of attempts: an app that stopped trying is an app
    // that is off, except that this one would still claim to be watching.
    expect(retryDelayFor(50)).toBe(RETRY_CEILING_MS);
    expect(retryDelayFor(5_000)).toBe(RETRY_CEILING_MS);
  });
});

describe('the recovery state', () => {
  it('goes down on an error, and stays where it is on a second one', () => {
    const down = cameraFailed(HEALTHY_CAMERA);
    expect(down.health).toBe('interrupted');
    // A session that errors twice on the way out must not reset the backoff —
    // that is how a restart loop turns into a busy loop.
    expect(cameraFailed(cameraRetried(down))).toEqual(cameraRetried(down));
  });

  it('counts the restarts it has asked for', () => {
    let state = cameraFailed(HEALTHY_CAMERA);
    expect(state.attempts).toBe(0);
    state = cameraRetried(state);
    expect(state.attempts).toBe(1);
    expect(retryDelayFor(state.attempts)).toBeGreaterThan(retryDelayFor(0));
  });

  it('comes back only on a delivered frame', () => {
    // Not on the restart: a session that mounts and then delivers nothing is
    // exactly what the failure looks like from here.
    const restarted = cameraRetried(cameraFailed(HEALTHY_CAMERA));
    expect(restarted.health).toBe('interrupted');
    expect(cameraDeliveredFrame(restarted)).toEqual(HEALTHY_CAMERA);
  });

  it('costs nothing on the frames that follow', () => {
    // Identity, not equality: this runs on the frame path, several times a
    // second, and a new object per frame is garbage for no answer.
    expect(cameraDeliveredFrame(HEALTHY_CAMERA)).toBe(HEALTHY_CAMERA);
  });
});

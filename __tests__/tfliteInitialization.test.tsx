import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Image } from 'react-native';
import type { TensorflowModel, TensorflowModelDelegate } from 'react-native-fast-tflite';
import { useDetectionModel } from '../src/camera/useDetectionModel';

// Keep the library's real asynchronous hook and asset loader. Only the native
// JSI boundary is replaced: the old immediate-state mock concealed the race.
jest.mock('react-native-fast-tflite/lib/commonjs/TensorflowModule', () => ({ TensorflowModule: { install: () => true } }));
jest.mock('react-native-fast-tflite', () => jest.requireActual('react-native-fast-tflite/lib/commonjs/TensorflowLite'));

interface Request {
  delegate: TensorflowModelDelegate;
  resolve: (model: TensorflowModel) => void;
  reject: (error: Error) => void;
}
let requests: Request[];
let tree: ReactTestRenderer.ReactTestRenderer;
let value: ReturnType<typeof useDetectionModel>;
const exposed: { source: number; model: TensorflowModel | undefined }[] = [];
function model(size: number, delegate: TensorflowModelDelegate = 'default'): TensorflowModel {
  return {
    delegate, inputs: [{ name: 'images', dataType: 'uint8', shape: [1, size, size, 3] }],
    outputs: [
      { name: 'boxes', dataType: 'float32', shape: [1, 25, 4] },
      { name: 'classes', dataType: 'float32', shape: [1, 25] },
      { name: 'scores', dataType: 'float32', shape: [1, 25] },
      { name: 'count', dataType: 'float32', shape: [1] },
    ], run: jest.fn(async () => []), runSync: jest.fn(() => []),
  };
}
function Harness({ source = 1, forceCpu = false }: { source?: number; forceCpu?: boolean }) {
  value = useDetectionModel(source, forceCpu, source === 2 ? 448 : 320);
  exposed.push({ source, model: value.model });
  return null;
}
async function mount(forceCpu = false) {
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<Harness forceCpu={forceCpu} />); });
}
async function resolve(index: number, size: number) {
  await ReactTestRenderer.act(async () => { requests[index].resolve(model(size, requests[index].delegate)); });
}
async function reject(index: number) {
  await ReactTestRenderer.act(async () => { requests[index].reject(new Error('transient load failure')); });
}
beforeEach(() => {
  jest.useFakeTimers(); requests = []; exposed.length = 0;
  jest.spyOn(Image, 'resolveAssetSource').mockImplementation(source => ({ uri: `asset:${source}`, width: 1, height: 1, scale: 1 }));
  global.__loadTensorflowModel = jest.fn((_uri, delegate) => new Promise<TensorflowModel>((ok, fail) => {
    requests.push({ delegate, resolve: ok, reject: fail });
  }));
});
afterEach(async () => {
  if (tree) await ReactTestRenderer.act(async () => { tree.unmount(); });
  jest.restoreAllMocks(); jest.useRealTimers();
});
it('ignores a stale successful load after the new source has finished', async () => {
  await mount();
  await ReactTestRenderer.act(async () => { tree.update(<Harness source={2} />); });
  await resolve(1, 448);
  const current = value.model;
  await resolve(0, 320);
  expect(value.model).toBe(current);
});
it('never exposes an old model on the render that changes its source', async () => {
  await mount(); await resolve(0, 320);
  await ReactTestRenderer.act(async () => { tree.update(<Harness source={2} />); });
  expect(exposed.filter(entry => entry.source === 2).every(entry => entry.model == null)).toBe(true);
});
it('retries a CPU failure automatically and clears failure only after successful loading', async () => {
  await mount(); await reject(0); await reject(1);
  expect(value.failed).toBe(true);
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1000); });
  expect(requests).toHaveLength(3);
  expect(requests[2].delegate).toBe('default');
  expect(value.failed).toBe(true);
  await resolve(2, 320);
  expect(value.failed).toBe(false);
  expect(value.model).toBeDefined();
});
it('reloads when force CPU changes even if the fallback delegate remains the same', async () => {
  await mount(); await reject(0); await reject(1);
  await ReactTestRenderer.act(async () => { tree.update(<Harness forceCpu />); });
  expect(requests).toHaveLength(3);
  expect(requests[2].delegate).toBe('default');
  await resolve(2, 320);
  expect(value.failed).toBe(false);
});

it('limits CPU retries to three attempts and retains the failure afterwards', async () => {
  await mount(true); await reject(0);
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1000); });
  await reject(1);
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(3000); });
  await reject(2);
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(60_000); });
  expect(requests).toHaveLength(3);
  expect(value.failed).toBe(true);
});
it('expires a stalled GPU load and ignores its late result after CPU fallback', async () => {
  await mount();
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(20_000); });
  expect(requests).toHaveLength(2);
  expect(requests[1].delegate).toBe('default');
  await resolve(1, 320);
  const cpu = value.model;
  await resolve(0, 320);
  expect(value.model).toBe(cpu);
  expect(value.delegate).toBe('default');
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(60_000); });
  expect(requests).toHaveLength(2);
});
it('rejects mismatched dimensions before handing a model to the camera', async () => {
  await mount(true); await resolve(0, 448);
  expect(value.model).toBeUndefined();
  expect(value.failed).toBe(true);
});
it('rejects incompatible output tensors before inference', async () => {
  await mount(true);
  const invalid = model(320); invalid.outputs[0].dataType = 'uint8';
  await ReactTestRenderer.act(async () => { requests[0].resolve(invalid); });
  expect(value.model).toBeUndefined();
  expect(value.failed).toBe(true);
});
it('ignores an old GPU rejection when the user selected CPU in the meantime', async () => {
  await mount();
  await ReactTestRenderer.act(async () => { tree.update(<Harness forceCpu />); });
  await reject(0); await resolve(1, 320);
  await ReactTestRenderer.act(async () => { tree.update(<Harness />); });
  expect(requests[2].delegate).toBe('android-gpu');
});
it('cancels scheduled retries on unmount', async () => {
  await mount(true); await reject(0);
  await ReactTestRenderer.act(async () => { tree.unmount(); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(60_000); });
  expect(requests).toHaveLength(1);
});
it('consumes late native failures after unmount without reopening a request', async () => {
  await mount(true);
  await ReactTestRenderer.act(async () => { tree.unmount(); });
  await reject(0);
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(60_000); });
  expect(requests).toHaveLength(1);
});

it('ignores a timed-out CPU request while its retry is active', async () => {
  await mount(true);
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(20_000); });
  expect(value.failed).toBe(true);
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1000); });
  await resolve(0, 320);
  expect(value.model).toBeUndefined();
  expect(value.failed).toBe(true);
  await resolve(1, 320);
  expect(value.model).toBeDefined();
  expect(value.failed).toBe(false);
});

it('tries the GPU for a different source even if it refused the previous source', async () => {
  await mount(); await reject(0); await resolve(1, 320);
  await ReactTestRenderer.act(async () => { tree.update(<Harness source={2} />); });
  expect(requests[2].delegate).toBe('android-gpu');
});

it('reloads on CPU when a loaded GPU model fails at inference, and remembers it', async () => {
  await mount(); await resolve(0, 320);
  expect(value.delegate).toBe('android-gpu');
  let demoted = false;
  await ReactTestRenderer.act(async () => { demoted = value.refuseRunningDelegate(); });
  expect(demoted).toBe(true);
  expect(value.model).toBeUndefined();
  expect(requests).toHaveLength(2);
  expect(requests[1].delegate).toBe('default');
  // Frames still in flight on the old model must not queue further reloads.
  await ReactTestRenderer.act(async () => { value.refuseRunningDelegate(); });
  expect(requests).toHaveLength(2);
  await resolve(1, 320);
  expect(value.delegate).toBe('default');
  expect(value.model).toBeDefined();
  expect(value.failed).toBe(false);
});

it('reports a CPU inference failure instead of swallowing it', async () => {
  await mount(true); await resolve(0, 320);
  let demoted = true;
  await ReactTestRenderer.act(async () => { demoted = value.refuseRunningDelegate(); });
  expect(demoted).toBe(false);
  expect(requests).toHaveLength(1);
});

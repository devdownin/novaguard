import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { loadTensorflowModel, TensorflowModel, TensorflowModelDelegate } from 'react-native-fast-tflite';

export const MODEL_LOAD_TIMEOUT_MS = 20_000;
const CPU_RETRY_DELAYS_MS = [1_000, 3_000];

interface LoadState {
  source: number;
  forceCpu: boolean;
  inputSize: number | undefined;
  delegate: TensorflowModelDelegate;
  model?: TensorflowModel;
  failed: boolean;
}

/** Metadata is available after allocation, before any camera frame is run. */
function validateModel(model: TensorflowModel, inputSize?: number): void {
  const input = model.inputs?.[0];
  if (model.inputs?.length !== 1 || input?.dataType !== 'uint8' ||
    input.shape.length !== 4 || input.shape[0] !== 1 || input.shape[3] !== 3 ||
    !Number.isInteger(input.shape[1]) || input.shape[1] <= 0 || input.shape[1] !== input.shape[2] ||
    (inputSize != null && input.shape[1] !== inputSize)) {
    throw new Error('TFLite: incompatible RGB input dimensions or type');
  }
  if (model.outputs?.length !== 4 || model.outputs.some(output => output.dataType !== 'float32')) {
    throw new Error('TFLite: incompatible detection outputs');
  }
}

/**
 * Own the request lifecycle rather than useTensorflowModel's shared async state:
 * an old source/delegate must never replace the one the camera is preparing for.
 * GPU refusal is remembered per asset. CPU failures remain visible through two
 * bounded retries; changing source or forceCpu starts a fresh request sequence.
 */
export function useDetectionModel(source: number, forceCpu = false, inputSize?: number): {
  model: TensorflowModel | undefined;
  delegate: TensorflowModelDelegate;
  failed: boolean;
} {
  const refusedGpu = useRef(new Set<number>());
  const preferred: TensorflowModelDelegate =
    Platform.OS === 'android' && !forceCpu && !refusedGpu.current.has(source) ? 'android-gpu' : 'default';
  const [state, setState] = useState<LoadState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    let cpuFailed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const identity = { source, forceCpu, inputSize };

    const attempt = (delegate: TensorflowModelDelegate, cpuAttempt: number) => {
      const request = ++sequence;
      let settled = false;
      const current = () => !cancelled && !settled && request === sequence;
      const finish = () => {
        settled = true;
        if (timeout != null) clearTimeout(timeout);
        timeout = null;
      };
      const fail = () => {
        if (!current()) return;
        finish();
        if (delegate !== 'default') {
          refusedGpu.current.add(source);
          attempt('default', 0);
          return;
        }
        cpuFailed = true;
        setState({ ...identity, delegate, failed: true });
        const delay = CPU_RETRY_DELAYS_MS[cpuAttempt];
        if (delay != null) retry = setTimeout(() => {
          retry = null;
          if (!cancelled) attempt('default', cpuAttempt + 1);
        }, delay);
      };

      setState({ ...identity, delegate, failed: cpuFailed });
      timeout = setTimeout(fail, MODEL_LOAD_TIMEOUT_MS);
      // Also catches a synchronous loader/asset-resolution exception.
      Promise.resolve().then(() => current() ? loadTensorflowModel(source, delegate) : undefined)
        .then(model => {
          if (!current()) return;
          if (!model) throw new Error('TFLite: no model returned');
          validateModel(model, inputSize);
          finish();
          setState({ ...identity, delegate, model, failed: false });
        }).catch(fail);
    };

    // Derive here from the user's choice and remembered refusal. Adding the
    // derived delegate to the effect dependencies would restart CPU fallback.
    const delegate: TensorflowModelDelegate =
      Platform.OS === 'android' && !forceCpu && !refusedGpu.current.has(source) ? 'android-gpu' : 'default';
    attempt(delegate, 0);
    return () => {
      cancelled = true;
      sequence++;
      if (timeout != null) clearTimeout(timeout);
      if (retry != null) clearTimeout(retry);
    };
  }, [source, forceCpu, inputSize]);

  // Effects run after commit. Suppress the previous model during the render
  // that changes inputs as well as after any late asynchronous completion.
  const matches = state?.source === source && state.forceCpu === forceCpu && state.inputSize === inputSize;
  return {
    model: matches ? state.model : undefined,
    delegate: matches ? state.delegate : preferred,
    failed: matches ? state.failed : false,
  };
}

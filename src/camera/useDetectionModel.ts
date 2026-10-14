import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { loadTensorflowModel, TensorflowModel, TensorflowModelDelegate } from 'react-native-fast-tflite';

export const MODEL_LOAD_TIMEOUT_MS = 20_000;
const CPU_RETRY_DELAYS_MS = [1_000, 3_000];

interface LoadState {
  source: number;
  forceCpu: boolean;
  inputSize: number | undefined;
  demotions: number;
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
 *
 * A GPU delegate can also accept the graph at load and then fail every
 * `Invoke` — the OpenGL backend is bound to the thread that created it, and the
 * frame processor runs on CameraX's analyser thread. `refuseRunningDelegate`
 * is how the camera reports that: it remembers the refusal and reloads on CPU.
 */
export function useDetectionModel(source: number, forceCpu = false, inputSize?: number): {
  model: TensorflowModel | undefined;
  delegate: TensorflowModelDelegate;
  failed: boolean;
  /** True when the failing model ran on the GPU and a CPU reload has started. */
  refuseRunningDelegate: () => boolean;
} {
  const refusedGpu = useRef(new Set<number>());
  const preferred: TensorflowModelDelegate =
    Platform.OS === 'android' && !forceCpu && !refusedGpu.current.has(source) ? 'android-gpu' : 'default';
  const [state, setState] = useState<LoadState | null>(null);
  const [demotions, setDemotions] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    let cpuFailed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const identity = { source, forceCpu, inputSize, demotions };

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
  }, [source, forceCpu, inputSize, demotions]);

  // Effects run after commit. Suppress the previous model during the render
  // that changes inputs as well as after any late asynchronous completion.
  const matches = state?.source === source && state.forceCpu === forceCpu &&
    state.inputSize === inputSize && state.demotions === demotions;
  const running = matches && state.model != null ? state : undefined;
  const runningRef = useRef(running);
  runningRef.current = running;

  // Stable identity: it reaches the frame processor's dependency list through
  // the JS callback, and a new function there rebuilds the worklet. Called at
  // up to the analysis rate until the CPU model replaces this one, hence the
  // idempotence through the remembered refusal.
  const refuseRunningDelegate = useCallback(() => {
    const current = runningRef.current;
    if (current == null || current.delegate === 'default') return false;
    if (refusedGpu.current.has(current.source)) return true;
    refusedGpu.current.add(current.source);
    setDemotions(n => n + 1);
    return true;
  }, []);

  return {
    model: matches ? state.model : undefined,
    delegate: matches ? state.delegate : preferred,
    failed: matches ? state.failed : false,
    refuseRunningDelegate,
  };
}

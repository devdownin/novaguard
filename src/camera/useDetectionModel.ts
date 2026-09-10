import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { TensorflowModel, TensorflowModelDelegate, useTensorflowModel } from 'react-native-fast-tflite';

/**
 * Loads the detection model on the GPU delegate, falling back to CPU if it
 * refuses the model.
 *
 * The fallback is not optional: these detection models carry a custom
 * postprocessing op that GPU delegates commonly decline, and a hard failure
 * there would mean no detection at all — strictly worse than running slower.
 *
 * `forceCpu` skips the GPU entirely. It exists because the automatic fallback
 * only catches a delegate that refuses to *load*: one that accepts the model
 * and then produces nothing usable looks exactly like a camera that never sees
 * anybody, and no amount of logging from here would tell the two apart on a
 * user's device. The setting makes that testable in one tap.
 */
export function useDetectionModel(source: number, forceCpu = false): {
  model: TensorflowModel | undefined;
  delegate: TensorflowModelDelegate;
  failed: boolean;
} {
  const preferred: TensorflowModelDelegate =
    Platform.OS === 'android' && !forceCpu ? 'android-gpu' : 'default';
  // The delegate in use is derived from which one was refused, not stored as
  // "we fell back": a plain flag could never be undone, so turning `forceCpu`
  // back off would have left the app on the CPU for the rest of the session.
  // Remembering the refusal instead means a GPU that already said no is not
  // asked twice, while one that was only skipped is used again.
  const [refused, setRefused] = useState<TensorflowModelDelegate | null>(null);
  const delegate: TensorflowModelDelegate = refused === preferred ? 'default' : preferred;
  const plugin = useTensorflowModel(source, delegate);

  useEffect(() => {
    if (plugin.state === 'error' && delegate !== 'default') setRefused(delegate);
  }, [plugin.state, delegate]);

  return {
    model: plugin.state === 'loaded' ? plugin.model : undefined,
    delegate,
    failed: plugin.state === 'error' && delegate === 'default',
  };
}

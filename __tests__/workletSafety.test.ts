/**
 * What the frame processor really compiles to.
 *
 * `babel.config.js` turns the worklets plugin off under Jest, so every other
 * test in this repo exercises worklet code as if it were ordinary JavaScript.
 * It isn't. The compiler rewrites each `'worklet'` function into a detached
 * body plus a `__closure` object carrying the free variables it referenced, and
 * that closure is copied into a second JS runtime by value. Two things do not
 * survive the trip, and both crashed NovaGuard the moment the preview appeared:
 *
 *  - a plain (non-`'worklet'`) function becomes a stub that throws "Regular
 *    javascript function '<name>' cannot be shared" when called. That was
 *    `uprightRotation`, on the very first frame.
 *  - a `Set` or `Map` used as `X.method(...)` is hoisted to `{ method:
 *    Set.prototype.method }` — a builtin sitting on a plain object, which
 *    throws on the first call. That was `PERSON_LABELS.has`, on the first
 *    detection above the threshold.
 *
 * Neither is visible in the source, only in the compiled closure. So this file
 * runs the real compiler and inspects what comes out. To see it fail, drop the
 * `'worklet'` directive from `uprightRotation`, or turn `PERSON_LABELS` back
 * into a `Set` and match on `.has(label)`.
 *
 * @format
 */

/// <reference types="node" />
// Node's own types are not in the project's `types` list (React Native's config
// keeps it to `jest`); this file genuinely runs Babel over files on disk.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { transformSync } from '@babel/core';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { FrameDetection } from '../src/ml/types';

const ROOT = resolve(__dirname, '..');

/** Compiles one source file exactly as a release bundle would. */
function compile(file: string): string {
  const result = transformSync(readFileSync(file, 'utf8'), {
    filename: file,
    cwd: ROOT,
    babelrc: false,
    configFile: false,
    presets: ['module:@react-native/babel-preset'],
    plugins: ['react-native-worklets-core/plugin'],
  });
  if (!result?.code) throw new Error(`Failed to compile ${file}`);
  return result.code;
}

interface Capture {
  /** The name the worklet body reads out of `this.__closure`. */
  key: string;
  /** What the compiler put there, as source. */
  code: string;
  /** True when only some members were hoisted, e.g. `{ has: SET.has }`. */
  hoistedMembers: boolean;
}

/** Every `__closure` the compiler emitted for a file, flattened. */
function capturesOf(code: string): Capture[] {
  const captures: Capture[] = [];
  traverse(parse(code, { sourceType: 'unambiguous' }), {
    AssignmentExpression(path) {
      const left = path.node.left;
      if (!t.isMemberExpression(left)) return;
      if (!t.isIdentifier(left.property, { name: '__closure' })) return;
      const right = path.node.right;
      if (!t.isObjectExpression(right)) return;

      for (const property of right.properties) {
        if (!t.isObjectProperty(property) || !t.isIdentifier(property.key)) continue;
        captures.push({
          key: property.key.name,
          code: generate(property.value as t.Node, { compact: true }).code,
          hoistedMembers: t.isObjectExpression(property.value),
        });
      }
    },
  });
  return captures;
}

/**
 * Loads a compiled module the way the bundler would, so a worklet's `__workletHash`
 * can be read off the real exported value.
 *
 * Only relative imports are followed; anything else (react-native and the
 * native plugins) resolves to an empty object, which is all these pure modules
 * ever need — they import types from those, not values.
 */
function loadCompiled(file: string, seen = new Map<string, unknown>()): Record<string, any> {
  const cached = seen.get(file);
  if (cached) return cached as Record<string, any>;

  const module = { exports: {} as Record<string, any> };
  seen.set(file, module.exports);
  const require_ = (request: string) =>
    request.startsWith('.')
      ? loadCompiled(resolveModule(resolve(dirname(file), request)), seen)
      : {};

  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', compile(file))(module.exports, require_, module);
  return module.exports;
}

/** Adds the extension a compiled `require('./x')` has dropped. */
function resolveModule(path: string): string {
  for (const extension of ['.ts', '.tsx', '/index.ts']) {
    if (existsSync(path + extension)) return path + extension;
  }
  throw new Error(`Cannot resolve ${path}`);
}

/**
 * Every source file that declares a worklet, found rather than listed.
 *
 * A hardcoded list only protects the files someone remembered to add, which is
 * no protection at all for the next worklet: the two crashes this suite exists
 * for were both in code nobody thought needed checking.
 */
function worklettedSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return worklettedSources(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return /'worklet'/.test(readFileSync(path, 'utf8')) ? [path] : [];
  });
}

const WORKLET_SOURCES = worklettedSources(resolve(ROOT, 'src'));
const INTERPRET = resolve(ROOT, 'src/ml/interpretDetections.ts');
const ORIENTATION = resolve(ROOT, 'src/camera/orientation.ts');
const LETTERBOX = resolve(ROOT, 'src/ml/letterbox.ts');

describe('worklet closures', () => {
  it('covers every file that declares one', () => {
    // Guards the discovery itself: a `src` layout change that stopped finding
    // the frame processor would otherwise leave this whole suite passing on
    // nothing at all.
    expect(WORKLET_SOURCES.map(f => basename(f)).sort()).toEqual([
      'CameraFeed.tsx', 'interpretDetections.ts', 'letterbox.ts', 'orientation.ts',
    ]);
  });

  it('only ever hoists members off the TFLite model', () => {
    // `model.runSync` is a JSI host function that owns its own native handle,
    // so detaching it from `model` is safe and is how fast-tflite is meant to
    // be used. Every other partial capture is the `Set`-shaped bug: a method
    // lifted away from the object it needs as its receiver.
    const hoisted = WORKLET_SOURCES
      .flatMap(file => capturesOf(compile(file)).map(c => ({ file: basename(file), ...c })))
      .filter(c => c.hoistedMembers)
      .map(c => `${c.file}: ${c.key} = ${c.code}`);

    expect(Array.from(new Set(hoisted))).toEqual([
      'CameraFeed.tsx: model = {runSync:model.runSync}',
    ]);
  });

  it('captures the shared geometry and decoding helpers as worklets', () => {
    // A plain function here compiles to a stub that throws when the frame
    // processor calls it — which is a dead app, not a degraded one.
    const orientation = loadCompiled(ORIENTATION);
    const interpret = loadCompiled(INTERPRET);
    const letterbox = loadCompiled(LETTERBOX);

    for (const [name, fn] of [
      ['uprightRotation', orientation.uprightRotation],
      ['uprightAspect', orientation.uprightAspect],
      ['swapsAxes', orientation.swapsAxes],
      ['interpretDetections', interpret.interpretDetections],
      ['letterboxFor', letterbox.letterboxFor],
      ['letterboxInto', letterbox.letterboxInto],
    ] as const) {
      expect(`${name}: ${typeof fn.__workletHash}`).toBe(`${name}: number`);
    }
  });

  it('carries no bare function into a closure', () => {
    // Same rule, applied to what `interpretDetections` actually reaches for
    // rather than to a list someone has to remember to extend.
    const closure = loadCompiled(INTERPRET).interpretDetections.__closure as Record<string, any>;
    const unshareable = Object.entries(closure)
      .filter(([, value]) => typeof value === 'function' && value.__workletHash == null)
      .map(([key]) => key);

    expect(unshareable).toEqual([]);
  });
});

describe('the compiled analysis worklet', () => {
  /**
   * The innermost worklet body, pulled straight out of the compiled bundle.
   *
   * `CameraFeed` cannot be loaded here — it needs the whole React Native
   * runtime — but the worklet's source is a plain string in the output, which
   * is all the runtime itself starts from.
   */
  function analysisWorkletSource(): string {
    const compiled = compile(resolve(ROOT, 'src/components/CameraFeed.tsx'));
    const bodies: string[] = [];
    traverse(parse(compiled, { sourceType: 'unambiguous' }), {
      VariableDeclarator(path) {
        if (!t.isIdentifier(path.node.id) || !/^_worklet_\d+_init_data$/.test(path.node.id.name)) return;
        if (!t.isObjectExpression(path.node.init)) return;
        for (const property of path.node.init.properties) {
          if (!t.isObjectProperty(property) || !t.isIdentifier(property.key, { name: 'code' })) continue;
          if (t.isStringLiteral(property.value)) bodies.push(property.value.value);
        }
      },
    });
    // The analysis itself, not the frame processor that throttles it: a
    // nested worklet's source also appears inside its parent's body.
    const analysis = bodies.filter(body => body.includes('resize(frame') && !body.includes('runAtTargetFps('));
    expect(analysis).toHaveLength(1);
    return analysis[0];
  }

  /** A closure with everything the body destructures, and nothing else. */
  function closureFor(overrides: Record<string, unknown> = {}) {
    const inner = { width: 180, height: 320 };
    return {
      resize: () => new Uint8Array(inner.width * inner.height * 3),
      frame: { width: 1080, height: 1920, orientation: 'portrait' },
      inputSize: 320,
      MODEL_INPUT_CHANNELS: 3,
      DETECTION_FLOOR: 0.3,
      uprightRotation: () => '0deg',
      swapsAxes: () => false,
      letterboxFor: () => inner,
      letterboxInto: () => new Uint8Array(320 * 320 * 3),
      model: { runSync: () => [new Float32Array(4), new Float32Array(1), new Float32Array(1), Float32Array.from([0])] },
      interpretDetections: () => [],
      detectPerson: true,
      detectAnimal: true,
      autoZoom: false,
      detectFaces: () => [],
      viewW: 320,
      viewH: 640,
      onJsFrame: jest.fn(),
      uprightAspect: () => 9 / 16,
      onFrameError: jest.fn(),
      onFrameStage: jest.fn(),
      ...overrides,
    };
  }

  /**
   * What `interpretDetections` would return for `n` people in shot.
   *
   * The face detector is now only asked when there is more than one, so a
   * closure that reports nobody never reaches it.
   */
  function people(n: number) {
    const boxes: FrameDetection[] = [];
    for (let i = 0; i < n; i++) {
      boxes.push({ kind: 'Personne', confidence: 0.9, box: { x: 0.1 * i, y: 0.2, width: 0.15, height: 0.5 } });
    }
    return () => boxes;
  }

  function runAnalysis(closure: Record<string, unknown>): void {
    // eslint-disable-next-line no-new-func
    const body = new Function(`return (${analysisWorkletSource()})`)();
    body.apply({ __closure: closure });
  }

  it('is exercised through the closure the compiler actually asks for', () => {
    // `closureFor` claims to carry everything the body destructures and nothing
    // else, and nothing checked it: a captured name that was renamed left a key
    // reading `undefined`, which a stubbed helper happily ignores — so every
    // test below went on passing against a worklet the runtime could not run.
    const declared = analysisWorkletSource().match(/const\s*{([^}]*)}\s*=\s*this\.__closure/);
    expect(declared).not.toBeNull();
    const needed = declared![1].split(',').map(n => n.trim().split(':')[0].trim()).filter(Boolean);
    expect(needed.sort()).toEqual(Object.keys(closureFor()).sort());
  });

  it('analyses on the thread the frame arrives on', () => {
    // `runAsync` moves the work to a second worklet context and keeps the
    // frame alive across threads. That is where the app died: SIGSEGV on
    // `VisionCamera.video` within a few frames of the preview appearing, then
    // an ImageReader out of buffers because the frames it held were never
    // closed — the same crash upstream has open on the same thread
    // (mrousavy/react-native-vision-camera#2589). `runAtTargetFps` already
    // drops the frames we do not want to look at, so nothing is gained by
    // holding one longer than the callback that delivered it.
    const compiled = compile(resolve(ROOT, 'src/components/CameraFeed.tsx'));
    expect(compiled).not.toMatch(/\brunAsync\b/);
  });

  it('does each native call once per frame', () => {
    // Twice now, a merge has collided in this block and left a duplicated
    // resize/inference stanza behind. The last one did not parse, so tsc caught
    // it; one that does parse would double the per-frame cost of the two most
    // expensive calls in the app and change nothing visible. Counting is what
    // notices that.
    const body = analysisWorkletSource();
    const occurrences = (pattern: RegExp) => body.match(pattern)?.length ?? 0;

    expect(occurrences(/resize\(frame/g)).toBe(1);
    expect(occurrences(/model\.runSync\(/g)).toBe(1);
    expect(occurrences(/detectFaces\(frame\)/g)).toBe(1);
    expect(occurrences(/onJsFrame\(/g)).toBe(1);
  });

  it('hands a frame it analysed to the JS thread', () => {
    const closure = closureFor();
    runAnalysis(closure);
    expect(closure.onJsFrame).toHaveBeenCalled();
    expect(closure.onFrameError).not.toHaveBeenCalled();
  });

  it('names each native call before making it, not after', () => {
    // The order is the diagnostic: a stage recorded on the way *in* names the
    // call that killed the process, where one recorded on the way out would
    // name the last thing that worked.
    const closure = closureFor();
    runAnalysis(closure);

    const stages = (closure.onFrameStage as jest.Mock).mock.calls.map(([s]) => s);
    // `faces` is absent because this closure has autoZoom off — the stage is
    // only claimed when the call is actually about to happen.
    expect(stages).toEqual(['resize', 'inference', 'report']);
  });

  it('claims the face-detection stage only when it runs', () => {
    const closure = closureFor({ autoZoom: true, interpretDetections: people(2) });
    runAnalysis(closure);

    const stages = (closure.onFrameStage as jest.Mock).mock.calls.map(([s]) => s);
    expect(stages).toEqual(['resize', 'inference', 'faces', 'report']);
  });

  it('keeps detecting when the face detector throws', () => {
    // Auto-zoom is cosmetic and person/animal detection has already run by the
    // time faces are asked for, so an ML Kit failure must cost the framing and
    // nothing else. It used to take the whole frame down with it.
    const closure = closureFor({
      autoZoom: true,
      interpretDetections: people(2),
      detectFaces: () => { throw new Error('ML Kit down'); },
    });
    runAnalysis(closure);

    expect(closure.onJsFrame).toHaveBeenCalled();
    expect((closure.onJsFrame as jest.Mock).mock.calls[0][1]).toEqual([]);
    // Reported, not swallowed: at five frames a second, a detector that fails
    // on every one of them would otherwise leave no trace anywhere.
    expect(closure.onFrameError).toHaveBeenCalledWith('ML Kit down');
  });

  it('skips a face the detector returned without bounds', () => {
    const closure = closureFor({
      autoZoom: true,
      interpretDetections: people(2),
      detectFaces: () => [{}, { bounds: { x: 32, y: 64, width: 32, height: 64 } }],
    });
    runAnalysis(closure);

    expect((closure.onJsFrame as jest.Mock).mock.calls[0][1]).toEqual([
      { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
    ]);
    expect(closure.onFrameError).not.toHaveBeenCalled();
  });

  /**
   * ML Kit costs a native call per analysed frame, and since the zoom frames
   * whole people its answer only decides *which* person to follow. With one
   * person in shot there is nothing for it to decide.
   */
  describe('when the face detector is worth asking', () => {
    it('skips it for a lone subject', () => {
      const detectFaces = jest.fn(() => []);
      const closure = closureFor({ autoZoom: true, interpretDetections: people(1), detectFaces });
      runAnalysis(closure);

      expect(detectFaces).not.toHaveBeenCalled();
      // The frame is still analysed and reported — only the framing hint is skipped.
      expect(closure.onJsFrame).toHaveBeenCalled();
      expect((closure.onJsFrame as jest.Mock).mock.calls[0][1]).toEqual([]);
    });

    it('asks it as soon as there is a choice of subject', () => {
      const detectFaces = jest.fn(() => []);
      const closure = closureFor({ autoZoom: true, interpretDetections: people(2), detectFaces });
      runAnalysis(closure);

      expect(detectFaces).toHaveBeenCalledTimes(1);
    });

    it('never asks it with the setting off, crowd or not', () => {
      const detectFaces = jest.fn(() => []);
      const closure = closureFor({ autoZoom: false, interpretDetections: people(3), detectFaces });
      runAnalysis(closure);

      expect(detectFaces).not.toHaveBeenCalled();
    });
  });

  it('leaves the stage at the call that threw', () => {
    // The whole point: the last stage named is the one the process was inside.
    const closure = closureFor({
      model: { runSync: () => { throw new Error('boom'); } },
    });
    runAnalysis(closure);

    const stages = (closure.onFrameStage as jest.Mock).mock.calls.map(([s]) => s);
    expect(stages[stages.length - 1]).toBe('inference');
  });

  it('reports a failure instead of letting it close the app', () => {
    // Anything escaping this body reaches VisionCamera's `throwErrorOnJS`,
    // which calls React Native's `reportFatalError`. One bad frame, no app.
    const closure = closureFor({
      resize: () => { throw new Error('Frame is already closed'); },
    });

    expect(() => runAnalysis(closure)).not.toThrow();
    expect(closure.onFrameError).toHaveBeenCalledWith('Frame is already closed');
    expect(closure.onJsFrame).not.toHaveBeenCalled();
  });

  it('reports a failure from the model too, not just the resize', () => {
    const closure = closureFor({
      model: { runSync: () => { throw new Error('delegate produced nothing'); } },
    });

    expect(() => runAnalysis(closure)).not.toThrow();
    expect(closure.onFrameError).toHaveBeenCalledWith('delegate produced nothing');
  });

  it('still says something when what was thrown carries no message', () => {
    const closure = closureFor({ resize: () => { throw 'a bare string'; } });

    expect(() => runAnalysis(closure)).not.toThrow();
    expect(closure.onFrameError).toHaveBeenCalledWith('erreur inconnue');
  });
});

describe('the compiled detection worklet', () => {
  /**
   * Rebuilds the worklet the way the runtime does: the body is re-evaluated
   * from `__initData.code` in a fresh scope — no lexical scope survives — and
   * invoked with the closure as `this`. Calling the exported function directly,
   * as every other test here does, silently keeps the original scope and so
   * cannot see a capture that failed to make the crossing.
   */
  function asWorklet(fn: any): (...args: any[]) => any {
    // eslint-disable-next-line no-new-func
    const body = new Function(`return (${fn.__initData.code})`)();
    return (...args: any[]) => body.apply({ __closure: fn.__closure }, args);
  }

  it('decodes a person and a dog through its own closure', () => {
    const interpretDetections = asWorklet(loadCompiled(INTERPRET).interpretDetections);
    const results = interpretDetections(
      [
        Float32Array.from([0.1, 0.1, 0.5, 0.3, 0.6, 0.6, 0.8, 0.8]),
        Float32Array.from([0 /* person */, 17 /* dog */]),
        Float32Array.from([0.9, 0.8]),
        Float32Array.from([2]),
      ],
      { detectPerson: true, detectAnimal: true, floorConfidence: 0.5, scaleX: 1, scaleY: 1 },
    );

    expect(results.map((r: { kind: string }) => r.kind)).toEqual(['Personne', 'Animal']);
    expect(results[0].box.x).toBeCloseTo(0.1);
  });

  it('still honours the detection switches once compiled', () => {
    const interpretDetections = asWorklet(loadCompiled(INTERPRET).interpretDetections);
    const outputs = [
      Float32Array.from([0.1, 0.1, 0.5, 0.3, 0.6, 0.6, 0.8, 0.8]),
      Float32Array.from([0, 17]),
      Float32Array.from([0.9, 0.8]),
      Float32Array.from([2]),
    ];

    expect(
      interpretDetections(outputs, {
        detectPerson: true, detectAnimal: false, floorConfidence: 0.5, scaleX: 1, scaleY: 1,
      })
        .map((r: { kind: string }) => r.kind),
    ).toEqual(['Personne']);
    expect(
      interpretDetections(outputs, {
        detectPerson: false, detectAnimal: true, floorConfidence: 0.5, scaleX: 1, scaleY: 1,
      })
        .map((r: { kind: string }) => r.kind),
    ).toEqual(['Animal']);
  });
});

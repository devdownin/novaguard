/**
 * @format
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ShieldLogo } from '../src/components/ShieldLogo';
import { SplashScreen } from '../src/components/SplashScreen';

describe('ShieldLogo', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is on the splash', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<SplashScreen />); });
    expect(tree.root.findAllByType(ShieldLogo)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  it('starts hidden, and is drawn at once when the system asks for reduced motion', async () => {
    const opacityOfMark = (tree: ReactTestRenderer.ReactTestRenderer) => {
      const node = tree.root.findAll(n => n.props.testID === 'shield-logo-mark' && n.props.style)[0];
      const flat = ([] as unknown[]).concat(node.props.style).flat() as { opacity?: { __getValue(): number } | number }[];
      const style = flat.find(s => s && s.opacity !== undefined)!;
      return typeof style.opacity === 'number' ? style.opacity : style.opacity!.__getValue();
    };
    jest.useFakeTimers();
    let animated!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { animated = ReactTestRenderer.create(<ShieldLogo size={34} />); });
    expect(opacityOfMark(animated)).toBe(0);
    await act(async () => animated.unmount());

    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    let still!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { still = ReactTestRenderer.create(<ShieldLogo size={34} />); });
    expect(opacityOfMark(still)).toBe(1);
    await act(async () => still.unmount());
    jest.useRealTimers();
  });
});

/**
 * @format
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { PulseDot } from '../src/components/PulseDot';

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { tree = ReactTestRenderer.create(element); });
  return tree;
}

describe('PulseDot', () => {
  afterEach(() => jest.restoreAllMocks());

  it('draws a halo while it pulses', async () => {
    const tree = await render(<PulseDot color="#5fd3a8" size={12} pulse="breathe" />);
    expect(tree.root.findAllByProps({ testID: 'pulse-halo' }).length).toBeGreaterThan(0);
    await act(async () => tree.unmount());
  });

  it('draws none when still', async () => {
    const tree = await render(<PulseDot color="#5fd3a8" size={12} pulse="none" />);
    expect(tree.root.findAllByProps({ testID: 'pulse-halo' })).toHaveLength(0);
  });

  it('stops moving when the system asks for reduced motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const tree = await render(<PulseDot color="#ff9292" size={12} pulse="beat" />);
    expect(tree.root.findAllByProps({ testID: 'pulse-halo' })).toHaveLength(0);
  });
});

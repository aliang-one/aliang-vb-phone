import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useThrottledValue } from '../src/hooks/useThrottledValue';

const Probe: React.FC<{ value: string; intervalMs: number }> = ({
  value,
  intervalMs,
}) => <Text>{useThrottledValue(value, intervalMs)}</Text>;

describe('useThrottledValue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('publishes the latest value once at the end of the throttle window', () => {
    let screen: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      screen = ReactTestRenderer.create(<Probe value="a" intervalMs={200} />);
    });
    act(() => {
      screen.update(<Probe value="b" intervalMs={200} />);
      screen.update(<Probe value="c" intervalMs={200} />);
    });
    expect(screen!.root.findByType(Text).props.children).toBe('a');

    act(() => jest.advanceTimersByTime(199));
    expect(screen!.root.findByType(Text).props.children).toBe('a');
    act(() => jest.advanceTimersByTime(1));
    expect(screen!.root.findByType(Text).props.children).toBe('c');
    act(() => screen!.unmount());
  });

  it('publishes immediately when throttling is disabled', () => {
    let screen: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      screen = ReactTestRenderer.create(<Probe value="a" intervalMs={200} />);
    });
    act(() => {
      screen.update(<Probe value="final" intervalMs={0} />);
    });
    expect(screen!.root.findByType(Text).props.children).toBe('final');
    act(() => screen!.unmount());
  });
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useNowTick } from '../src/hooks/useNowTick';

const TickProbe: React.FC<{ onRender: (tick: number) => void }> = ({
  onRender,
}) => {
  const tick = useNowTick();
  onRender(tick);
  return <Text>{tick}</Text>;
};

describe('useNowTick', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-renders subscribers on the shared 30s cadence', () => {
    const renders: number[] = [];
    let screen: ReactTestRenderer.ReactTestRenderer | undefined;

    act(() => {
      screen = ReactTestRenderer.create(
        <TickProbe onRender={tick => renders.push(tick)} />,
      );
    });

    expect(renders).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    expect(renders).toHaveLength(2);
    expect(renders[1]).toBeGreaterThanOrEqual(renders[0]);

    act(() => {
      screen?.unmount();
      jest.advanceTimersByTime(30_000);
    });

    expect(renders).toHaveLength(2);
  });
});

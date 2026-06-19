import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useIncrementalList } from '../src/hooks/useIncrementalList';

type Result = ReturnType<typeof useIncrementalList<number>>;

const ListProbe: React.FC<{
  items: number[];
  initialCount: number;
  onRender: (result: Result) => void;
}> = ({ items, initialCount, onRender }) => {
  const result = useIncrementalList(items, { initialCount, from: 'end' });
  onRender(result);
  return <Text>probe</Text>;
};

describe('useIncrementalList', () => {
  it('showAll mounts every item so an off-screen target can be jumped to', () => {
    const items = [1, 2, 3, 4, 5];
    let latest!: Result;
    let screen!: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      screen = ReactTestRenderer.create(
        <ListProbe
          items={items}
          initialCount={2}
          onRender={result => {
            latest = result;
          }}
        />,
      );
    });

    // Baseline: from 'end' shows only the last 2 items.
    expect(latest.visibleItems).toEqual([4, 5]);
    expect(latest.hasMore).toBe(true);

    act(() => {
      latest.showAll();
    });

    expect(latest.visibleItems).toEqual([1, 2, 3, 4, 5]);
    expect(latest.hasMore).toBe(false);

    act(() => {
      screen.unmount();
    });
  });
});

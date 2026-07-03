import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { DevicePicker, type DevicePickerEntry } from '../src/components/terminal/DevicePicker';

jest.useFakeTimers();

const entries: DevicePickerEntry[] = [
  { id: 'd1', name: 'Mac', platform: 'darwin', online: true, cwd: '~/proj' },
  { id: 'd9', name: 'Staging', platform: 'linux', online: true, cwd: '/opt/app' },
  { id: 'd3', name: 'Win', platform: 'win32', online: false, cwd: 'C:\\proj' },
];

let currentRenderer: ReactTestRenderer.ReactTestRenderer | undefined;

const tree = (props: React.ComponentProps<typeof DevicePicker>) => (
  <ThemeContext.Provider
    value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}
  >
    <DevicePicker {...props} />
  </ThemeContext.Provider>
);

const render = (props: React.ComponentProps<typeof DevicePicker>) => {
  act(() => {
    currentRenderer = ReactTestRenderer.create(tree(props));
  });
  return currentRenderer!;
};

afterEach(() => {
  if (currentRenderer) {
    act(() => {
      currentRenderer!.unmount();
    });
    currentRenderer = undefined;
  }
});

const el = (root: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  root.root.findByProps({ testID });

const allTexts = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAllByType(Text).map(t => String(t.props.children));

describe('DevicePicker', () => {
  it('renders the selected entry collapsed (name + cwd) and not the list', () => {
    const root = render({ entries, selectedId: 'd9', onSelect: jest.fn() });
    expect(allTexts(root).some(t => t.includes('Staging'))).toBe(true);
    expect(allTexts(root).some(t => t.includes('/opt/app'))).toBe(true);
    // Collapsed — the list is not mounted.
    expect(() => el(root, 'device-picker-list')).toThrow();
  });

  it('expands on tapping the toggle, lists every entry, and selects on tap', () => {
    const onSelect = jest.fn();
    const root = render({ entries, selectedId: 'd1', onSelect });

    act(() => {
      el(root, 'device-picker-toggle').props.onPress();
    });
    expect(() => el(root, 'device-picker-list')).not.toThrow();
    // Every entry is present (including the offline one).
    expect(allTexts(root).some(t => t.includes('Win'))).toBe(true);

    // Tap Staging → onSelect fires with that entry, list collapses.
    act(() => {
      el(root, 'device-picker-entry-d9').props.onPress();
    });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'd9', name: 'Staging' }));
    expect(() => el(root, 'device-picker-list')).toThrow();
  });

  it('renders the toggle disabled (not expandable) when there are <2 entries', () => {
    const root = render({ entries: [entries[0]], selectedId: 'd1', onSelect: jest.fn() });
    expect(el(root, 'device-picker-toggle').props.disabled).toBe(true);
    // No list even after a press (the list render is gated by expandable).
    act(() => {
      el(root, 'device-picker-toggle').props.onPress();
    });
    expect(() => el(root, 'device-picker-list')).toThrow();
  });
});

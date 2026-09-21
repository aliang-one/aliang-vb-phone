// Task 15 (TDD red→green): the file-row long-press menu. Deliberately copies
// the DeviceControlCard menu shape (transparent fade Modal + full-screen scrim
// Pressable + GlassPanel + actionGrid), so the contract under test is:
//   1. visible → renders fileName + every action label.
//   2. pressing an action fires that action's onPress (closing the menu is
//      the caller's job — the FileBrowserScreen wiring closes it in the
//      action handler itself).
//   3. pressing the scrim — or a hardware back (Modal onRequestClose) —
//      calls onClose.
//   4. not visible → renders nothing.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal, Text, TouchableOpacity } from 'react-native';
import { FileLongPressMenu } from '../FileLongPressMenu';

/** Flatten a Text node's children into its literal string. */
const flattenText = (node: TestRenderer.ReactTestInstance): string =>
  React.Children.toArray(node.props.children)
    .map(child =>
      typeof child === 'string'
        ? child
        : typeof child === 'number'
        ? String(child)
        : '',
    )
    .join('');

const labelsOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map(flattenText).filter(Boolean);

const findActionButton = (
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
) =>
  renderer.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).map(flattenText).includes(label),
  );

const renderMenu = (props: {
  visible?: boolean;
  fileName?: string;
  onClose?: () => void;
  actions?: Array<{ label: string; onPress: () => void; tone?: 'default' | 'primary' | 'danger' }>;
}) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  // act() around create is required for the real RN Modal (its onShow/event
  // plumbing otherwise leaves the renderer unmounted mid-flush).
  act(() => {
    renderer = TestRenderer.create(
      <FileLongPressMenu
        visible={props.visible ?? true}
        fileName={props.fileName ?? 'main.ts'}
        onClose={props.onClose ?? jest.fn()}
        actions={
          props.actions ?? [
            { label: 'Download', tone: 'primary', onPress: jest.fn() },
            { label: 'Not now', onPress: jest.fn() },
          ]
        }
      />,
    );
  });
  return renderer;
};

describe('FileLongPressMenu', () => {
  it('renders the file name and every action label when visible', () => {
    const renderer = renderMenu({ fileName: 'App.tsx' });

    const labels = labelsOf(renderer);
    expect(labels).toContain('App.tsx');
    expect(labels).toContain('Download');
    expect(labels).toContain('Not now');

    renderer.unmount();
  });

  it('fires the pressed action onPress (the caller closes the menu)', () => {
    const onPress = jest.fn();
    const renderer = renderMenu({
      actions: [{ label: 'Download', tone: 'primary', onPress }],
    });

    const button = findActionButton(renderer, 'Download');
    expect(button).toBeDefined();
    act(() => {
      button!.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('calls onClose when the scrim is pressed', () => {
    const onClose = jest.fn();
    const renderer = renderMenu({
      onClose,
      actions: [{ label: 'Download', onPress: jest.fn() }],
    });

    act(() => {
      // The scrim is the one Pressable whose press handler IS onClose
      // (Pressable is memo-wrapped, so findByType doesn't match it).
      renderer.root.findByProps({ onPress: onClose }).props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('calls onClose on hardware back (Modal onRequestClose)', () => {
    const onClose = jest.fn();
    const renderer = renderMenu({
      onClose,
      actions: [{ label: 'Download', onPress: jest.fn() }],
    });

    const modal = renderer.root.findByType(Modal);
    act(() => {
      modal.props.onRequestClose();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('renders no content when not visible', () => {
    const renderer = renderMenu({ visible: false });

    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    expect(renderer.root.findAllByType(TouchableOpacity)).toHaveLength(0);

    renderer.unmount();
  });
});

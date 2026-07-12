import { useToastStore } from '../toastStore';

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.getState().hide();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('show() makes a toast visible with message and type', () => {
    useToastStore.getState().show('刷新成功', 'success');
    const state = useToastStore.getState();
    expect(state.visible).toBe(true);
    expect(state.message).toBe('刷新成功');
    expect(state.type).toBe('success');
  });

  test('show() defaults type to success', () => {
    useToastStore.getState().show('默认');
    expect(useToastStore.getState().type).toBe('success');
  });

  test('hide() makes the toast not visible', () => {
    useToastStore.getState().show('刷新成功', 'success');
    useToastStore.getState().hide();
    expect(useToastStore.getState().visible).toBe(false);
  });

  test('show() auto-hides after 1500ms', () => {
    useToastStore.getState().show('刷新成功', 'success');
    expect(useToastStore.getState().visible).toBe(true);
    jest.advanceTimersByTime(1499);
    expect(useToastStore.getState().visible).toBe(true);
    jest.advanceTimersByTime(1);
    expect(useToastStore.getState().visible).toBe(false);
  });

  test('a second show() replaces the first and does not hide early', () => {
    useToastStore.getState().show('第一条', 'success');
    jest.advanceTimersByTime(1000);
    useToastStore.getState().show('第二条', 'error');

    // The first toast's timeout (500ms remaining) must NOT fire and hide the
    // new toast prematurely.
    jest.advanceTimersByTime(600);
    const mid = useToastStore.getState();
    expect(mid.visible).toBe(true);
    expect(mid.message).toBe('第二条');
    expect(mid.type).toBe('error');

    // The new toast hides after its own 1500ms window.
    jest.advanceTimersByTime(900);
    expect(useToastStore.getState().visible).toBe(false);
  });
});

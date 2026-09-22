import { useDevicePinStore } from '../src/store/devicePinStore';

describe('devicePinStore', () => {
  beforeEach(() => {
    useDevicePinStore.setState({ pinned: null });
  });

  it('starts unpinned', () => {
    expect(useDevicePinStore.getState().pinned).toBeNull();
  });

  it('pin stores id + name snapshot', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    expect(useDevicePinStore.getState().pinned).toEqual({
      id: 'device-2',
      name: 'Studio',
    });
  });

  it('re-pin overwrites the previous device', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    useDevicePinStore.getState().pin({ id: 'device-1', name: 'MacBook' });
    expect(useDevicePinStore.getState().pinned).toEqual({
      id: 'device-1',
      name: 'MacBook',
    });
  });

  it('unpin clears', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    useDevicePinStore.getState().unpin();
    expect(useDevicePinStore.getState().pinned).toBeNull();
  });
});

/* eslint-env jest */

jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);

// App wraps NavigationContainer in <GestureHandlerRootView>. The native
// RNGestureHandlerModule isn't registered under Jest's TurboModule registry, so
// importing the real module throws at import time — mock it as a passthrough View.
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    GestureHandlerRootView: React.forwardRef((props, ref) =>
      React.createElement(View, { ...props, ref }),
    ),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    getItem: jest.fn(key => Promise.resolve(store[key] ?? null)),
    setItem: jest.fn((key, value) => {
      store[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn(key => {
      delete store[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store = {};
      return Promise.resolve();
    }),
  };
});

jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({
    status: 'authorized',
    hasPermission: true,
    canRequestPermission: false,
    requestPermission: jest.fn().mockResolvedValue(true),
  }),
}));

jest.mock('react-native-vision-camera-barcode-scanner', () => ({
  CodeScanner: 'CodeScanner',
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});

jest.mock('react-native-live-audio-stream', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
  },
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {
    setString: jest.fn(),
    setStringAsync: jest.fn(() => Promise.resolve()),
    getString: jest.fn(() => ''),
    getStringAsync: jest.fn(() => Promise.resolve('')),
  },
}));

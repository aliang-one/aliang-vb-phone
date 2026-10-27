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

// The file download save service (Task 17) is wired into FileBrowserScreen
// (Task 18), so the whole app graph (App.test.tsx → RootNavigator → screen →
// service) now reaches react-native-blob-util / react-native-share, whose
// import-time requireNativeModule throws under Jest. Stub them passthrough;
// suites that exercise the service (fileDownloadSave.test.ts) re-mock it with
// richer factories that take precedence over these.
jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    config: jest.fn(() => ({
      fetch: jest.fn(() => Promise.resolve({ path: jest.fn() })),
    })),
    // attachmentLibrary 在模块顶层读 fs.dirs.DocumentDir 拼素材目录——App 图
    // 里任何一个屏幕 import 到它都会触发。给个临时目录即可，测试不碰真实文件。
    fs: {
      dirs: {
        DocumentDir: '/tmp/rnbu/documents',
        CacheDir: '/tmp/rnbu/cache',
      },
      unlink: jest.fn(() => Promise.resolve(undefined)),
    },
  },
}));

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {
    open: jest.fn(() => Promise.resolve({ success: true })),
  },
}));

// 素材菜单把 image-picker / view-shot 拉进了 App 图（屏幕 → 菜单 → 服务），
// 两者的原生模块在 Jest 下 import 即抛。默认实现返回「用户取消」，
// 让任何渲染路径都不会意外走真实的采集流程；专项测试再各自覆盖。
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(() => Promise.resolve({ didCancel: true })),
  launchImageLibrary: jest.fn(() => Promise.resolve({ didCancel: true })),
}));

// 多个共享组件(ImageViewerModal / BottomSheet)要取安全区 inset;真机上由
// SafeAreaProvider 注入,测试环境没有 Provider 会直接抛错。用官方 mock 给全零
// insets,组件渲染路径不再依赖测试各自包 Provider。
jest.mock('react-native-safe-area-context', () => {
  // 官方 mock 是 `export default {...}` 的 ESM 形状,直接 require 出来拿不到具名
  // 导出(组件 `import { useSafeAreaInsets }` 会变成 undefined),这里摊平一层。
  const mock = require('react-native-safe-area-context/jest/mock').default;
  return { __esModule: true, ...mock };
});

jest.mock('react-native-view-shot', () => ({
  __esModule: true,
  default: jest.fn(() => Promise.resolve('/tmp/mock-shot.png')),
  captureRef: jest.fn(() => Promise.resolve('/tmp/mock-shot.png')),
  releaseCapture: jest.fn(),
}));

// Render in Chinese during tests. The app is Chinese-first historically and most
// component tests assert Chinese strings; pinning the i18n locale to 'zh' means
// migrating a screen to useTranslation() does NOT break its Chinese-asserting tests
// (English is validated by complete en.json resources + dedicated i18n tests, not
// by rewriting every screen's test assertions during migration).
require('./src/i18n').default.changeLanguage('zh');


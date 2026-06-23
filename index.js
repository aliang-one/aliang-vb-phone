/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry, LogBox } from 'react-native';
import { enableFreeze } from 'react-native-screens';
import App from './App';
import { name as appName } from './app.json';

// react-native-live-audio-stream@1.1.1 is a legacy (non-TurboModule) native
// module. On the New Architecture (Bridgeless) it eagerly constructs
// `new NativeEventEmitter(RNLiveAudioStream)` at require() time, and React
// Native warns because the module doesn't expose the `addListener` /
// `removeListeners` methods that Bridgeless NativeEventEmitter requires.
// This is an upstream incompatibility we can't fix without forking native
// code; the warning is expected noise from an optional voice-capture dep, so
// we silence just this message rather than disable the feature. Drop this when
// the library ships a New-Arch-compatible release.
LogBox.ignoreLogs([
  'new NativeEventEmitter() was called with a non-null argument',
]);

// Freeze offscreen screens at the native layer so the heavy pushed screens
// (chat, terminal, file browser, device detail) stop re-rendering in JS while
// the transition animation runs and while they sit beneath another screen.
// `enableFreeze` is opt-in; without it react-native-screens keeps offscreen
// screens live, and during an active AI session the store re-renders them at
// the streaming cadence — directly competing with navigation frames.
// Must run before the first render.
enableFreeze(true);

AppRegistry.registerComponent(appName, () => App);

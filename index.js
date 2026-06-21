/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry, LogBox } from 'react-native';
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

AppRegistry.registerComponent(appName, () => App);

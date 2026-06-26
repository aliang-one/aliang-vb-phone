import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useCameraDevice } from 'react-native-vision-camera';
import { CodeScanner } from 'react-native-vision-camera-barcode-scanner';

interface DeviceCodeScannerProps {
  isActive: boolean;
  style: StyleProp<ViewStyle>;
  onCodeScanned: (value?: string) => void;
  onError: (error: Error) => void;
}

export const DeviceCodeScanner: React.FC<DeviceCodeScannerProps> = ({
  isActive,
  style,
  onCodeScanned,
  onError,
}) => {
  // CodeScanner internally calls useCameraDevice('back') and THROWS
  // "No Camera device available!" when it returns null. On a real device that
  // null means vision-camera's native (Nitro) Camera module isn't delivering
  // devices to JS — typically a stale/incomplete APK build or a Nitro linkage
  // problem, NOT a missing camera. The throw is uncaught (no ErrorBoundary) so
  // it was a hard 闪退. Probe the device ourselves and skip rendering CodeScanner
  // when null so it degrades to the screen's manual-paste fallback instead of
  // crashing. (The underlying "no device" still needs a clean native rebuild.)
  const device = useCameraDevice('back');
  if (device == null) {
    return null;
  }

  return (
    <CodeScanner
      isActive={isActive}
      style={style}
      barcodeFormats={['all-formats']}
      onBarcodeScanned={barcodes =>
        onCodeScanned(barcodes[0]?.rawValue ?? barcodes[0]?.displayValue)
      }
      onError={onError}
    />
  );
};

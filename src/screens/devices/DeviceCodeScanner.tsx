import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { isScannedCode } from 'react-native-vision-camera';
import { Camera, useCameraDevice, useObjectOutput } from 'react-native-vision-camera';

interface DeviceCodeScannerProps {
  isActive: boolean;
  style: StyleProp<ViewStyle>;
  onCodeScanned: (value?: string) => void;
  onError: (error: Error) => void;
}

const scannableTypes = [
  'qr',
  'micro-qr',
  'aztec',
  'data-matrix',
  'pdf-417',
  'code-128',
  'code-39',
  'code-93',
  'ean-8',
  'ean-13',
  'upc-e',
  'codabar',
  'itf-14',
] as const;

export const DeviceCodeScanner: React.FC<DeviceCodeScannerProps> = ({
  isActive,
  style,
  onCodeScanned,
  onError,
}) => {
  const device = useCameraDevice('back');
  const objectOutput = useObjectOutput({
    types: [...scannableTypes],
    onObjectsScanned: objects => {
      const code = objects.find(isScannedCode);
      onCodeScanned(code?.value);
    },
  });

  // useCameraDevice returns undefined when there is no matching camera (e.g. the
  // iOS Simulator has no camera hardware, or the device hasn't been enumerated
  // on the first render). Throwing here crashed the app — there is no
  // ErrorBoundary to catch a render-phase throw, so on a release build it was a
  // hard 闪退. Render nothing instead; the owning screen's camera frame stays
  // empty until a device is available (or permanently on the Simulator).
  if (!device) {
    return null;
  }

  return (
    <Camera
      isActive={isActive}
      style={style}
      device={device}
      outputs={[objectOutput]}
      onError={onError}
    />
  );
};

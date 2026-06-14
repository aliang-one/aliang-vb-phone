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

  if (!device) {
    throw new Error('No Camera device available.');
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

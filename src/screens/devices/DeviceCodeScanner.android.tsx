import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
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
}) => (
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

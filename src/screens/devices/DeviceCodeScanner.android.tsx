import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Camera, useCameraDevices } from 'react-native-vision-camera';
import {
  useBarcodeScannerOutput,
} from 'react-native-vision-camera-barcode-scanner';
import type { TargetBarcodeFormat } from 'react-native-vision-camera-barcode-scanner';
import { useTranslation } from 'react-i18next';

interface DeviceCodeScannerProps {
  isActive: boolean;
  style: StyleProp<ViewStyle>;
  onCodeScanned: (value?: string) => void;
  onError: (error: Error) => void;
}

const barcodeFormats: TargetBarcodeFormat[] = ['all-formats'];

export const DeviceCodeScanner: React.FC<DeviceCodeScannerProps> = ({
  isActive,
  style,
  onCodeScanned,
  onError,
}) => {
  const devices = useCameraDevices();
  const { t } = useTranslation('devices');
  const device = useMemo(
    () =>
      devices.find(candidate => candidate.position === 'back') ??
      devices.find(candidate => candidate.position === 'unspecified') ??
      devices[0],
    [devices],
  );
  const barcodeOutput = useBarcodeScannerOutput({
    barcodeFormats,
    onBarcodeScanned: barcodes =>
      onCodeScanned(barcodes[0]?.rawValue ?? barcodes[0]?.displayValue),
    onError,
  });

  if (device == null) {
    return (
      <View style={[style, styles.placeholder]}>
        <Text style={styles.placeholderText}>{t('codeScanner.starting')}</Text>
      </View>
    );
  }

  return (
    <Camera
      isActive={isActive}
      style={style}
      device={device}
      implementationMode="compatible"
      outputs={[barcodeOutput]}
      onError={onError}
    />
  );
};

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 13,
  },
});

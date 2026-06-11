import React, { useMemo, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCameraPermission } from 'react-native-vision-camera';
import { CodeScanner } from 'react-native-vision-camera-barcode-scanner';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { IconBadge } from '../../components/visual/IconBadge';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import { useControlCenterStore } from '../../store/controlCenterStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

interface DeviceDraft {
  name: string;
  os: string;
  host: string;
  location: string;
  pairingCode: string;
}

const fallbackDraft = (rawValue: string): DeviceDraft => {
  const suffix = rawValue.replace(/[^a-zA-Z0-9]/g, '').slice(-4) || '0000';
  return {
    name: `Scanned Device ${suffix}`,
    os: 'macOS',
    host: `relay:scanned-${suffix.toLowerCase()}`,
    location: 'Remote device',
    pairingCode: rawValue,
  };
};

const parseQueryDraft = (value: string): DeviceDraft | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'vibecoding:') {
      return undefined;
    }

    return {
      name: url.searchParams.get('name') || 'Scanned Device',
      os: url.searchParams.get('os') || 'macOS',
      host: url.searchParams.get('host') || 'relay:scanned-device',
      location: url.searchParams.get('location') || 'Remote device',
      pairingCode: url.searchParams.get('pairingCode') || value,
    };
  } catch {
    return undefined;
  }
};

const parseJsonDraft = (value: string): DeviceDraft | undefined => {
  try {
    const payload = JSON.parse(value) as Partial<DeviceDraft>;
    if (!payload.name && !payload.pairingCode) {
      return undefined;
    }

    return {
      name: payload.name || 'Scanned Device',
      os: payload.os || 'macOS',
      host: payload.host || 'relay:scanned-device',
      location: payload.location || 'Remote device',
      pairingCode: payload.pairingCode || value,
    };
  } catch {
    return undefined;
  }
};

const parseDeviceDraft = (rawValue: string) =>
  parseJsonDraft(rawValue) ?? parseQueryDraft(rawValue) ?? fallbackDraft(rawValue);

export const DeviceCameraScannerScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const isFocused = useIsFocused();
  const { hasPermission, canRequestPermission, requestPermission, status } =
    useCameraPermission();
  const devices = useControlCenterStore(state => state.devices);
  const bindDevice = useControlCenterStore(state => state.bindDevice);
  const [draft, setDraft] = useState<DeviceDraft | undefined>();
  const [message, setMessage] = useState('');
  const [scannerError, setScannerError] = useState('');
  const [paused, setPaused] = useState(false);

  const duplicate = useMemo(
    () =>
      Boolean(
        draft &&
          devices.some(
            device =>
              device.name.toLowerCase() === draft.name.trim().toLowerCase(),
          ),
      ),
    [devices, draft],
  );

  const handleRequestPermission = async () => {
    const granted = await requestPermission();
    if (!granted) {
      setMessage('Camera permission was not granted.');
    }
  };

  const handleBind = () => {
    if (!draft) {
      return;
    }

    const result = bindDevice(draft);
    if (!result.ok || !result.deviceId) {
      setMessage(result.error ?? 'Unable to bind this device.');
      return;
    }

    navigation.replace('DeviceDetail', { deviceId: result.deviceId });
  };

  const handleScannedValue = (rawValue?: string) => {
    if (!rawValue || paused) {
      return;
    }

    setDraft(parseDeviceDraft(rawValue));
    setMessage('');
    setScannerError('');
    setPaused(true);
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Scan Device"
        subtitle="CAMERA PAIRING"
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={hasPermission ? 'CAMERA ON' : status.toUpperCase()}
            type={hasPermission ? 'success' : 'warning'}
          />
        }
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel glowColor="primary" style={styles.cameraPanel}>
          {hasPermission ? (
            <View style={styles.cameraFrame}>
              <CodeScanner
                isActive={isFocused && !paused}
                style={StyleSheet.absoluteFill}
                barcodeFormats={['all-formats']}
                onBarcodeScanned={barcodes =>
                  handleScannedValue(barcodes[0]?.rawValue ?? barcodes[0]?.displayValue)
                }
                onError={error => setScannerError(error.message)}
              />
              <View pointerEvents="none" style={styles.scanOverlay}>
                <View style={[styles.corner, styles.cornerTopLeft]} />
                <View style={[styles.corner, styles.cornerTopRight]} />
                <View style={[styles.corner, styles.cornerBottomLeft]} />
                <View style={[styles.corner, styles.cornerBottomRight]} />
                <View style={[styles.scanLine, { backgroundColor: theme.colors.primary }]} />
              </View>
              {paused ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => {
                    setDraft(undefined);
                    setPaused(false);
                    setMessage('');
                  }}
                  style={[
                    styles.rescanButton,
                    {
                      backgroundColor: theme.colors.primary,
                      borderRadius: theme.borderRadius.full,
                    },
                  ]}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onPrimary }]}>
                    RESCAN
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <View style={styles.permissionPanel}>
              <IconBadge name="scan" tone="primary" size={72} iconSize={36} />
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                Camera access required
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant, textAlign: 'center' }]}>
                Scan the desktop agent QR code to bind this phone with a computer.
              </Text>
              <GlowButton
                title={canRequestPermission ? 'ALLOW CAMERA' : 'OPEN SETTINGS'}
                onPress={
                  canRequestPermission
                    ? handleRequestPermission
                    : () => Linking.openSettings()
                }
                variant="primary"
                style={styles.permissionButton}
              />
            </View>
          )}
        </GlassPanel>

        {scannerError ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
            {scannerError}
          </Text>
        ) : null}

        {draft ? (
          <GlassPanel style={styles.resultPanel} glowColor={duplicate ? 'error' : 'secondary'}>
            <View style={styles.resultHeader}>
              <IconBadge
                name={duplicate ? 'warning' : 'device'}
                tone={duplicate ? 'error' : 'secondary'}
                size={44}
                iconSize={22}
              />
              <View style={styles.resultTitle}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {duplicate ? 'Rename before binding' : 'Ready to bind'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {draft.pairingCode}
                </Text>
              </View>
              <StatusChip label={duplicate ? 'DUPLICATE' : 'READY'} type={duplicate ? 'error' : 'success'} />
            </View>
            <DraftField
              label="Device name"
              value={draft.name}
              onChangeText={value => setDraft(current => current && { ...current, name: value })}
            />
            <View style={styles.detailGrid}>
              <DraftFact label="OS" value={draft.os} />
              <DraftFact label="Host" value={draft.host} />
              <DraftFact label="Location" value={draft.location} />
            </View>
            {duplicate ? (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() =>
                  setDraft(current =>
                    current ? { ...current, name: `${current.name} 2` } : current,
                  )
                }
                style={[
                  styles.safeNameButton,
                  {
                    borderColor: theme.colors.outlineVariant,
                    borderRadius: theme.borderRadius.full,
                  },
                ]}>
                <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                  USE SAFE NAME
                </Text>
              </TouchableOpacity>
            ) : null}
            {message ? (
              <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
                {message}
              </Text>
            ) : null}
            <GlowButton
              title="BIND THIS DEVICE"
              onPress={handleBind}
              disabled={duplicate || !draft.name.trim()}
            />
          </GlassPanel>
        ) : null}

        <GlassPanel style={styles.manualPanel}>
          <View style={styles.manualTop}>
            <IconBadge name="code" tone="neutral" size={36} iconSize={18} />
            <View style={styles.resultTitle}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                Manual fallback
              </Text>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                Paste a QR payload when testing without a physical camera.
              </Text>
            </View>
          </View>
          <TextInput
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="vibecoding://bind?name=Mac%20Mini&pairingCode=PAIR-1234"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            onSubmitEditing={event => handleScannedValue(event.nativeEvent.text)}
            style={[
              theme.typography.codeSm,
              styles.manualInput,
              {
                color: theme.colors.onSurface,
                borderColor: theme.colors.outlineVariant,
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.04)'
                  : theme.colors.surfaceContainer,
                borderRadius: theme.borderRadius.md,
              },
            ]}
          />
        </GlassPanel>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

interface DraftFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}

const DraftField: React.FC<DraftFieldProps> = ({
  label,
  value,
  onChangeText,
}) => {
  const { theme, isDark } = useTheme();

  return (
    <View style={styles.draftField}>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          theme.typography.codeSm,
          styles.draftInput,
          {
            color: theme.colors.onSurface,
            borderColor: theme.colors.outlineVariant,
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.04)'
              : theme.colors.surfaceContainer,
            borderRadius: theme.borderRadius.md,
          },
        ]}
      />
    </View>
  );
};

interface DraftFactProps {
  label: string;
  value: string;
}

const DraftFact: React.FC<DraftFactProps> = ({ label, value }) => {
  const { theme, isDark } = useTheme();

  return (
    <View
      style={[
        styles.fact,
        {
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.05)'
            : theme.colors.surfaceContainer,
        },
      ]}>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 12,
  },
  cameraPanel: {
    minHeight: 360,
  },
  cameraFrame: {
    height: 360,
    backgroundColor: '#000',
    position: 'relative',
  },
  scanOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  cornerTopLeft: {
    top: 72,
    left: 42,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTopRight: {
    top: 72,
    right: 42,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBottomLeft: {
    bottom: 72,
    left: 42,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBottomRight: {
    bottom: 72,
    right: 42,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  scanLine: {
    width: '62%',
    height: 2,
    borderRadius: 1,
  },
  rescanButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  permissionPanel: {
    minHeight: 340,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  permissionButton: {
    marginTop: 8,
    minWidth: 180,
  },
  resultPanel: {
    padding: 12,
    gap: 12,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resultTitle: {
    flex: 1,
    gap: 3,
  },
  draftField: {
    gap: 6,
  },
  draftInput: {
    minHeight: 46,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fact: {
    width: '48%',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  safeNameButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  manualPanel: {
    padding: 12,
    gap: 10,
  },
  manualTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  manualInput: {
    minHeight: 72,
    textAlignVertical: 'top',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});

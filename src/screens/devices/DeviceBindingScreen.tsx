import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import { useControlCenterStore } from '../../store/controlCenterStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const quickScans = [
  {
    label: 'Desk QR',
    name: 'Mac Studio - Desk',
    os: 'macOS 15.5',
    host: 'relay:mac-studio-desk',
    location: 'Shanghai desk',
    pairingCode: 'PAIR-DESK-8841',
  },
  {
    label: 'New QR',
    name: 'Mac Mini - Lab',
    os: 'macOS 15.5',
    host: 'relay:mac-mini-lab',
    location: 'Lab bench',
    pairingCode: 'PAIR-LAB-2190',
  },
];

export const DeviceBindingScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const bindDevice = useControlCenterStore(state => state.bindDevice);
  const [name, setName] = useState('Mac Mini - Lab');
  const [os, setOs] = useState('macOS 15.5');
  const [host, setHost] = useState('relay:mac-mini-lab');
  const [location, setLocation] = useState('Lab bench');
  const [pairingCode, setPairingCode] = useState('PAIR-LAB-2190');
  const [message, setMessage] = useState('');

  const duplicate = useMemo(
    () =>
      devices.some(
        device => device.name.toLowerCase() === name.trim().toLowerCase(),
      ),
    [devices, name],
  );

  const handleQuickScan = (scan: (typeof quickScans)[number]) => {
    setName(scan.name);
    setOs(scan.os);
    setHost(scan.host);
    setLocation(scan.location);
    setPairingCode(scan.pairingCode);
    setMessage('');
  };

  const handleBind = () => {
    const result = bindDevice({
      name,
      os,
      host,
      location,
      pairingCode,
    });

    if (!result.ok || !result.deviceId) {
      setMessage(result.error ?? 'Unable to bind this device.');
      return;
    }

    navigation.replace('DeviceDetail', { deviceId: result.deviceId });
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Bind Device"
        subtitle="SCAN QR / PAIRING CODE"
        onBack={navigation.goBack}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.scannerPanel} glowColor="primary">
          <View
            style={[
              styles.qrFrame,
              {
                borderColor: duplicate
                  ? theme.colors.error
                  : theme.colors.primary,
                backgroundColor: isDark
                  ? 'rgba(0, 209, 255, 0.07)'
                  : theme.colors.surfaceContainerLow,
              },
            ]}>
            <View style={[styles.qrDot, { backgroundColor: theme.colors.primary }]} />
            <View style={[styles.qrDot, { backgroundColor: theme.colors.secondary }]} />
            <View style={[styles.qrDot, { backgroundColor: theme.colors.tertiary }]} />
            <View style={[styles.qrLine, { backgroundColor: theme.colors.primary }]} />
          </View>
          <View style={styles.scanMeta}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
              SIMULATED SCANNER
            </Text>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              Pairing code is decoded from the desktop agent QR and kept in local state.
            </Text>
          </View>
        </GlassPanel>

        <View style={styles.quickRow}>
          {quickScans.map(scan => (
            <TouchableOpacity
              key={scan.pairingCode}
              activeOpacity={0.75}
              onPress={() => handleQuickScan(scan)}
              style={[
                styles.quickCard,
                {
                  borderRadius: theme.borderRadius.md,
                  borderColor: theme.colors.outlineVariant,
                },
              ]}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                {scan.label}
              </Text>
              <Text
                numberOfLines={1}
                style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
                {scan.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <GlassPanel style={styles.formPanel}>
          <View style={styles.formHeader}>
            <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
              Device Identity
            </Text>
            <StatusChip label={duplicate ? 'DUPLICATE' : 'READY'} type={duplicate ? 'error' : 'success'} />
          </View>
          <Field label="Device name" value={name} onChangeText={setName} />
          <Field label="Pairing code" value={pairingCode} onChangeText={setPairingCode} />
          <Field label="Host" value={host} onChangeText={setHost} />
          <Field label="OS" value={os} onChangeText={setOs} />
          <Field label="Location" value={location} onChangeText={setLocation} />
          {duplicate ? (
            <View style={[styles.warningBox, { borderColor: theme.colors.error }]}>
              <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
                This device name already exists. Rename it before binding, or add a
                location suffix.
              </Text>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => setName(`${name.trim()} 2`)}>
                <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                  USE SAFE NAME
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {message ? (
            <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
              {message}
            </Text>
          ) : null}
        </GlassPanel>

        <GlowButton
          title="BIND DEVICE"
          onPress={handleBind}
          disabled={!name.trim() || !pairingCode.trim() || duplicate}
          style={styles.bindButton}
        />
      </ScrollView>
    </SafeAreaWrapper>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}

const Field: React.FC<FieldProps> = ({ label, value, onChangeText }) => {
  const { theme, isDark } = useTheme();

  return (
    <View style={styles.field}>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={theme.colors.onSurfaceVariant}
        style={[
          theme.typography.codeSm,
          styles.input,
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

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  scannerPanel: {
    padding: 14,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  qrFrame: {
    width: 112,
    height: 112,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    justifyContent: 'space-between',
  },
  qrDot: {
    width: 22,
    height: 22,
    borderRadius: 4,
  },
  qrLine: {
    height: 3,
    borderRadius: 2,
  },
  scanMeta: {
    flex: 1,
    gap: 8,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  quickCard: {
    flex: 1,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  formPanel: {
    marginTop: 14,
    padding: 12,
    gap: 12,
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  field: {
    gap: 6,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  bindButton: {
    marginTop: 12,
  },
});

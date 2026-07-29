import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useSessionStore } from '../stores/useSettingsStore';

jest.mock('@react-navigation/native', () => {
  const ReactActual = require('react');
  return {
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactActual.useEffect(() => cb(), []);
    },
    useRoute: () => ({ params: {} }),
  };
});
jest.mock('../src/components/layout/SafeAreaWrapper', () => ({
  SafeAreaWrapper: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../src/i18n/useLocale', () => ({
  useLocale: () => ({ locale: 'zh', setLocale: jest.fn() }),
}));
jest.mock('../src/services/credentialStore', () => ({
  readCredentialFlag: jest.fn(),
  loadCredentials: jest.fn(),
  writeCredentialFlag: jest.fn(),
}));

import { LoginScreen } from '../src/screens/auth/LoginScreen';
import {
  readCredentialFlag,
  loadCredentials,
  writeCredentialFlag,
} from '../src/services/credentialStore';

const flush = () =>
  act(async () => {
    await new Promise<void>(r => setTimeout(() => r(), 0));
    await new Promise<void>(r => setImmediate(() => r()));
  });
// handleBiometricLogin waits 120ms for the keyboard to dismiss before prompting.
const flushLong = () =>
  act(async () => {
    await new Promise<void>(r => setTimeout(() => r(), 160));
  });

const mountScreen = () => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{ theme: utilityMinimalist, mode: 'light', setMode: () => {}, isDark: false }}
      >
        <LoginScreen />
      </ThemeContext.Provider>,
    );
  });
  return r;
};

const tapBiometricEntry = (r: ReactTestRenderer.ReactTestRenderer) => {
  const node = r.root.findAllByProps({ testID: 'biometric-entry' })[0];
  expect(node).toBeDefined();
  act(() => {
    (node.props as { onPress: () => void }).onPress();
  });
};

describe('LoginScreen biometric entry (explicit button, no auto-prompt)', () => {
  let realLogin: unknown;
  beforeEach(() => {
    jest.clearAllMocks();
    realLogin = useSessionStore.getState().login;
    useSessionStore.setState({ login: jest.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => {
    useSessionStore.setState({ login: realLogin as never });
  });

  it('flag=biometric → shows entry button, does NOT auto-prompt or auto-login', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: true });
    const r = mountScreen();
    await flush();
    expect(r.root.findAllByProps({ testID: 'biometric-entry' }).length).toBeGreaterThan(0);
    expect(loadCredentials).not.toHaveBeenCalled(); // no auto-prompt
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
  });

  it('tap entry → biometric ok → auto-login with saved creds', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: true });
    (loadCredentials as jest.Mock).mockResolvedValue({ status: 'ok', email: 'a@b.c', password: 'pw' });
    const r = mountScreen();
    await flush();
    tapBiometricEntry(r);
    await flushLong();
    expect(loadCredentials).toHaveBeenCalled();
    expect(useSessionStore.getState().login).toHaveBeenCalledWith('a@b.c', 'pw');
  });

  it('tap entry → cancelled → NO login; entry stays so user can retry', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: true });
    (loadCredentials as jest.Mock).mockResolvedValue({ status: 'cancelled' });
    const r = mountScreen();
    await flush();
    tapBiometricEntry(r);
    await flushLong();
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
    expect(writeCredentialFlag).not.toHaveBeenCalled(); // flag kept
    expect(r.root.findAllByProps({ testID: 'biometric-entry' }).length).toBeGreaterThan(0);
  });

  it('tap entry → unavailable → flag cleared + entry hidden', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: true });
    (loadCredentials as jest.Mock).mockResolvedValue({ status: 'unavailable' });
    const r = mountScreen();
    await flush();
    tapBiometricEntry(r);
    await flushLong();
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
    expect(writeCredentialFlag).toHaveBeenCalledWith({ hasCreds: false, usesBiometry: false });
  });

  it('flag=plain (no biometry) → prefills form, does NOT auto-submit, no entry button', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: false });
    (loadCredentials as jest.Mock).mockResolvedValue({ status: 'ok', email: 'a@b.c', password: 'pw' });
    const r = mountScreen();
    await flush();
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
    expect(r.root.findAllByProps({ testID: 'biometric-entry' }).length).toBe(0);
  });

  it('no saved creds → no entry button, no load', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: false, usesBiometry: false });
    const r = mountScreen();
    await flush();
    expect(loadCredentials).not.toHaveBeenCalled();
    expect(r.root.findAllByProps({ testID: 'biometric-entry' }).length).toBe(0);
  });
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useSessionStore } from '../stores/useSettingsStore';

jest.mock('@react-navigation/native', () => {
  const ReactActual = require('react');
  return {
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
    // Real useFocusEffect runs the callback on focus when its deps change; with
    // useCallback([]) that is ONCE on mount. A naive `() => { cb() }` mock would
    // re-run cb on every render → infinite re-render loop. Run once via useEffect.
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
import { readCredentialFlag, loadCredentials, writeCredentialFlag } from '../src/services/credentialStore';

const flush = () =>
  act(async () => {
    // Drain the async IIFE's chained awaits + the re-renders they schedule.
    await new Promise<void>(r => setTimeout(() => r(), 0));
    await new Promise<void>(r => setImmediate(() => r()));
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

describe('LoginScreen biometric flow', () => {
  let realLogin: unknown;
  beforeEach(() => {
    jest.clearAllMocks();
    realLogin = useSessionStore.getState().login;
    useSessionStore.setState({ login: jest.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => {
    useSessionStore.setState({ login: realLogin as never });
  });

  it('auto-logs in when flag=biometric and loadCredentials resolves ok', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: true });
    (loadCredentials as jest.Mock).mockResolvedValue({ status: 'ok', email: 'a@b.c', password: 'pw' });
    mountScreen();
    await flush();
    expect(loadCredentials).toHaveBeenCalled();
    expect(useSessionStore.getState().login).toHaveBeenCalledWith('a@b.c', 'pw');
  });

  it('cancel → retry button shown + flag KEPT (not self-healed); login NOT called', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: true });
    (loadCredentials as jest.Mock).mockResolvedValue({ status: 'cancelled' });
    const r = mountScreen();
    await flush();
    // Cancel keeps the flag so the feature survives a dismiss; retry offered.
    expect(writeCredentialFlag).not.toHaveBeenCalled();
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
    expect(r.root.findAllByProps({ testID: 'biometric-retry' }).length).toBeGreaterThan(0);
  });

  it('unavailable (reject) → flag cleared, NO retry button, login NOT called', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: true });
    (loadCredentials as jest.Mock).mockResolvedValue({ status: 'unavailable' });
    const r = mountScreen();
    await flush();
    expect(writeCredentialFlag).toHaveBeenCalledWith({ hasCreds: false, usesBiometry: false });
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
    expect(r.root.findAllByProps({ testID: 'biometric-retry' }).length).toBe(0);
  });

  it('flag=plain → prefills, does NOT auto-submit', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: false });
    (loadCredentials as jest.Mock).mockResolvedValue({ status: 'ok', email: 'a@b.c', password: 'pw' });
    mountScreen();
    await flush();
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
  });

  it('no saved creds → no load, empty form', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: false, usesBiometry: false });
    mountScreen();
    await flush();
    expect(loadCredentials).not.toHaveBeenCalled();
  });

  it('user typing aborts a pending auto-submit (cancelledRef)', async () => {
    (readCredentialFlag as jest.Mock).mockResolvedValue({ hasCreds: true, usesBiometry: true });
    let resolveCreds!: (v: unknown) => void;
    (loadCredentials as jest.Mock).mockReturnValue(
      new Promise(r => {
        resolveCreds = r;
      }),
    );
    const r = mountScreen();
    // User types into the email field before the prompt resolves.
    act(() => {
      r.root.findAllByType(TextInput)[0].props.onChangeText('x');
    });
    resolveCreds({ status: 'ok', email: 'a@b.c', password: 'pw' });
    await flush();
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
  });
});

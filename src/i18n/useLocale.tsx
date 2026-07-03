// Locale provider — mirrors ThemeProvider: holds the active locale, persists the
// user's choice to AsyncStorage, and applies it to the i18n singleton. Components
// read translated strings via react-i18next's useTranslation(); this hook is only
// for the locale selector itself.
import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n, { type AppLocale } from './index';

const LOCALE_KEY = '@app_locale';
const DEFAULT_LOCALE: AppLocale = 'en';

interface LocaleContextValue {
  locale: AppLocale;
  setLocale: (next: AppLocale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    AsyncStorage.getItem(LOCALE_KEY).then(stored => {
      if (stored === 'en' || stored === 'zh') {
        setLocaleState(stored);
        void i18n.changeLanguage(stored);
      }
    });
  }, []);

  const setLocale = (next: AppLocale) => {
    setLocaleState(next);
    void i18n.changeLanguage(next);
    AsyncStorage.setItem(LOCALE_KEY, next);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
};

export const useLocale = (): LocaleContextValue => useContext(LocaleContext);

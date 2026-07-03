// i18n entrypoint — initialized once at module load.
//
// react-i18next's useTranslation() reads the active language from this singleton;
// LocaleProvider persists the user's choice (AsyncStorage) and calls
// changeLanguage on change. Default 'en'; missing keys fall back to 'en' resources
// so untranslated screens degrade gracefully during migration.
//
// Resources are split per-namespace (common / settings / …) so parallel screen
// migrations don't collide on one giant JSON. Add a namespace by importing its
// en/zh JSON and registering it under both languages below.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import commonEn from './locales/common/en.json';
import commonZh from './locales/common/zh.json';
import settingsEn from './locales/settings/en.json';
import settingsZh from './locales/settings/zh.json';

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: commonEn, settings: settingsEn },
    zh: { common: commonZh, settings: settingsZh },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'settings'],
  interpolation: { escapeValue: false }, // RN needs no HTML escaping
  returnObjects: true,
});

export type AppLocale = 'en' | 'zh';

export default i18n;

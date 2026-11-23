import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import { useLocal } from '../hooks/useLocal';
import { setDisplayCurrency, useExchangeRate, type Currency } from '../lib/currency';
import { vi } from './vi';

export type Language = 'en' | 'vi';
type Translator = (text: string, values?: Record<string, string | number>) => string;
type Localization = {
  language: Language; setLanguage: (language: Language) => void; t: Translator; locale: string;
  /** Display currency: VND in Vietnamese, USD in English. Stored amounts stay in VND. */
  currency: Currency;
  /** VND per 1 USD used for the conversion. */
  rate: number;
};
const LocalizationContext = createContext<Localization | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [preference, setLanguage] = useLocal<Language>('mm-language-v1', 'en');
  const language = preference === 'vi' ? 'vi' : 'en';
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB';
  const currency: Currency = language === 'vi' ? 'VND' : 'USD';
  const rate = useExchangeRate();
  // Set before the children render, so every money() call in this render already uses the new currency.
  setDisplayCurrency(currency, rate);
  useLayoutEffect(() => { document.documentElement.lang = language; }, [language]);
  const t: Translator = (text, values) => {
    const translation = language === 'vi' && Object.prototype.hasOwnProperty.call(vi, text) ? vi[text] : text;
    return values ? translation.replace(/\{(\w+)\}/g, (match, key) => key in values ? String(values[key]) : match) : translation;
  };
  return <LocalizationContext.Provider value={{ language, setLanguage, locale, t, currency, rate }}>{children}</LocalizationContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LocalizationContext);
  if (!value) throw new Error('LanguageProvider is required');
  return value;
}

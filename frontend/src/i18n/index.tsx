import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import { useLocal } from '../hooks/useLocal';
import { vi } from './vi';

export type Language = 'en' | 'vi';
type Translator = (text: string, values?: Record<string, string | number>) => string;
type Localization = { language: Language; setLanguage: (language: Language) => void; t: Translator; locale: string };
const LocalizationContext = createContext<Localization | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [preference, setLanguage] = useLocal<Language>('mm-language-v1', 'en');
  const language = preference === 'vi' ? 'vi' : 'en';
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB';
  useLayoutEffect(() => { document.documentElement.lang = language; }, [language]);
  const t: Translator = (text, values) => {
    const translation = language === 'vi' && Object.prototype.hasOwnProperty.call(vi, text) ? vi[text] : text;
    return values ? translation.replace(/\{(\w+)\}/g, (match, key) => key in values ? String(values[key]) : match) : translation;
  };
  return <LocalizationContext.Provider value={{ language, setLanguage, locale, t }}>{children}</LocalizationContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LocalizationContext);
  if (!value) throw new Error('LanguageProvider is required');
  return value;
}

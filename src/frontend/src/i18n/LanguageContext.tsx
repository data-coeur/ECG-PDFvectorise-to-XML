import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import translations, { type Lang, type TranslationKey } from './translations';

interface LanguageCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const Ctx = createContext<LanguageCtx>(null!);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem('ecg-lang') as Lang) || 'fr',
  );

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem('ecg-lang', l);
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      let str: string = translations[lang][key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    },
    [lang],
  );

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useLanguage() {
  return useContext(Ctx);
}

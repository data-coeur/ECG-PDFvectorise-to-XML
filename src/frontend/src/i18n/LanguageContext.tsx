// LanguageContext — provider React qui expose { lang, setLang, t } à toute
// l'app. Persiste la langue choisie dans localStorage('ecg-lang'). La fonction
// t(key, params?) lookup dans translations[lang] puis substitue les {placeholders}.
// Utilisé par : main.tsx (au sommet de l'arbre) et tous les composants via useLanguage().
// Raison : centraliser FR/EN, garder l'UI traduite sans framework lourd.

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

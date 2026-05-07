// i18n — barrel re-export. Tout consommateur fait `import { useLanguage } from '../i18n'`.
// LanguageProvider et useLanguage viennent de ./LanguageContext.tsx ;
// les types Lang et TranslationKey viennent de ./translations.ts.
// Raison : éviter d'exposer la mécanique interne (Context, dictionnaires) ailleurs.

export { LanguageProvider, useLanguage } from './LanguageContext';
export type { Lang, TranslationKey } from './translations';

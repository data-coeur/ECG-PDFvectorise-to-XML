// LanguageToggle — petit bouton FR / EN dans le header de l'app.
// Bascule la langue active du contexte i18n (persistée dans localStorage).
// Utilisé par : App.tsx, dans la barre du haut.
// Raison : laisser l'utilisateur choisir sa langue sans toucher à l'URL ni au compte.

import { useLanguage } from '../i18n';

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/50 p-0.5 text-xs font-medium backdrop-blur-sm">
      <button
        onClick={() => setLang('fr')}
        className={`rounded-full px-2.5 py-1 transition-all ${lang === 'fr' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
      >
        FR
      </button>
      <button
        onClick={() => setLang('en')}
        className={`rounded-full px-2.5 py-1 transition-all ${lang === 'en' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
      >
        EN
      </button>
    </div>
  );
}

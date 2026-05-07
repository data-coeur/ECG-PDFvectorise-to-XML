// InfoCard — bloc d'accueil affiché tant qu'aucun fichier n'est déposé.
// 5 sections (principe, upload, extract, convert, privacy) générées en boucle
// depuis un tableau de clés i18n et de path SVG.
// Utilisé par : App.tsx (rendu conditionnel quand `batch.length === 0`).
// Raison : présenter le projet et rassurer sur la confidentialité avant le drop.

import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

const SECTIONS: { icon: string; titleKey: TranslationKey; textKey: TranslationKey }[] = [
  { icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', titleKey: 'info.principle.title', textKey: 'info.principle.text' },
  { icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12', titleKey: 'info.upload.title', textKey: 'info.upload.text' },
  { icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', titleKey: 'info.extract.title', textKey: 'info.extract.text' },
  { icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4', titleKey: 'info.convert.title', textKey: 'info.convert.text' },
  { icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z', titleKey: 'info.privacy.title', textKey: 'info.privacy.text' },
];

export default function InfoCard() {
  const { t } = useLanguage();

  return (
    <div className="glass-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s, i) => (
          <div key={i} className={`flex gap-3 ${i === 0 ? 'sm:col-span-2' : ''}`}>
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={s.icon} />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">{t(s.titleKey)}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{t(s.textKey)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

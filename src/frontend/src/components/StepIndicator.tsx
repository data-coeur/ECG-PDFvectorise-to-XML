// StepIndicator — fil d'ariane visuel des 4 étapes du parcours utilisateur :
// upload → extract → send → download. Affiche l'étape courante en surbrillance
// et coche celles déjà complétées.
// Props : { current: Step; completed: Step[] }. Utilisé par App.tsx en haut de page.
// Raison : donner un repère permanent sur la progression dans le pipeline frontend.

import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

export type Step = 'upload' | 'extract' | 'send' | 'download';

const STEPS: { key: Step; labelKey: TranslationKey }[] = [
  { key: 'upload', labelKey: 'step.upload' },
  { key: 'extract', labelKey: 'step.extract' },
  { key: 'send', labelKey: 'step.send' },
  { key: 'download', labelKey: 'step.download' },
];

const ORDER: Record<Step, number> = { upload: 0, extract: 1, send: 2, download: 3 };

interface Props {
  current: Step;
  completed: Step[];
}

export default function StepIndicator({ current, completed }: Props) {
  const { t } = useLanguage();
  const currentIdx = ORDER[current];

  return (
    <div className="flex items-center justify-center gap-0 py-4">
      {STEPS.map((s, i) => {
        const done = completed.includes(s.key);
        const active = s.key === current;
        const past = ORDER[s.key] < currentIdx;
        return (
          <div key={s.key} className="flex items-start">
            {i > 0 && (
              <div className={`h-0.5 w-6 sm:w-10 mt-[15px] mx-1 transition-colors ${done || past ? 'bg-primary' : 'bg-slate-200'}`} />
            )}
            <div className="flex w-20 sm:w-24 flex-col items-center gap-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                  done
                    ? 'bg-primary text-white'
                    : active
                      ? 'bg-primary/10 text-primary ring-2 ring-primary'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-[10px] sm:text-xs font-medium ${active ? 'text-primary' : done || past ? 'text-slate-600' : 'text-slate-400'}`}>
                {t(s.labelKey)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

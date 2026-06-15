// BatchConversionModal — modal listant deux options pour traiter de gros
// volumes d'ECG : "managed service" (contact email) et "self-hosted" (lien
// GitHub + tutoriel). Rendue dans un portal au-dessus du reste de l'UI.
// Props : { open: boolean; onClose: () => void }. Montée par BatchConversionButton.
// Raison : éviter d'inonder le batch panel quand l'utilisateur dépasse MAX_BATCH.

import { createPortal } from 'react-dom';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

const GITHUB_REPO_URL = 'https://github.com/data-coeur/ecg-pipeline';
const TUTORIAL_URL = 'https://github.com/data-coeur/ecg-pipeline#readme';
const CONTACT_EMAIL = 'contact@data-coeur.com';

interface Props {
  open: boolean;
  onClose: () => void;
  /** True when the modal opened because the drop exceeded the 100-ECG limit —
   *  shows an explanatory banner instead of jumping here with no context. */
  overLimit?: boolean;
}

export default function BatchConversionModal({ open, onClose, overLimit }: Props) {
  const { t } = useLanguage();
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/20 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="glass-card my-auto w-full max-w-md max-h-[90vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="mb-2 text-base font-semibold text-slate-700">
          {t('batch.title' as TranslationKey)}
        </h3>
        {overLimit && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs font-medium text-amber-700">
            {t('batch.overLimit' as TranslationKey)}
          </p>
        )}
        <p className="mb-5 text-sm text-slate-500">
          {t('batch.standard.subtitle' as TranslationKey)}
        </p>

        <div className="space-y-3">
          {/* Option 1: managed service */}
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Conversion ECG en lot — demande de prise en charge')}`}
            className="block rounded-xl border border-white/40 bg-white/60 p-4 transition-all hover:border-primary/40 hover:bg-white/80"
          >
            <div className="font-semibold text-sm text-slate-700">
              {t('batch.option1.title' as TranslationKey)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {t('batch.option1.desc' as TranslationKey)}
            </div>
          </a>

          {/* Option 2: self-hosted */}
          <div className="rounded-xl border border-white/40 bg-white/60 p-4">
            <div className="font-semibold text-sm text-slate-700">
              {t('batch.option2.title' as TranslationKey)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {t('batch.option2.desc' as TranslationKey)}
            </div>
            <div className="mt-3 flex gap-2">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 transition-all hover:border-primary/40 hover:text-primary"
              >
                {t('batch.option2.github' as TranslationKey)}
              </a>
              <a
                href={TUTORIAL_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 transition-all hover:border-primary/40 hover:text-primary"
              >
                {t('batch.option2.tutorial' as TranslationKey)}
              </a>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-300"
          >
            {t('batch.close' as TranslationKey)}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

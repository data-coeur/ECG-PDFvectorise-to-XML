import { createPortal } from 'react-dom';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

const GITHUB_REPO_URL = 'https://github.com/data-coeur/ecg-pipeline';
const TUTORIAL_URL = 'https://github.com/data-coeur/ecg-pipeline#readme';
const CONTACT_EMAIL = 'contact@data-coeur.com';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function BatchConversionModal({ open, onClose }: Props) {
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
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-base font-semibold text-slate-700">
            {t('batch.title' as TranslationKey)}
          </h3>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
            {t('batch.wipBadge' as TranslationKey)}
          </span>
        </div>
        <p className="mb-5 text-sm text-slate-500">
          {t('batch.subtitle' as TranslationKey)}
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

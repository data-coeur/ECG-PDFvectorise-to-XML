// UnsupportedFileModal — popup d'erreur quand le fichier déposé n'est pas
// un PDF vectorisé (raster, image, XML, DICOM, inconnu…). Le message
// affiché varie selon `kind`, et propose le bouton "Signaler" pour les cas
// bordure (pdf-multi, dicom…) où on aimerait élargir le support.
// Props : { open, onClose, kind, detail? }. Monté par App.tsx via setUnsupported().

import { createPortal } from 'react-dom';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { DetectedKind } from '../lib/file-detect';

interface Props {
  open: boolean;
  onClose: () => void;
  kind: DetectedKind;
  detail?: string;
}

const KIND_TO_BODY_KEY: Record<DetectedKind, TranslationKey> = {
  'pdf-vector': 'unsupported.unknown', // unreachable in practice
  'pdf-multi': 'unsupported.unknown',  // routed to BatchConversionModal in App
  'pdf-raster': 'unsupported.pdf-raster',
  'image': 'unsupported.image',
  'xml': 'unsupported.xml',
  'dicom': 'unsupported.dicom',
  'unknown': 'unsupported.unknown',
};

export default function UnsupportedFileModal({ open, onClose, kind, detail }: Props) {
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
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-5 w-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-700">
            {t('unsupported.title' as TranslationKey)}
          </h3>
        </div>

        <p className="mb-3 text-sm leading-relaxed text-slate-600">
          {t(KIND_TO_BODY_KEY[kind])}
        </p>

        {detail && (
          <p className="mb-3 text-xs italic text-slate-400">
            {t('unsupported.detected' as TranslationKey)} : {detail}
          </p>
        )}

        <p className="mb-5 rounded-lg bg-slate-50/80 p-3 text-xs leading-relaxed text-slate-500">
          {t('unsupported.accepted' as TranslationKey)}
        </p>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-300"
          >
            {t('unsupported.close' as TranslationKey)}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

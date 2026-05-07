// BatchConversionButton — bouton "Process full database" qui ouvre la modal
// expliquant comment traiter de gros volumes (managed service ou self-hosted).
// État local : un booléen `open` qui contrôle l'affichage de la modal.
// Utilisé par : App.tsx, juste au-dessus de la DropZone.
// Raison : router les utilisateurs ayant > 100 fichiers vers une voie dédiée.

import { useState } from 'react';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';
import BatchConversionModal from './BatchConversionModal';

export default function BatchConversionButton() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-primary/30 bg-primary/5 px-4 py-2 text-xs font-medium text-primary transition-all hover:border-primary/60 hover:bg-primary/10"
      >
        {t('batch.button' as TranslationKey)}
      </button>
      <BatchConversionModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

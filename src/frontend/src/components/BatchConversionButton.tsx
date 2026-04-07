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

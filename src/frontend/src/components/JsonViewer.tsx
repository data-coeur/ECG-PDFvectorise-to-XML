import { useState } from 'react';
import type { ECGData } from '../lib/types';
import { useLanguage } from '../i18n';

interface Props { data: ECGData }

export default function JsonViewer({ data }: Props) {
  const [visible, setVisible] = useState(false);
  const { t } = useLanguage();

  return (
    <>
      <div className="mt-3">
        <button
          className="rounded-lg border border-slate-200 bg-white/50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-primary/40 hover:text-primary"
          onClick={() => setVisible(v => !v)}
        >
          {t('btn.rawJson')}
        </button>
      </div>
      {visible && (
        <div className="mt-3 max-h-60 overflow-auto rounded-xl border border-white/40 bg-white/50 p-4 backdrop-blur-sm">
          <pre className="font-mono text-[11px] text-slate-500 whitespace-pre-wrap break-all">
            {JSON.stringify(data, null, 2).substring(0, 100000)}
          </pre>
        </div>
      )}
    </>
  );
}

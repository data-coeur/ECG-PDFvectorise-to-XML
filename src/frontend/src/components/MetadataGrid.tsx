import type { ECGData } from '../lib/types';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

interface Props { data: ECGData }

export default function MetadataGrid({ data }: Props) {
  const { t } = useLanguage();
  const items: [TranslationKey, string | number][] = [
    ['meta.manufacturer', data.manufacturer],
    ['meta.layout', data.layout],
    ['meta.channels', data.channels.length],
    ['meta.scale', `${data.scale.mm_per_s}mm/s · ${data.scale.mm_per_mV}mm/mV`],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-xl bg-white/50 border border-white/40 p-3 backdrop-blur-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 font-mono">{t(k)}</div>
          <div className="mt-0.5 text-sm font-medium text-slate-700">{v}</div>
        </div>
      ))}
    </div>
  );
}

import type { ECGData } from '../lib/types';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

interface Props { data: ECGData }

const ACCENT_COLORS = [
  'border-l-primary',
  'border-l-teal-400',
  'border-l-amber-400',
  'border-l-violet-400',
];

export default function MetadataGrid({ data }: Props) {
  const { t } = useLanguage();
  const items: [TranslationKey, string | number][] = [
    ['meta.manufacturer', data.manufacturer],
    ['meta.layout', t(`layout.${data.layout}` as TranslationKey) || data.layout],
    ['meta.channels', data.channels.length],
    ['meta.scale', `${data.scale.mm_per_s}mm/s · ${data.scale.mm_per_mV}mm/mV`],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([k, v], i) => (
        <div key={k} className={`rounded-lg border-l-[3px] ${ACCENT_COLORS[i]} bg-slate-50 px-3 py-2.5`}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 font-mono">{t(k)}</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{v}</div>
        </div>
      ))}
    </div>
  );
}

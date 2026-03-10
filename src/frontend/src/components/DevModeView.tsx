import { useMemo } from 'react';
import type { ECGData } from '../lib/types';
import { useLanguage } from '../i18n';
import PdfPreview from './PdfPreview';
import ECGChannels from './ECGChannels';
import MetadataGrid from './MetadataGrid';
import JsonViewer from './JsonViewer';

interface Props {
  ecgData: ECGData;
  file: File;
}

export default function DevModeView({ ecgData, file }: Props) {
  const { t } = useLanguage();

  const channelStats = useMemo(() =>
    ecgData.channels.map(ch => {
      let min = Infinity, max = -Infinity;
      for (const v of ch.samples) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return { name: ch.name, count: ch.samples.length, rate: ch.sample_rate_hz, duration: ch.duration_s, min, max };
    }),
  [ecgData.channels]);

  return (
    <div className="mt-5 space-y-5">
      {/* Two-column: PDF source vs extracted signals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="glass-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-600">{t('dev.pdfSource')}</h2>
          <PdfPreview file={file} />
        </div>
        <div className="glass-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-600">{t('dev.extractedSignals')}</h2>
          <ECGChannels channels={ecgData.channels} />
        </div>
      </div>

      {/* Extraction details */}
      <div className="glass-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-600">{t('dev.details')}</h2>
        <MetadataGrid data={ecgData} />

        {/* Page dimensions & scale */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-white/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">{t('dev.pageDimensions')}</div>
            <div className="mt-1 font-mono text-sm text-slate-700">{ecgData.page_size.width.toFixed(0)} × {ecgData.page_size.height.toFixed(0)} pts</div>
          </div>
          <div className="rounded-lg bg-white/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">pts/mm</div>
            <div className="mt-1 font-mono text-sm text-slate-700">{ecgData.scale.pts_per_mm.toFixed(2)}</div>
          </div>
          <div className="rounded-lg bg-white/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">mm/s</div>
            <div className="mt-1 font-mono text-sm text-slate-700">{ecgData.scale.mm_per_s}</div>
          </div>
          <div className="rounded-lg bg-white/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">mm/mV</div>
            <div className="mt-1 font-mono text-sm text-slate-700">{ecgData.scale.mm_per_mV}</div>
          </div>
        </div>

        {/* Per-channel stats table */}
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold text-slate-500">{t('dev.channelDetails')}</h3>
          <div className="overflow-x-auto rounded-lg border border-white/40">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/60 text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">{t('dev.samples')}</th>
                  <th className="px-3 py-2">Hz</th>
                  <th className="px-3 py-2">Duration (s)</th>
                  <th className="px-3 py-2">Min (mV)</th>
                  <th className="px-3 py-2">Max (mV)</th>
                </tr>
              </thead>
              <tbody>
                {channelStats.map(ch => (
                  <tr key={ch.name} className="border-t border-white/30 font-mono text-slate-600">
                    <td className="px-3 py-1.5 font-semibold text-ecg-trace">{ch.name}</td>
                    <td className="px-3 py-1.5">{ch.count}</td>
                    <td className="px-3 py-1.5">{ch.rate}</td>
                    <td className="px-3 py-1.5">{ch.duration.toFixed(2)}</td>
                    <td className="px-3 py-1.5">{ch.min.toFixed(3)}</td>
                    <td className="px-3 py-1.5">{ch.max.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <JsonViewer data={ecgData} />
      </div>
    </div>
  );
}

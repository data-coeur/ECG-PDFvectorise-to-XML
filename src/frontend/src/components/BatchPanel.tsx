import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { BatchItem } from '../lib/types';

const SECONDS_PER_FILE = 8;

interface Props {
  items: BatchItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onStop?: () => void;
}

export default function BatchPanel({ items, activeId, onSelect, onStop }: Props) {
  const { t } = useLanguage();
  if (items.length <= 1) return null;

  const doneCount = items.filter(i => i.status === 'done').length;
  const errorCount = items.filter(i => i.status === 'error').length;
  const remaining = items.filter(i => i.status === 'queued' || i.status === 'detecting' || i.status === 'extracting').length;
  const isRunning = remaining > 0;

  // Time estimate — shown when > 10 files and queue still running
  const showEstimate = items.length > 10 && isRunning;
  const estimateSec = remaining * SECONDS_PER_FILE;
  const estimateLabel = estimateSec >= 60
    ? `~${Math.ceil(estimateSec / 60)} min`
    : `~${estimateSec} s`;

  return (
    <div className="glass-card mt-3 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-600">
          {doneCount}/{items.length}
          {errorCount > 0 && <span className="ml-1 text-red-400">({errorCount} err)</span>}
        </span>
        {showEstimate && (
          <span className="text-[10px] text-slate-400">{estimateLabel}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isRunning && onStop && (
            <button
              onClick={onStop}
              className="rounded-lg border border-red-200 bg-red-50/60 px-2.5 py-1 text-[10px] font-medium text-red-500 transition-all hover:border-red-400 hover:bg-red-100"
            >
              {t('batch.stop' as TranslationKey)}
            </button>
          )}
          <ProgressDots items={items} />
        </div>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => item.status === 'done' && onSelect(item.id)}
            disabled={item.status !== 'done'}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-all ${
              item.id === activeId
                ? 'bg-primary/10 text-primary font-medium'
                : item.status === 'done'
                  ? 'text-slate-600 hover:bg-white/60'
                  : 'text-slate-400'
            }`}
          >
            <StatusIcon status={item.status} />
            <span className="truncate">{item.file.name}</span>
            {item.status === 'error' && item.error && (
              <span className="ml-auto shrink-0 text-[10px] text-red-400" title={item.error}>
                {item.error}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: BatchItem['status'] }) {
  switch (status) {
    case 'queued':
      return <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[8px] text-slate-400">&middot;</span>;
    case 'detecting':
    case 'extracting':
      return <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-primary" />;
    case 'done':
      return (
        <svg className="h-4 w-4 shrink-0 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'error':
      return (
        <svg className="h-4 w-4 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
  }
}

function ProgressDots({ items }: { items: BatchItem[] }) {
  // For large batches, show a compressed progress bar instead of individual dots
  if (items.length > 30) {
    const done = items.filter(i => i.status === 'done').length;
    const err = items.filter(i => i.status === 'error').length;
    const pctDone = (done / items.length) * 100;
    const pctErr = (err / items.length) * 100;
    return (
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
        <div className="flex h-full">
          <div className="bg-emerald-400 transition-all" style={{ width: `${pctDone}%` }} />
          <div className="bg-red-300 transition-all" style={{ width: `${pctErr}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-0.5">
      {items.map(item => (
        <div
          key={item.id}
          className={`h-1.5 w-1.5 rounded-full transition-colors ${
            item.status === 'done' ? 'bg-emerald-400'
            : item.status === 'error' ? 'bg-red-300'
            : item.status === 'extracting' || item.status === 'detecting' ? 'bg-primary animate-pulse'
            : 'bg-slate-200'
          }`}
        />
      ))}
    </div>
  );
}

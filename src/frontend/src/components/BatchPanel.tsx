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

  const hasError = items.some(i => i.status === 'error');
  const hasWarning = items.some(i => i.warning);
  const isMulti = items.length > 1;

  // Show the panel for batches, OR for a single file with error/warning
  if (!isMulti && !hasError && !hasWarning) return null;

  const doneCount = items.filter(i => i.status === 'done').length;
  const errorCount = items.filter(i => i.status === 'error').length;
  const remaining = items.filter(i => i.status === 'queued' || i.status === 'detecting' || i.status === 'extracting').length;
  const isRunning = remaining > 0;

  const showEstimate = items.length > 10 && isRunning;
  const estimateSec = remaining * SECONDS_PER_FILE;
  const estimateLabel = estimateSec >= 60 ? `~${Math.ceil(estimateSec / 60)} min` : `~${estimateSec} s`;

  return (
    <div className="mt-3 space-y-2">
      {/* Error banner — prominent, always visible when an item failed */}
      {items.filter(i => i.status === 'error').map(item => (
        <div key={item.id} className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 p-3">
          <svg className="h-4 w-4 shrink-0 mt-0.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <div className="min-w-0">
            <p className="text-xs font-medium text-red-600 truncate">{item.file.name}</p>
            <p className="text-[11px] text-red-500 mt-0.5">{item.error}</p>
          </div>
        </div>
      ))}

      {/* Warning banner — for multi-page PDFs, etc. */}
      {items.filter(i => i.warning && i.status === 'done').map(item => (
        <div key={item.id} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <svg className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="min-w-0">
            <p className="text-xs font-medium text-amber-700 truncate">{item.file.name}</p>
            <p className="text-[11px] text-amber-600 mt-0.5">{item.warning}</p>
          </div>
        </div>
      ))}

      {/* Batch list — only for multi-file drops */}
      {isMulti && (
        <div className="glass-card p-3">
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
                {item.warning && item.status === 'done' && (
                  <span className="ml-auto shrink-0 text-[10px] text-amber-500">⚠</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
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

import type { ECGData } from '../lib/types';

interface Props { data: ECGData }

export default function JsonViewer({ data }: Props) {
  return (
    <div className="mt-3 max-h-60 overflow-auto rounded-xl border border-white/40 bg-white/50 p-4 backdrop-blur-sm">
      <pre className="font-mono text-[11px] text-slate-500 whitespace-pre-wrap break-all">
        {JSON.stringify(data, null, 2).substring(0, 100000)}
      </pre>
    </div>
  );
}

interface Props {
  message: string;
  type?: '' | 'ok' | 'err';
  loading?: boolean;
}

export default function StatusBar({ message, type = '', loading }: Props) {
  if (!message && !loading) return <div className="min-h-[1.4rem]" />;

  const colorClass = type === 'ok' ? 'text-emerald-600' : type === 'err' ? 'text-red-500' : '';

  // For success messages with · separators, render as styled tags
  if (type === 'ok' && message.includes('·')) {
    const parts = message.split('·').map(s => s.trim());
    return (
      <div className="min-h-[1.4rem] flex flex-wrap items-center gap-1.5">
        {parts.map((part, i) => (
          <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-emerald-600">
            {part}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-[1.4rem] font-mono text-xs text-slate-500">
      {loading && (
        <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary align-middle" />
      )}
      <span className={colorClass}>{message}</span>
    </div>
  );
}

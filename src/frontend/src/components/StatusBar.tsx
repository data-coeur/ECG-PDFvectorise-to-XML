interface Props {
  message: string;
  type?: '' | 'ok' | 'err';
  loading?: boolean;
}

export default function StatusBar({ message, type = '', loading }: Props) {
  if (!message && !loading) return <div className="min-h-[1.4rem]" />;
  return (
    <div className="min-h-[1.4rem] font-mono text-xs text-slate-500">
      {loading && (
        <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary align-middle" />
      )}
      <span className={type === 'ok' ? 'text-emerald-600' : type === 'err' ? 'text-red-500' : ''}>
        {message}
      </span>
    </div>
  );
}

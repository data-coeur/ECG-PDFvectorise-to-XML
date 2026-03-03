interface Props {
  message: string;
  type?: '' | 'ok' | 'err';
  loading?: boolean;
}

export default function StatusBar({ message, type = '', loading }: Props) {
  if (!message && !loading) return <div className="st" />;
  return (
    <div className="st">
      {loading && <span className="sp" />}
      <span className={type}>{message}</span>
    </div>
  );
}

import { useRef, useState, useCallback } from 'react';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export default function DropZone({ onFile, disabled }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith('.pdf')) return;
    onFile(f);
  }, [onFile]);

  return (
    <div
      className={`dz${over ? ' over' : ''}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); setOver(false);
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="ic">📄</div>
      <div className="lb">Glissez un PDF ECG ici ou cliquez</div>
      <div className="sub">PDF vectorisé de n'importe quel fabricant ECG</div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.PDF"
        style={{ display: 'none' }}
        onChange={e => e.target.files?.length && handleFile(e.target.files[0])}
      />
    </div>
  );
}

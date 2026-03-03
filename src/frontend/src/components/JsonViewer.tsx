import { useState } from 'react';
import type { ECGData } from '../lib/types';

interface Props { data: ECGData }

export default function JsonViewer({ data }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <div className="bg">
        <button className="btn" onClick={() => setVisible(v => !v)}>JSON brut</button>
      </div>
      {visible && (
        <div className="jp">
          <pre>{JSON.stringify(data, null, 2).substring(0, 100000)}</pre>
        </div>
      )}
    </>
  );
}

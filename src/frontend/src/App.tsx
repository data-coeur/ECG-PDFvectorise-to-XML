import { useState, useCallback } from 'react';
import type { ECGData, ServerResponse } from './lib/types';
import { extractFromPdf } from './lib/ecg-extract';
import DropZone from './components/DropZone';
import StatusBar from './components/StatusBar';
import MetadataGrid from './components/MetadataGrid';
import ECGChannels from './components/ECGChannels';
import DownloadArea from './components/DownloadArea';
import JsonViewer from './components/JsonViewer';

const API_URL = '/api/ecg/receive';
const DATA_URL = '/api/ecg/data/';

export default function App() {
  const [ecgData, setEcgData] = useState<ECGData | null>(null);
  const [serverResp, setServerResp] = useState<ServerResponse | null>(null);
  const [status, setStatus] = useState({ msg: '', type: '' as '' | 'ok' | 'err', loading: false });

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setStatus({ msg: 'Non-PDF', type: 'err', loading: false });
      return;
    }
    setStatus({ msg: 'Extraction...', type: '', loading: true });
    setEcgData(null);
    setServerResp(null);
    try {
      const result = await extractFromPdf(file);
      if (!result || !result.channels.length) {
        setStatus({ msg: 'Aucun signal ECG vectoriel', type: 'err', loading: false });
        return;
      }
      setEcgData(result);
      setStatus({ msg: `${result.channels.length} canaux · ${result.manufacturer} · ${result.layout}`, type: 'ok', loading: false });
    } catch (e) {
      setStatus({ msg: (e as Error).message, type: 'err', loading: false });
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (!ecgData) return;
    setStatus({ msg: 'Envoi et conversion...', type: '', loading: true });
    setServerResp(null);
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ecgData),
      });
      if (!r.ok) { setStatus({ msg: `Erreur ${r.status} ${r.statusText}`, type: 'err', loading: false }); return; }
      const j: ServerResponse = await r.json();
      if (!j.success) { setStatus({ msg: j.error || 'Erreur serveur', type: 'err', loading: false }); return; }
      setServerResp(j);
      setStatus({
        msg: `${Object.keys(j.files!).length} formats générés · ${j.info!.channels} canaux · ${j.info!.sample_rate} Hz · ${j.info!.duration}s`,
        type: 'ok', loading: false,
      });
    } catch (e) {
      setStatus({ msg: (e as Error).message, type: 'err', loading: false });
    }
  }, [ecgData]);

  const handleDownloadJson = useCallback(() => {
    if (!ecgData) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(ecgData, null, 2)], { type: 'application/json' }));
    a.download = `ecg_${Date.now()}.json`;
    a.click();
  }, [ecgData]);

  return (
    <>
      <div className="hdr">
        <h1>⚡ ECG PDF → Signal Numérique</h1>
        <p>Extraction vectorielle · Schiller, GE MUSE, Philips et autres</p>
      </div>
      <div className="c">
        <DropZone onFile={handleFile} disabled={status.loading} />
        <div className="actions">
          <button className="btn p" disabled={!ecgData || status.loading} onClick={handleSend}>📤 Envoyer au serveur</button>
          <button className="btn" disabled={!ecgData} onClick={handleDownloadJson}>⬇ JSON local</button>
        </div>
        <StatusBar message={status.msg} type={status.type} loading={status.loading} />

        {serverResp?.files && <DownloadArea response={serverResp} dataUrl={DATA_URL} />}

        {ecgData && (
          <div className="res">
            <h2>Signaux extraits</h2>
            <MetadataGrid data={ecgData} />
            <ECGChannels channels={ecgData.channels} />
            <JsonViewer data={ecgData} />
          </div>
        )}
      </div>
    </>
  );
}

import type { ServerResponse, FormatInfo } from '../lib/types';

const FORMAT_INFO: Record<string, FormatInfo> = {
  edf: { label: 'EDF+', badge: 'std', badgeText: 'Standard', desc: 'European Data Format — Standard ouvert pour les signaux physiologiques. Lisible par EDFbrowser, Polyman, MATLAB, Python (pyedflib).' },
  wfdb_hea: { label: 'WFDB', badge: 'std', badgeText: 'PhysioNet', desc: 'WaveForm DataBase — Format de PhysioNet (MIT). Fichier .hea + .dat. Standard de référence pour la recherche en cardiologie.' },
  dicom: { label: 'DICOM', badge: 'med', badgeText: 'Médical', desc: 'DICOM Waveform — Format standard hospitalier pour l\'imagerie et les signaux médicaux. Compatible PACS.' },
  hdf5: { label: 'HDF5', badge: 'std', badgeText: 'Scientifique', desc: 'Hierarchical Data Format v5 — Format binaire haute performance. Utilisé par la NASA, le CERN, et en deep learning.' },
  webp: { label: 'WebP 4K', badge: 'img', badgeText: 'Image', desc: 'Image 4K (3840x2160) avec grille ECG standard, pulse de calibration 1mV/200ms et labels.' },
  hl7aecg: { label: 'HL7 aECG', badge: 'med', badgeText: 'FDA/HL7', desc: 'HL7 Annotated ECG (aECG) XML — Format FDA pour la soumission réglementaire. Compatible avec les systèmes HL7 v3.' },
};

const ORDER = ['edf', 'wfdb_hea', 'dicom', 'hl7aecg', 'hdf5', 'webp'];

interface Props { response: ServerResponse; dataUrl: string }

export default function DownloadArea({ response, dataUrl }: Props) {
  if (!response.files) return null;
  return (
    <div className="dl-area">
      <h3>📦 Fichiers générés — cliquez pour télécharger</h3>
      <div className="dl-grid">
        {ORDER.map(key => {
          const file = response.files![key];
          if (!file) return null;
          const info = FORMAT_INFO[key] || { label: key, desc: '', badge: 'std' as const, badgeText: '?' };
          const href = dataUrl + file;
          const ext = file.split('.').pop();
          const badgeCls = info.badge === 'med' ? 'badge-med' : info.badge === 'img' ? 'badge-img' : 'badge-std';

          return (
            <a key={key} className="dl-card" href={href} download={file}>
              <span className={`badge ${badgeCls}`}>{info.badgeText}</span>
              <div className="fmt">{info.label}</div>
              <div className="desc">{info.desc}</div>
              <div className="ext">.{ext}</div>
              {key === 'wfdb_hea' && response.files!.wfdb_dat && (
                <div className="ext">📎 aussi : <a href={dataUrl + response.files!.wfdb_dat} style={{ color: 'var(--ac)' }}>.dat</a></div>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

import type { ServerResponse } from '../lib/types';
import { useLanguage } from '../i18n';
import type { TranslationKey } from '../i18n';

interface FmtDef {
  label: string;
  badge: 'std' | 'med' | 'img';
  badgeKey: TranslationKey;
  descKey: TranslationKey;
}

const FORMAT_INFO: Record<string, FmtDef> = {
  edf: { label: 'EDF+', badge: 'std', badgeKey: 'dl.badge.std', descKey: 'dl.edf.desc' },
  wfdb_hea: { label: 'WFDB', badge: 'std', badgeKey: 'dl.badge.physionet', descKey: 'dl.wfdb.desc' },
  dicom: { label: 'DICOM', badge: 'med', badgeKey: 'dl.badge.medical', descKey: 'dl.dicom.desc' },
  hl7aecg: { label: 'HL7 aECG', badge: 'med', badgeKey: 'dl.badge.fda', descKey: 'dl.hl7.desc' },
  hdf5: { label: 'HDF5', badge: 'std', badgeKey: 'dl.badge.scientific', descKey: 'dl.hdf5.desc' },
  webp: { label: 'WebP 4K', badge: 'img', badgeKey: 'dl.badge.image', descKey: 'dl.webp.desc' },
};

const ORDER = ['edf', 'wfdb_hea', 'dicom', 'hl7aecg', 'hdf5', 'webp'];

const BADGE_STYLES: Record<string, string> = {
  std: 'bg-primary/10 text-primary',
  med: 'bg-amber-100 text-amber-700',
  img: 'bg-emerald-100 text-emerald-700',
};

interface Props { response: ServerResponse; dataUrl: string }

export default function DownloadArea({ response, dataUrl }: Props) {
  const { t } = useLanguage();
  if (!response.files) return null;

  return (
    <div className="glass-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-600">{t('dl.title')}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map(key => {
          const file = response.files![key];
          if (!file) return null;
          const info = FORMAT_INFO[key];
          if (!info) return null;
          const href = dataUrl + file;
          const ext = file.split('.').pop();

          return (
            <a
              key={key}
              className="group relative block rounded-xl border border-white/40 bg-white/50 p-4 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              href={href}
              download={file}
            >
              <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE_STYLES[info.badge]}`}>
                {t(info.badgeKey)}
              </span>
              <div className="font-mono text-base font-semibold text-ecg-trace">{info.label}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 pr-12">{t(info.descKey)}</div>
              <div className="mt-2 font-mono text-[11px] text-primary/60">.{ext}</div>
              {key === 'wfdb_hea' && response.files!.wfdb_dat && (
                <div className="mt-1 font-mono text-[11px] text-primary/60">
                  + <a href={dataUrl + response.files!.wfdb_dat} className="underline hover:text-primary">.dat</a>
                </div>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

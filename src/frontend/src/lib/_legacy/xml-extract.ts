/**
 * XML ECG extraction — sends XML to backend for parsing via ecg-datakit (Python).
 *
 * ecg-datakit handles all proprietary formats and compressions:
 *   Philips Sierra (XLI), GE MUSE, HL7 aECG, Mortara, Mindray, GE MAC, etc.
 *
 * Anonymization remains 100% browser-side (see xml-anonymize.ts).
 */

import type { ECGData } from '../types';

/**
 * Send XML file to backend for parsing via ecg-datakit (Python).
 * Returns full ECGData with complete signal (10s+, all leads).
 */
export async function parseXmlViaBackend(file: File): Promise<ECGData> {
  const buf = await file.arrayBuffer();
  const resp = await fetch('/api/ecg/parse-xml', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': file.name,
    },
    body: buf,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || `Server error: ${resp.status}`);
  }
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data as ECGData;
}

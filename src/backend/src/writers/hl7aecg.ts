// hl7aecg — sérialise les canaux ECG en XML "HL7 Annotated ECG (aECG)"
// Conforme au format de référence LIRYC-IHU / ECGToolkit (C# Mono).
// Structure validée sur hl7aecg_example.xml (LIRYC-IHU/hl7v3-aecg).
// Appelé par routes/convert.

import fs from 'fs';

interface Channel { name: string; duration_s: number; sample_rate_hz: number }

const HL7_NS  = 'urn:hl7-org:v3';
const VOC_NS  = 'urn:hl7-org:v3/voc';
const XSI_NS  = 'http://www.w3.org/2001/XMLSchema-instance';

// Standard 12-lead MDC codes
const LEAD_CODES: Record<string, string> = {
  I:   'MDC_ECG_LEAD_I',
  II:  'MDC_ECG_LEAD_II',
  III: 'MDC_ECG_LEAD_III',
  aVR: 'MDC_ECG_LEAD_AVR',
  aVL: 'MDC_ECG_LEAD_AVL',
  aVF: 'MDC_ECG_LEAD_AVF',
  V1:  'MDC_ECG_LEAD_V1',
  V2:  'MDC_ECG_LEAD_V2',
  V3:  'MDC_ECG_LEAD_V3',
  V4:  'MDC_ECG_LEAD_V4',
  V5:  'MDC_ECG_LEAD_V5',
  V6:  'MDC_ECG_LEAD_V6',
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateUid(): string {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 1e9);
  // OID-safe: only digits and dots
  return `2.16.840.1.113883.3.${now}.${rand}`;
}

function toHL7Time(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
         `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function writeHL7aECG(
  channels: Channel[],
  resampled: number[][],
  sampleCount: number,
  sampleRate: number,
  duration: number,
  filename: string,
  meta?: { manufacturer?: string; layout?: string },
): void {
  const now    = new Date();
  const end    = new Date(now.getTime() + duration * 1000);
  const uid    = generateUid();
  const tLow   = toHL7Time(now);
  const tHigh  = toHL7Time(end);
  const incr   = (1 / sampleRate).toFixed(8);  // e.g. "0.01000000" at 100 Hz
  const mfr    = escapeXml(meta?.manufacturer || 'Cardio Capture');

  // Scale factor: encode samples as integers in uV, scale=5 uV/digit (same as LIRYC example)
  const SCALE_UV = 5;

  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w('<?xml version="1.0" encoding="UTF-8"?>');
  w(`<AnnotatedECG xmlns="${HL7_NS}" xmlns:voc="${VOC_NS}" xmlns:xsi="${XSI_NS}"` +
    ` xsi:schemaLocation="${HL7_NS}" classCode="OBS" moodCode="EVN" type="Observation">`);

  // Document identifiers
  w(`  <id root="${uid}"/>`);
  w(`  <code code="93000" codeSystem="2.16.840.1.113883.6.12" codeSystemName="CPT-4"/>`);
  w(`  <effectiveTime>`);
  w(`    <low value="${tLow}"/>`);
  w(`    <high value="${tHigh}"/>`);
  w(`  </effectiveTime>`);
  w(`  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>`);

  // Subject (anonymous)
  w(`  <componentOf>`);
  w(`    <timepointEvent>`);
  w(`      <componentOf>`);
  w(`        <subjectAssignment>`);
  w(`          <subject>`);
  w(`            <trialSubject>`);
  w(`              <subjectDemographicPerson>`);
  w(`                <name><given>Anonymous</given><family>Patient</family></name>`);
  w(`                <administrativeGenderCode code="UN" codeSystem="2.16.840.1.113883.5.1"/>`);
  w(`                <birthTime value=""/>`);
  w(`              </subjectDemographicPerson>`);
  w(`            </trialSubject>`);
  w(`          </subject>`);
  w(`        </subjectAssignment>`);
  w(`      </componentOf>`);
  w(`    </timepointEvent>`);
  w(`  </componentOf>`);

  // Component > series
  w(`  <component>`);
  w(`    <series classCode="OBSSER" moodCode="EVN">`);
  w(`      <id root="${uid}"/>`);
  w(`      <code code="RHYTHM" codeSystem="2.16.840.1.113883.5.4" codeSystemName="ActCode" displayName="Rhythm Waveforms"/>`);
  w(`      <effectiveTime>`);
  w(`        <low value="${tLow}" inclusive="true"/>`);
  w(`        <high value="${tHigh}" inclusive="false"/>`);
  w(`      </effectiveTime>`);

  // Author device
  w(`      <author>`);
  w(`        <seriesAuthor>`);
  w(`          <manufacturedSeriesDevice>`);
  w(`            <manufacturerModelName>${mfr}</manufacturerModelName>`);
  w(`          </manufacturedSeriesDevice>`);
  w(`          <manufacturerOrganization>`);
  w(`            <name>${mfr}</name>`);
  w(`          </manufacturerOrganization>`);
  w(`        </seriesAuthor>`);
  w(`      </author>`);

  // sequenceSet
  w(`      <component>`);
  w(`        <sequenceSet>`);

  // Time axis — GLIST_TS (not GLIST_PQ) as per LIRYC reference
  w(`          <component>`);
  w(`            <sequence>`);
  w(`              <code code="TIME_ABSOLUTE" codeSystem="2.16.840.1.113883.5.4" codeSystemName="ActCode"/>`);
  w(`              <value xsi:type="GLIST_TS">`);
  w(`                <head value="${tLow}" unit="s"/>`);
  w(`                <increment value="${incr}" unit="s"/>`);
  w(`              </value>`);
  w(`            </sequence>`);
  w(`          </component>`);

  // One component per lead
  for (let i = 0; i < channels.length; i++) {
    const ch       = channels[i];
    const leadName = ch.name.replace(/_rhythm$/, '');
    const code     = LEAD_CODES[leadName] ?? `MDC_ECG_LEAD_${leadName.toUpperCase()}`;
    const samples  = resampled[i];

    // Convert mV → scaled integers (uV / SCALE_UV)
    const digits = new Array<number>(sampleCount);
    for (let j = 0; j < sampleCount; j++) {
      digits[j] = Math.round((samples[j] ?? 0) * 1000 / SCALE_UV);
    }

    w(`          <component>`);
    w(`            <sequence>`);
    w(`              <code code="${code}" codeSystem="2.16.840.1.113883.6.24" codeSystemName="MDC"/>`);
    w(`              <value xsi:type="SLIST_PQ">`);
    w(`                <origin value="0" unit="uV"/>`);
    w(`                <scale value="${SCALE_UV}" unit="uV"/>`);
    w(`                <digits>${digits.join(' ')}</digits>`);
    w(`              </value>`);
    w(`            </sequence>`);
    w(`          </component>`);
  }

  w(`        </sequenceSet>`);
  w(`      </component>`);
  w(`    </series>`);
  w(`  </component>`);
  w(`</AnnotatedECG>`);

  fs.writeFileSync(filename, lines.join('\n'), 'utf-8');
}

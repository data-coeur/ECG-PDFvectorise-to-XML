// hl7aecg — sérialise les canaux ECG en XML "HL7 Annotated ECG (aECG)" R1
// DSTU 2004, le format FDA de référence pour les ECGs cliniques.
// Lead codes MDC, samples encodés en microvolts (entiers) sous SLIST_PQ.
// Patient anonymisé. Appelé par routes/convert.

import fs from 'fs';

interface Channel { name: string; duration_s: number; sample_rate_hz: number }

const HL7_NS = 'urn:hl7-org:v3';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const SCHEMA_LOC = 'urn:hl7-org:v3 multicacheschemas/POCD_MT040101.xsd';

// Standard 12-lead ECG codes (MDC / HL7 aECG lead codes)
const LEAD_CODES: Record<string, { code: string; displayName: string }> = {
  I:   { code: 'MDC_ECG_LEAD_I',   displayName: 'Lead I' },
  II:  { code: 'MDC_ECG_LEAD_II',  displayName: 'Lead II' },
  III: { code: 'MDC_ECG_LEAD_III', displayName: 'Lead III' },
  aVR: { code: 'MDC_ECG_LEAD_AVR', displayName: 'Lead aVR' },
  aVL: { code: 'MDC_ECG_LEAD_AVL', displayName: 'Lead aVL' },
  aVF: { code: 'MDC_ECG_LEAD_AVF', displayName: 'Lead aVF' },
  V1:  { code: 'MDC_ECG_LEAD_V1',  displayName: 'Lead V1' },
  V2:  { code: 'MDC_ECG_LEAD_V2',  displayName: 'Lead V2' },
  V3:  { code: 'MDC_ECG_LEAD_V3',  displayName: 'Lead V3' },
  V4:  { code: 'MDC_ECG_LEAD_V4',  displayName: 'Lead V4' },
  V5:  { code: 'MDC_ECG_LEAD_V5',  displayName: 'Lead V5' },
  V6:  { code: 'MDC_ECG_LEAD_V6',  displayName: 'Lead V6' },
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateUid(): string {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 1e9);
  return `2.16.840.1.113883.3.${now}.${rand}`;
}

function toHL7Time(date: Date): string {
  const padZero = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${padZero(date.getMonth() + 1)}${padZero(date.getDate())}${padZero(date.getHours())}${padZero(date.getMinutes())}${padZero(date.getSeconds())}`;
}

export function writeHL7aECG(
  channels: Channel[],
  resampled: number[][],
  sampleCount: number,
  sampleRate: number,
  _duration: number,
  filename: string,
  meta?: { manufacturer?: string; layout?: string },
): void {
  const now = new Date();
  const docId = generateUid();
  const seriesId = generateUid();
  const timeStr = toHL7Time(now);

  const lines: string[] = [];
  const writeLine = (s: string) => lines.push(s);

  writeLine('<?xml version="1.0" encoding="UTF-8"?>');
  writeLine(`<AnnotatedECG xmlns="${HL7_NS}" xmlns:xsi="${XSI_NS}" xsi:schemaLocation="${SCHEMA_LOC}"` +
    ` classCode="OBS" moodCode="EVN">`);

  // Document ID
  writeLine(`  <id root="${escapeXml(docId)}"/>`);
  writeLine(`  <code code="93000" codeSystem="2.16.840.1.113883.6.12" codeSystemName="CPT4" displayName="Electrocardiogram"/>`);
  writeLine(`  <effectiveTime><low value="${timeStr}"/><high value="${timeStr}"/></effectiveTime>`);

  // Confidentiality
  writeLine('  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>');

  // Subject (anonymous)
  writeLine('  <subject typeCode="SBJ">');
  writeLine('    <trialSubject classCode="RESBJ">');
  writeLine('      <id extension="ANONYMOUS" root="2.16.840.1.113883.3.0"/>');
  writeLine('      <subjectDemographicPerson classCode="PSN" determinerCode="INSTANCE">');
  writeLine('        <name><given>Anonymous</given><family>Patient</family></name>');
  writeLine('      </subjectDemographicPerson>');
  writeLine('    </trialSubject>');
  writeLine('  </subject>');

  // Component — series
  writeLine('  <component typeCode="COMP">');
  writeLine('    <series classCode="OBSSER" moodCode="EVN">');
  writeLine(`      <id root="${escapeXml(seriesId)}"/>`);
  writeLine('      <code code="RHYTHM" codeSystem="2.16.840.1.113883.6.24" codeSystemName="MDC" displayName="Rhythm"/>');
  writeLine(`      <effectiveTime><low value="${timeStr}"/><high value="${timeStr}"/></effectiveTime>`);

  // Author device
  writeLine('      <author typeCode="AUT">');
  writeLine('        <seriesAuthor classCode="ASSIGNED">');
  writeLine('          <assignedAuthorChoice classCode="DEV" determinerCode="INSTANCE">');
  if (meta?.manufacturer) {
    writeLine(`            <manufacturerModelName>${escapeXml(meta.manufacturer)}</manufacturerModelName>`);
  }
  writeLine('            <playedManufacturedDevice classCode="MANU">');
  writeLine('              <manufacturerOrganization classCode="ORG" determinerCode="INSTANCE">');
  writeLine(`                <name>${escapeXml(meta?.manufacturer || 'Unknown')}</name>`);
  writeLine('              </manufacturerOrganization>');
  writeLine('            </playedManufacturedDevice>');
  writeLine('          </assignedAuthorChoice>');
  writeLine('        </seriesAuthor>');
  writeLine('      </author>');

  // Sequence set — one sequenceSet containing all leads
  writeLine('      <component typeCode="COMP">');
  writeLine('        <sequenceSet classCode="OBS" moodCode="EVN">');

  // Time axis component (shared across all leads)
  writeLine('          <component typeCode="COMP">');
  writeLine('            <sequence classCode="OBS" moodCode="EVN">');
  writeLine('              <code code="TIME_ABSOLUTE" codeSystem="2.16.840.1.113883.6.24" codeSystemName="MDC"/>');
  writeLine(`              <value xsi:type="GLIST_PQ">`);
  writeLine(`                <head value="0" unit="s"/>`);
  writeLine(`                <increment value="${(1 / sampleRate).toFixed(8)}" unit="s"/>`);
  writeLine(`              </value>`);
  writeLine('            </sequence>');
  writeLine('          </component>');

  // Each lead as a component/sequence
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const leadName = ch.name.replace(/_rhythm$/, '');
    const leadInfo = LEAD_CODES[leadName] || { code: `MDC_ECG_LEAD_${leadName.toUpperCase()}`, displayName: `Lead ${ch.name}` };

    // Encode samples: scale mV to microvolts (uV) as integers for compactness
    const samples = resampled[i];
    const digits = new Array(sampleCount);
    for (let j = 0; j < sampleCount; j++) {
      digits[j] = Math.round(samples[j] * 1000); // mV -> uV
    }

    writeLine('          <component typeCode="COMP">');
    writeLine('            <sequence classCode="OBS" moodCode="EVN">');
    writeLine(`              <code code="${escapeXml(leadInfo.code)}" codeSystem="2.16.840.1.113883.6.24" codeSystemName="MDC" displayName="${escapeXml(leadInfo.displayName)}"/>`);
    writeLine(`              <value xsi:type="SLIST_PQ">`);
    writeLine(`                <origin value="0" unit="uV"/>`);
    writeLine(`                <scale value="1" unit="uV"/>`);
    writeLine(`                <digits>${digits.join(' ')}</digits>`);
    writeLine(`              </value>`);
    writeLine('            </sequence>');
    writeLine('          </component>');
  }

  // Close sequenceSet, component, series, component, root
  writeLine('        </sequenceSet>');
  writeLine('      </component>');
  writeLine('    </series>');
  writeLine('  </component>');
  writeLine('</AnnotatedECG>');

  fs.writeFileSync(filename, lines.join('\n'), 'utf-8');
}

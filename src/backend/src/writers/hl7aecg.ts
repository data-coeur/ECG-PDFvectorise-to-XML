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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uid(): string {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 1e9);
  return `2.16.840.1.113883.3.${now}.${rand}`;
}

function toHL7Time(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Write HL7 aECG (Annotated ECG) XML — FDA-compliant format per HL7 aECG Implementation Guide.
 * Reference: HL7 Annotated ECG (aECG) R1 DSTU (2004).
 */
export function writeHL7aECG(
  channels: Channel[], resampled: number[][], nSamples: number,
  sr: number, dur: number, filename: string,
  meta?: { manufacturer?: string; layout?: string },
): void {
  const now = new Date();
  const docId = uid();
  const seriesId = uid();
  const timeStr = toHL7Time(now);

  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w('<?xml version="1.0" encoding="UTF-8"?>');
  w(`<AnnotatedECG xmlns="${HL7_NS}" xmlns:xsi="${XSI_NS}" xsi:schemaLocation="${SCHEMA_LOC}"` +
    ` classCode="OBS" moodCode="EVN">`);

  // Document ID
  w(`  <id root="${esc(docId)}"/>`);
  w(`  <code code="93000" codeSystem="2.16.840.1.113883.6.12" codeSystemName="CPT4" displayName="Electrocardiogram"/>`);
  w(`  <effectiveTime><low value="${timeStr}"/><high value="${timeStr}"/></effectiveTime>`);

  // Confidentiality
  w('  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>');

  // Subject (anonymous)
  w('  <subject typeCode="SBJ">');
  w('    <trialSubject classCode="RESBJ">');
  w('      <id extension="ANONYMOUS" root="2.16.840.1.113883.3.0"/>');
  w('      <subjectDemographicPerson classCode="PSN" determinerCode="INSTANCE">');
  w('        <name><given>Anonymous</given><family>Patient</family></name>');
  w('      </subjectDemographicPerson>');
  w('    </trialSubject>');
  w('  </subject>');

  // Component — series
  w('  <component typeCode="COMP">');
  w('    <series classCode="OBSSER" moodCode="EVN">');
  w(`      <id root="${esc(seriesId)}"/>`);
  w('      <code code="RHYTHM" codeSystem="2.16.840.1.113883.6.24" codeSystemName="MDC" displayName="Rhythm"/>');
  w(`      <effectiveTime><low value="${timeStr}"/><high value="${timeStr}"/></effectiveTime>`);

  // Author device
  w('      <author typeCode="AUT">');
  w('        <seriesAuthor classCode="ASSIGNED">');
  w('          <assignedAuthorChoice classCode="DEV" determinerCode="INSTANCE">');
  if (meta?.manufacturer) {
    w(`            <manufacturerModelName>${esc(meta.manufacturer)}</manufacturerModelName>`);
  }
  w('            <playedManufacturedDevice classCode="MANU">');
  w('              <manufacturerOrganization classCode="ORG" determinerCode="INSTANCE">');
  w(`                <name>${esc(meta?.manufacturer || 'Unknown')}</name>`);
  w('              </manufacturerOrganization>');
  w('            </playedManufacturedDevice>');
  w('          </assignedAuthorChoice>');
  w('        </seriesAuthor>');
  w('      </author>');

  // Sequence set — one sequenceSet containing all leads
  w('      <component typeCode="COMP">');
  w('        <sequenceSet classCode="OBS" moodCode="EVN">');

  // Time axis component (shared across all leads)
  w('          <component typeCode="COMP">');
  w('            <sequence classCode="OBS" moodCode="EVN">');
  w('              <code code="TIME_ABSOLUTE" codeSystem="2.16.840.1.113883.6.24" codeSystemName="MDC"/>');
  w(`              <value xsi:type="GLIST_PQ">`);
  w(`                <head value="0" unit="s"/>`);
  w(`                <increment value="${(1 / sr).toFixed(8)}" unit="s"/>`);
  w(`              </value>`);
  w('            </sequence>');
  w('          </component>');

  // Each lead as a component/sequence
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const leadName = ch.name.replace(/_rhythm$/, '');
    const leadInfo = LEAD_CODES[leadName] || { code: `MDC_ECG_LEAD_${leadName.toUpperCase()}`, displayName: `Lead ${ch.name}` };

    // Encode samples: scale mV to microvolts (uV) as integers for compactness
    const samples = resampled[i];
    const digits = new Array(nSamples);
    for (let j = 0; j < nSamples; j++) {
      digits[j] = Math.round(samples[j] * 1000); // mV -> uV
    }

    w('          <component typeCode="COMP">');
    w('            <sequence classCode="OBS" moodCode="EVN">');
    w(`              <code code="${esc(leadInfo.code)}" codeSystem="2.16.840.1.113883.6.24" codeSystemName="MDC" displayName="${esc(leadInfo.displayName)}"/>`);
    w(`              <value xsi:type="SLIST_PQ">`);
    w(`                <origin value="0" unit="uV"/>`);
    w(`                <scale value="1" unit="uV"/>`);
    w(`                <digits>${digits.join(' ')}</digits>`);
    w(`              </value>`);
    w('            </sequence>');
    w('          </component>');
  }

  // Close sequenceSet, component, series, component, root
  w('        </sequenceSet>');
  w('      </component>');
  w('    </series>');
  w('  </component>');
  w('</AnnotatedECG>');

  fs.writeFileSync(filename, lines.join('\n'), 'utf-8');
}

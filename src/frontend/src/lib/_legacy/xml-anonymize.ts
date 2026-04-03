/**
 * Client-side XML ECG anonymization — strips patient data from XML.
 *
 * Two modes:
 *   "smart" — Remove patient-identifying nodes, keep ECG measurements & waveforms
 *   "full"  — Remove ALL non-waveform content (strip everything except signal data)
 */

import type { AnonMode } from '../pdf-anonymize';

/* ------------------------------------------------------------------ */
/*  Patient data tag names (case-insensitive matching)                  */
/* ------------------------------------------------------------------ */

const PATIENT_TAGS = new Set([
  // Common across formats
  'patient', 'patientid', 'uniquepatientid', 'patientlastname', 'patientfirstname',
  'name', 'lastname', 'firstname', 'middlename', 'dateofbirth', 'age', 'sex', 'gender',
  'height', 'weight', 'race', 'ethnicity', 'pacestatus',
  // Philips Sierra
  'generalpatientdata', 'patientmedicaldata', 'bloodpressure',
  // Acquirer / location info (identifying)
  'acquirer', 'operator', 'room', 'departmentid', 'departmentname',
  'institutionid', 'institutionname', 'facilityid', 'facilityname',
  // Order info
  'orderinfo', 'ordernumber', 'uniqueorderid', 'reasonfororder',
  // User-defined fields
  'userdefines', 'userdefine',
  // GE MUSE / Cardiosoft / MAC
  'patientdemographics', 'patientname', 'patientage', 'dateofbirthstring',
  'orderingmd', 'referringmd', 'overreadingmd', 'attendingmd',
  'location', 'locationname', 'roomdesc',
  'testdemographics', 'sitename',
  // Technician / physician
  'technicianname', 'editlistname', 'technicianid',
  // HL7 aECG patient
  'patientrole', 'assignedperson', 'trialsubject', 'subjectdemographicperson',
  'administrativegendercode', 'birthtime',
  // Schiller SEMA
  'patientinfo', 'patdata', 'physician', 'referringphysician', 'techname',
  // Mindray
  'patientinformation', 'patientdata',
  // ecgML
  'patientdemographics', 'contactinfo', 'medicalhistory', 'medications',
  'clinicalprotocol', 'vitalsigns',
  // Welch Allyn / CardioPerfect
  'demographics', 'referring', 'attending',
  // Nihon Kohden / generic
  'subjectinfo', 'personinfo', 'personname',
]);

/** Tags to keep even inside patient sections (none — we remove the whole subtree) */
const WAVEFORM_TAGS = new Set([
  'waveforms', 'parsedwaveforms', 'waveform', 'repbeat',
  'leaddata', 'waveformdata',
  'signalcharacteristics', 'samplingrate', 'resolution', 'bitspersample',
  'reportinfo', 'reportgain', 'reportbandwidth', 'reportformat',
  'dataacquisition', 'machine',
  'internalmeasurements', 'crossleadmeasurements', 'groupmeasurements',
  'leadmeasurements', 'leadmeasurement',
  'interpretations', 'interpretation',
  'waveformformat', 'mainwaveformformat', 'rhythmwaveformformat',
  // GE MUSE
  'restingecg', 'musewaveform', 'samplebase', 'leadid',
  'leadamplitudeunitsperbit', 'leadsamplecounttotal',
  // General signal
  'ecg', 'channel', 'samples', 'samplerate', 'data',
]);

/* ------------------------------------------------------------------ */
/*  Full mode: tags to keep (waveform + minimal structure only)        */
/* ------------------------------------------------------------------ */

const FULL_KEEP_TAGS = new Set([
  // Waveform data
  'waveforms', 'parsedwaveforms', 'waveform', 'repbeat',
  'leaddata', 'waveformdata', 'leadid',
  'leadamplitudeunitsperbit', 'leadsamplecounttotal',
  // Signal characteristics
  'signalcharacteristics', 'samplingrate', 'resolution', 'bitspersample',
  'signaloffset', 'signalsigned', 'numberchannelsallocated', 'numberchannelsvalid',
  // Format info (needed to interpret data)
  'waveformformat', 'mainwaveformformat', 'rhythmwaveformformat',
  // Channel/sample data
  'channel', 'samples', 'data', 'samplerate', 'leadname',
]);

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function anonymizeXml(content: string, mode: AnonMode): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200)}`);

  if (mode === 'full') {
    stripFullMode(doc.documentElement);
  } else {
    stripSmartMode(doc.documentElement);
  }

  const serializer = new XMLSerializer();
  let result = serializer.serializeToString(doc);

  // Add XML declaration if missing
  if (!result.startsWith('<?xml')) {
    result = '<?xml version="1.0" encoding="UTF-8"?>\n' + result;
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Smart mode: remove only patient data subtrees                       */
/* ------------------------------------------------------------------ */

function stripSmartMode(el: Element): void {
  const children = Array.from(el.children);
  for (const child of children) {
    const tag = child.localName.toLowerCase();

    if (PATIENT_TAGS.has(tag)) {
      el.removeChild(child);
      continue;
    }

    // Also blank text content of elements that contain patient data attributes
    blankPatientAttributes(child);

    // Recurse
    stripSmartMode(child);
  }
}

function blankPatientAttributes(el: Element): void {
  const patientAttrs = ['patientid', 'patientname', 'operatorid', 'technicianid'];
  for (const name of patientAttrs) {
    if (el.hasAttribute(name)) el.setAttribute(name, '');
  }
}

/* ------------------------------------------------------------------ */
/*  Full mode: keep only waveform/signal structure                      */
/* ------------------------------------------------------------------ */

function stripFullMode(el: Element): void {
  const children = Array.from(el.children);
  for (const child of children) {
    const tag = child.localName.toLowerCase();

    if (FULL_KEEP_TAGS.has(tag)) {
      // Keep this element but recurse to clean deeper
      stripFullMode(child);
      continue;
    }

    // Check if any descendant is a keep tag
    if (hasKeepDescendant(child)) {
      stripFullMode(child);
      continue;
    }

    // Remove everything else
    el.removeChild(child);
  }
}

function hasKeepDescendant(el: Element): boolean {
  for (const child of el.children) {
    if (FULL_KEEP_TAGS.has(child.localName.toLowerCase())) return true;
    if (hasKeepDescendant(child)) return true;
  }
  return false;
}

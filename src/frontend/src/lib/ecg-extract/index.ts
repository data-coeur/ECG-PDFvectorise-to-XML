// ECG signal extraction pipeline — entry point.
//
// Pipeline: PDF → parse paths → detect manufacturer (from PDF content) → load profile
//           → identify traces → detect grid → compute scale → detect layout
//           → assign leads → find calibration baselines → convert to mV

import { pdfjsLib } from '../pdf-config';
import type { PDFPageProxy, PDFDocumentProxy } from 'pdfjs-dist';
import type { Label, ECGData, ECGChannel } from '../types';
import { LEAD_NAMES, LEAD_ALIASES } from './constants';
import { detectManufacturer, resolveProfile } from './profiles';
import { parse } from './parse-paths';
import { idTraces } from './identify-traces';
import { detectLayout } from './detect-layout';
import { assign } from './assign-leads';
import { extractGridLines, computeScaleFromGrid, extractCalibrationBaselines, findBaselineForTrace } from './grid-and-scale';
import { toPhysical } from './signal-convert';

export async function extractFromPdf(file: File): Promise<ECGData | null> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  return extract(page, pdf, file.name);
}

async function extract(pg: PDFPageProxy, pdf: PDFDocumentProxy, fn: string): Promise<ECGData | null> {
  const vp = pg.getViewport({ scale: 1 });
  const ops = await pg.getOperatorList();
  const tc = await pg.getTextContent();

  // Step 1: Parse all vector paths from the PDF
  const allPolylines = parse(ops, vp);

  // Step 2: Detect manufacturer from PDF content (metadata + page size + vector signatures)
  const meta = await pdf.getMetadata();
  const mfrName = detectManufacturer(meta.info as Record<string, string>, vp, allPolylines);
  const profile = resolveProfile(mfrName);

  // Step 3: Extract text labels (lead names: I, II, V1...)
  // Merge global aliases with profile-specific extra aliases
  const effectiveAliases = { ...LEAD_ALIASES, ...profile.leads.extraAliases };
  const allTokens = [...LEAD_NAMES, ...Object.keys(effectiveAliases)];

  const labels: Label[] = [];
  const seenLabels = new Set<string>();
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    const t = it.str.trim();
    if (allTokens.includes(t)) {
      const normalized = effectiveAliases[t] || t;
      if (seenLabels.has(normalized)) continue;
      seenLabels.add(normalized);
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      labels.push({ text: normalized, x, y });
    }
  }

  // Step 3: Identify ECG signal traces
  const traces = idTraces(allPolylines, profile);
  if (!traces.length) return null;

  // Step 4: Detect grid lines from the PDF
  const grid = extractGridLines(allPolylines, vp, profile);
  if (!grid) throw new Error('GRID_NOT_DETECTED');

  // Step 5: Compute physical scale from grid spacing
  const scale = computeScaleFromGrid(grid);

  // Step 6: Detect page layout
  const layout = detectLayout(traces, vp, profile);

  // Step 7: Assign each trace to a lead name
  const assigned = assign(traces, labels, layout, profile);

  // Step 8: Find exact 0mV baselines from calibration pulses (best-effort).
  // Some PDF formats don't have detectable calibration pulses — in that case
  // findBaselineForTrace falls back to using the trace's vertical center.
  const calBaselines = extractCalibrationBaselines(allPolylines, scale, layout, profile);

  // Step 9: Convert each trace from PDF coordinates to millivolts
  // Helper to convert one assigned trace into an ECGChannel object
  const toChannel = (c: typeof assigned[number]): ECGChannel => {
    const baseline = findBaselineForTrace(c.pts, calBaselines, layout);
    const signal = toPhysical(c.pts, scale, layout, baseline);
    let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
    for (const p of c.pts) {
      if (p.x < bx0) bx0 = p.x; if (p.x > bx1) bx1 = p.x;
      if (p.y < by0) by0 = p.y; if (p.y > by1) by1 = p.y;
    }
    return {
      name: c.name, samples: signal.samples, duration_s: signal.dur,
      sample_rate_hz: signal.samples.length > 1 ? Math.round(signal.samples.length / signal.dur) : 0,
      voltage_unit: 'mV', time_unit: 's',
      bbox: { x0: bx0, x1: bx1, y0: by0, y1: by1 },
    };
  };

  // Build the standard 12 leads (everything except *_rhythm channels)
  const standardChannels: ECGChannel[] = assigned
    .filter(c => !/_rhythm$/i.test(c.name))
    .map(toChannel);

  // Build the rhythm strip channel (target ~10s duration)
  const TARGET_RHYTHM_DURATION_S = 10;
  const rhythmChannel = buildRhythmStripChannel(assigned, standardChannels, toChannel, TARGET_RHYTHM_DURATION_S);

  return {
    manufacturer: profile.name,
    layout: layout.type,
    filename: fn,
    page_size: { width: Math.round(vp.width), height: Math.round(vp.height) },
    scale: { mm_per_s: 25, mm_per_mV: 10, pts_per_mm: Math.round(scale.pmm * 100) / 100 },
    grid,
    channels: rhythmChannel ? [...standardChannels, rhythmChannel] : standardChannels,
  };
}

// Build a rhythm strip channel for the bottom row of the layout.
// - If the PDF already provides a separate rhythm strip channel (Mortara 12+1),
//   use it as-is with its real duration.
// - Otherwise, repeat lead II enough times to reach `targetDuration` seconds
//   (e.g. ×2 for MUSE 5s leads → 10s rhythm strip).
function buildRhythmStripChannel(
  assigned: ReturnType<typeof assign>,
  standardChannels: ECGChannel[],
  toChannel: (c: ReturnType<typeof assign>[number]) => ECGChannel,
  targetDuration: number,
): ECGChannel | null {
  // Case 1: PDF provides a separate rhythm strip — use the original 10s data
  const originalRhythm = assigned.find(c => /_rhythm$/i.test(c.name));
  if (originalRhythm) {
    const ch = toChannel(originalRhythm);
    return { ...ch, name: 'II_rhythm' };
  }

  // Case 2: No separate rhythm strip — repeat lead II to reach targetDuration
  const leadII = standardChannels.find(c => c.name === 'II');
  if (!leadII || leadII.duration_s <= 0) return null;
  if (leadII.duration_s >= targetDuration) {
    // Already long enough, just clone with rhythm name
    return { ...leadII, name: 'II_rhythm' };
  }

  // Tolerance to avoid e.g. ceil(2.0008) = 3 when duration is ~4.998s instead of 5s
  const ratio = targetDuration / leadII.duration_s;
  const repeats = Math.max(1, Math.ceil(ratio - 0.05));
  const repeatedSamples: number[] = [];
  for (let r = 0; r < repeats; r++) repeatedSamples.push(...leadII.samples);
  const newDur = leadII.duration_s * repeats;
  return {
    ...leadII,
    name: 'II_rhythm',
    samples: repeatedSamples,
    duration_s: newDur,
    sample_rate_hz: Math.round(repeatedSamples.length / newDur),
  };
}

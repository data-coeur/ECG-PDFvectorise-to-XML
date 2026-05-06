// ECG signal extraction pipeline — entry point.
//
// Pipeline: PDF → parse paths → detect manufacturer (from PDF content) → load profile
//           → identify traces → detect grid → compute scale → detect layout
//           → assign leads → find calibration baselines → convert to mV

import { pdfjsLib } from '../pdf-config';
import type { PDFPageProxy, PDFDocumentProxy } from 'pdfjs-dist';
import type { Label, ECGData, ECGChannel, Polyline } from '../types';
import { LEAD_NAMES, LEAD_ALIASES } from './constants';
import { detectManufacturer, resolveProfile } from './profiles';
import { parse } from './parse-paths';
import { normalizeOrientation, rotatePoint } from './normalize-orientation';
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
  const rawPolylines = parse(ops, vp);

  // ── Diagnostic (temporary) ──
  const colorBuckets: Record<string, number> = {};
  for (const p of rawPolylines) {
    const key = `${p.col[0].toFixed(2)},${p.col[1].toFixed(2)},${p.col[2].toFixed(2)}`;
    colorBuckets[key] = (colorBuckets[key] || 0) + 1;
  }
  console.log(`[ECG] Raw polylines: ${rawPolylines.length}, colors:`, colorBuckets);
  console.log(`[ECG] Viewport: ${vp.width.toFixed(0)}x${vp.height.toFixed(0)}, ops: ${ops.fnArray.length}`);
  // ── End diagnostic ──

  // Step 2: Detect manufacturer from raw polylines. None of the detection
  // rules depend on content rotation, and we need the profile to run
  // manufacturer-specific polyline post-processing BEFORE orientation is
  // normalized — otherwise per-segment PDFs (Vectracor) have no long traces
  // to score rotation on, and landscape/portrait misdetection results in a
  // flat signal.
  const meta = await pdf.getMetadata();
  const mfrName = detectManufacturer(meta.info as Record<string, string>, vp, rawPolylines);
  const profile = resolveProfile(mfrName);
  console.log(`[ECG] Manufacturer: ${mfrName}`);

  // Step 2b: Manufacturer-specific polyline post-processing. Most profiles
  // leave this undefined; Vectracor-style per-segment PDFs use it to fuse
  // thousands of 2-point subpaths back into continuous traces.
  const processed = profile.postProcessPolylines
    ? profile.postProcessPolylines(rawPolylines)
    : rawPolylines;
  if (profile.postProcessPolylines) {
    console.log(`[ECG] postProcessPolylines: ${rawPolylines.length} → ${processed.length}`);
  }

  // Step 2c: Rectify content-stream rotation (90/180/270°) so downstream
  // stages — which all assume time runs along x — can stay unchanged. Runs
  // on the post-processed polylines so per-segment PDFs expose real traces
  // to the orientation scorer. Profiles can override the content-based
  // detection with `forceRotation` when their orientation is always the
  // same but individual pages don't have enough traces to score reliably.
  let polylines: Polyline[];
  let workVp: { width: number; height: number };
  let rotation: 0 | 90 | 180 | 270;
  if (profile.forceRotation !== undefined) {
    rotation = profile.forceRotation;
    polylines = processed.map(p => ({
      ...p,
      pts: p.pts.map(pt => rotatePoint(pt, rotation, vp.width, vp.height)),
    }));
    workVp = (rotation === 90 || rotation === 270)
      ? { width: vp.height, height: vp.width }
      : { width: vp.width, height: vp.height };
    console.log(`[ECG] Rotation: ${rotation}° (forced by profile), polylines: ${polylines.length}`);
  } else {
    const r = normalizeOrientation(processed, vp);
    polylines = r.polylines;
    workVp = r.vp;
    rotation = r.rotation;
    console.log(`[ECG] Rotation: ${rotation}°, polylines after normalize: ${polylines.length}`);
  }

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
      // Apply the same rotation we applied to the polylines, so labels stay
      // co-located with the traces they belong to.
      const rp = rotatePoint({ x, y }, rotation, vp.width, vp.height);
      labels.push({ text: normalized, x: rp.x, y: rp.y });
    }
  }

  // Step 3: Identify ECG signal traces
  const traces = idTraces(polylines, profile);
  console.log(`[ECG] idTraces: ${traces.length} traces found (threshold: black<${profile.trace.blackThreshold}, minPts>${profile.trace.minPoints})`);
  if (traces.length) {
    const top5 = traces.slice(0, 5).map(t => `${t.pts.length}pts col=[${t.col.map(c => c.toFixed(2)).join(',')}]`);
    console.log(`[ECG] Top traces: ${top5.join(' | ')}`);
  }
  if (!traces.length) return null;

  // Step 4: Detect grid lines from the PDF
  const grid = extractGridLines(polylines, workVp, profile);
  if (!grid) throw new Error('GRID_NOT_DETECTED');

  // Step 5: Compute physical scale from grid spacing
  const scale = computeScaleFromGrid(grid);

  // Step 6: Detect page layout
  const layout = detectLayout(traces, workVp, profile);

  // Step 7: Assign each trace to a lead name
  const assigned = assign(traces, labels, layout, profile);

  // Step 8: Find exact 0mV baselines from calibration pulses (best-effort).
  // Some PDF formats don't have detectable calibration pulses — in that case
  // findBaselineForTrace falls back to a histogram-mode estimate snapped onto
  // the nearest major (5 mm) grid line.
  const calBaselines = extractCalibrationBaselines(polylines, scale, layout, profile);

  // Step 9: Convert each trace from PDF coordinates to millivolts
  // Helper to convert one assigned trace into an ECGChannel object
  const toChannel = (c: typeof assigned[number]): ECGChannel => {
    const baseline = findBaselineForTrace(c.pts, calBaselines, layout, grid);
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
  const hasNativeRhythm = assigned.some(c => /_rhythm$/i.test(c.name));
  const rhythmChannel = buildRhythmStripChannel(assigned, standardChannels, toChannel, TARGET_RHYTHM_DURATION_S);

  return {
    manufacturer: profile.name,
    layout: layout.type,
    filename: fn,
    page_size: { width: Math.round(vp.width), height: Math.round(vp.height) },
    scale: { mm_per_s: 25, mm_per_mV: 10, pts_per_mm: Math.round(scale.pmm * 100) / 100 },
    grid,
    channels: rhythmChannel ? [...standardChannels, rhythmChannel] : standardChannels,
    hasNativeRhythm,
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

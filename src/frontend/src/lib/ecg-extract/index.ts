// ecg-extract/index — chef d'orchestre de l'extraction signal ECG.
// In  : un File (PDF). Out : ECGData (manufacturer + layout + 12-13 channels mV).
// Appelé par App.tsx::processQueue. Lance les 13 étapes ci-dessous dans l'ordre,
// chacune dans son propre fichier (voir le diagramme dans README.md de ce dossier).
//
//   01  parse-paths              opérateurs PDF → polylignes (couleur, épaisseur, points)
//   02  detect-manufacturer      signatures contenu → nom de profil
//   03  apply profile pre-process  réécriture polylignes spécifique vendor (Vectracor weld)
//   04  rectify-orientation      détecte rotation 90/180/270°, tourne polylignes + labels
//   05  extract-text-labels      items texte pdfjs → labels de leads (I, II, V1...)
//   06  find-signal-traces       filtre polylignes → 12 traces signal
//   07  extract-grid             trouve les lignes horizontales et verticales de la grille
//   08  compute-scale            espacement grille → pts/mm, pts/sec, pts/mV
//   09  detect-layout            stacked / sequential / grid_4x3
//   10  pair-traces-with-labels  appariement positionnel trace ↔ nom de lead
//   11  find-baselines           impulsions de calibration ou mode-snappé sur grille
//   12  convert-to-mv            points polyligne → samples en millivolts
//   13  build rhythm strip       répétition / clone du lead II si besoin

import { pdfjsLib } from '../pdf-config';
import type { PDFPageProxy, PDFDocumentProxy } from 'pdfjs-dist';
import type { Label, ECGData, ECGChannel, Polyline } from '../types';
import { LEAD_NAMES, LEAD_ALIASES } from './lead-names';
import { detectManufacturer, resolveProfile } from './profiles';
import { parse } from './parse-paths';
import { rectifyOrientation, rotatePoint } from './rectify-orientation';
import { findSignalTraces } from './find-signal-traces';
import { detectLayout } from './detect-layout';
import { pairTracesWithLabels } from './pair-traces-with-labels';
import { extractGridLines } from './extract-grid';
import { computeScaleFromGrid } from './compute-scale';
import { extractCalibrationBaselines, findBaselineForTrace } from './find-baselines';
import { convertToMv } from './convert-to-mv';
import { computeBoundingBox } from './polyline-utils';

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

  // ── 01  parse-paths ───────────────────────────────────────────────────
  const rawPolylines = parse(ops, vp);
  console.log(`[ECG] Raw polylines: ${rawPolylines.length}  viewport: ${vp.width.toFixed(0)}×${vp.height.toFixed(0)}  ops: ${ops.fnArray.length}`);

  // ── 02  detect-manufacturer ──────────────────────────────────────────
  // Detection rules don't depend on content rotation, and we need the
  // profile to run manufacturer-specific polyline post-processing BEFORE
  // orientation is rectified — otherwise per-segment PDFs (Vectracor) have
  // no long traces to score rotation on.
  const meta = await pdf.getMetadata();
  const manufacturer = detectManufacturer(meta.info as Record<string, string>, vp, rawPolylines);
  const profile = resolveProfile(manufacturer);
  console.log(`[ECG] Manufacturer: ${manufacturer}`);

  // ── 03  apply profile pre-process ─────────────────────────────────────
  // Most profiles leave this undefined; Vectracor-style per-segment PDFs
  // use it to fuse thousands of 2-point subpaths into continuous traces.
  const processed = profile.postProcessPolylines
    ? profile.postProcessPolylines(rawPolylines)
    : rawPolylines;
  if (profile.postProcessPolylines) {
    console.log(`[ECG] postProcessPolylines: ${rawPolylines.length} → ${processed.length}`);
  }

  // ── 04  rectify-orientation ──────────────────────────────────────────
  // After this step, every downstream stage can assume time runs along x.
  // Profiles can override the content-based detection with `forceRotation`
  // when their orientation is fixed but individual pages don't have enough
  // traces for the scorer to be reliable.
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
    const r = rectifyOrientation(processed, vp);
    polylines = r.polylines;
    workVp = r.vp;
    rotation = r.rotation;
    console.log(`[ECG] Rotation: ${rotation}°, polylines after rectify: ${polylines.length}`);
  }

  // ── 05  extract-text-labels ───────────────────────────────────────────
  // Filter pdfjs text items down to lead labels (I, II, V1…), normalising
  // through aliases (D1 → I, etc.). Labels are rotated alongside polylines
  // so they stay co-located with their trace.
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
      const rp = rotatePoint({ x, y }, rotation, vp.width, vp.height);
      labels.push({ text: normalized, x: rp.x, y: rp.y });
    }
  }

  // ── 06  find-signal-traces ────────────────────────────────────────────
  const traces = findSignalTraces(polylines, profile);
  console.log(`[ECG] findSignalTraces: ${traces.length} traces found (black<${profile.trace.blackThreshold}, minPts>${profile.trace.minPoints})`);
  if (traces.length) {
    const top5 = traces.slice(0, 5).map(t => `${t.pts.length}pts col=[${t.col.map(c => c.toFixed(2)).join(',')}]`);
    console.log(`[ECG] Top traces: ${top5.join(' | ')}`);
  }
  if (!traces.length) return null;

  // ── 07  extract-grid ──────────────────────────────────────────────────
  const grid = extractGridLines(polylines, workVp, profile);
  if (!grid) throw new Error('GRID_NOT_DETECTED');

  // ── 08  compute-scale ─────────────────────────────────────────────────
  const scale = computeScaleFromGrid(grid);

  // ── 09  detect-layout ─────────────────────────────────────────────────
  const layout = detectLayout(traces, workVp, profile);

  // ── 10  pair-traces-with-labels ───────────────────────────────────────
  const labelledTraces = pairTracesWithLabels(traces, labels, layout, profile);

  // ── 11  find-baselines ────────────────────────────────────────────────
  // Calibration pulses give exact 0 mV baselines when present; otherwise
  // findBaselineForTrace falls back to a histogram-mode estimate snapped
  // onto the nearest major (5 mm) grid line.
  const calBaselines = extractCalibrationBaselines(polylines, scale, layout, profile);

  // ── 12  convert-to-mv ─────────────────────────────────────────────────
  // Convert each labelled trace from PDF coordinates to millivolt samples.
  const toChannel = (c: typeof labelledTraces[number]): ECGChannel => {
    const baseline = findBaselineForTrace(c.pts, calBaselines, layout, grid);
    const signal = convertToMv(c.pts, scale, layout, baseline);
    const bb = computeBoundingBox(c.pts);
    return {
      name: c.name,
      samples: signal.samples,
      duration_s: signal.dur,
      sample_rate_hz: signal.samples.length > 1 ? Math.round(signal.samples.length / signal.dur) : 0,
      voltage_unit: 'mV',
      time_unit: 's',
      bbox: { x0: bb.x0, x1: bb.x1, y0: bb.y0, y1: bb.y1 },
    };
  };

  const standardChannels: ECGChannel[] = labelledTraces
    .filter(c => !/_rhythm$/i.test(c.name))
    .map(toChannel);

  // ── 13  build rhythm strip ────────────────────────────────────────────
  const TARGET_RHYTHM_DURATION_S = 10;
  const hasNativeRhythm = labelledTraces.some(c => /_rhythm$/i.test(c.name));
  const rhythmChannel = buildRhythmStripChannel(labelledTraces, standardChannels, toChannel, TARGET_RHYTHM_DURATION_S);

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
  labelledTraces: ReturnType<typeof pairTracesWithLabels>,
  standardChannels: ECGChannel[],
  toChannel: (c: ReturnType<typeof pairTracesWithLabels>[number]) => ECGChannel,
  targetDuration: number,
): ECGChannel | null {
  // Case 1: PDF provides a separate rhythm strip — use the original 10s data
  const originalRhythm = labelledTraces.find(c => /_rhythm$/i.test(c.name));
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

// 10  pair-traces-with-labels — match each ECG trace to a lead name
// (I, II, V1…) using the geometric position of both the trace and its
// nearest text label.
//
// Pairing is *positional*, not based on reading the label text against the
// trace itself: we sort both collections in the same axis order and map by
// index. A previous attempt at greedy nearest-neighbour matching produced
// duplicate / wrong assignments when label positions in the PDF didn't
// perfectly align with their traces.
//
// Three layouts supported:
//   - stacked_12x1        12 traces in one column, 12 labels next to them
//   - grid_4x3            12 traces in a 4×3 grid + optional rhythm strip
//   - sequential_6x2      12 traces in two columns of six (the most common)

import type { Point, Polyline, Label, Layout } from '../types';
import { LEAD_NAMES } from './lead-names';
import type { ManufacturerProfile } from './profiles';

export type LabelledTrace = { name: string; pts: Point[]; baselineY?: number };

export function pairTracesWithLabels(
  traces: Polyline[],
  labels: Label[],
  layout: Layout,
  profile: ManufacturerProfile,
): LabelledTrace[] {
  const valueAxis: 'x' | 'y' = layout.timeAxis === 'x' ? 'y' : 'x';

  if (layout.type === 'stacked_12x1') {
    return pairStacked12x1(traces, labels, layout, valueAxis);
  }
  if (layout.type === 'grid_4x3') {
    return pairGrid4x3(traces, profile);
  }
  return pairSequential6x2(traces, labels, valueAxis);
}

// 12 traces stacked vertically (or horizontally), labels printed next to
// each one. Sort both collections along the axis perpendicular to time
// and pair by index.
function pairStacked12x1(
  traces: Polyline[],
  labels: Label[],
  layout: Layout,
  valueAxis: 'x' | 'y',
): LabelledTrace[] {
  const tracePerpKey: 'cx' | 'cy' = layout.timeAxis === 'x' ? 'cy' : 'cx';
  const labelPerpKey: 'x' | 'y' = layout.timeAxis === 'x' ? 'y' : 'x';
  const sortedTraces = [...traces].sort((a, b) => a.bb![tracePerpKey] - b.bb![tracePerpKey]);
  const sortedLabels = [...labels].sort((a, b) => a[labelPerpKey] - b[labelPerpKey]);
  return sortedTraces.map((t, i) => ({
    name: i < sortedLabels.length
      ? sortedLabels[i].text
      : i < LEAD_NAMES.length ? LEAD_NAMES[i] : `L${i + 1}`,
    pts: t.pts,
    baselineY: i < sortedLabels.length ? sortedLabels[i][valueAxis] : undefined,
  }));
}

// 6 traces × 2 columns. Split into upper and lower halves, sort each by
// (column then row) so positional pairing with labels is stable. The
// secondary sort by `cy` is important — JS stable-sort would otherwise
// preserve whatever order findSignalTraces returned (point count
// descending), which can scramble rows within a column when the lead
// with the most inflection points isn't the topmost one.
function pairSequential6x2(
  traces: Polyline[],
  labels: Label[],
  valueAxis: 'x' | 'y',
): LabelledTrace[] {
  const cyVals = traces.map(t => t.bb!.cy);
  const cyMid = (Math.min(...cyVals) + Math.max(...cyVals)) / 2;
  const upper = traces.filter(t => t.bb!.cy < cyMid).sort((a, b) => a.bb!.cx - b.bb!.cx || a.bb!.cy - b.bb!.cy);
  const lower = traces.filter(t => t.bb!.cy >= cyMid).sort((a, b) => a.bb!.cx - b.bb!.cx || a.bb!.cy - b.bb!.cy);

  let upperLabels: Label[];
  let lowerLabels: Label[];
  if (labels.length >= 12) {
    const labelYs = labels.map(l => l.y);
    const labelMid = (Math.min(...labelYs) + Math.max(...labelYs)) / 2;
    upperLabels = labels.filter(l => l.y < labelMid).sort((a, b) => a.x - b.x || a.y - b.y);
    lowerLabels = labels.filter(l => l.y >= labelMid).sort((a, b) => a.x - b.x || a.y - b.y);
  } else {
    upperLabels = LEAD_NAMES.slice(0, 6).map(n => ({ text: n, x: 0, y: 0 }));
    lowerLabels = LEAD_NAMES.slice(6).map(n => ({ text: n, x: 0, y: 0 }));
  }

  const channels: LabelledTrace[] = [];
  for (let i = 0; i < upper.length; i++) {
    channels.push({
      name: i < upperLabels.length ? upperLabels[i].text : `L${i + 1}`,
      pts: upper[i].pts,
      baselineY: upperLabels[i]?.[valueAxis],
    });
  }
  for (let i = 0; i < lower.length; i++) {
    channels.push({
      name: i < lowerLabels.length ? lowerLabels[i].text : `L${i + 7}`,
      pts: lower[i].pts,
      baselineY: lowerLabels[i]?.[valueAxis],
    });
  }

  channels.sort((a, b) => {
    const ia = LEAD_NAMES.indexOf(a.name), ib = LEAD_NAMES.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return channels;
}

// 4 columns (I/II/III, aVR/aVL/aVF, V1/V2/V3, V4/V5/V6) × 3 rows, plus an
// optional rhythm strip drawn full-width at the bottom. Uses positional
// assignment via profile.leads.gridOrder rather than label proximity.
function pairGrid4x3(
  traces: Polyline[],
  profile: ManufacturerProfile,
): LabelledTrace[] {
  const widths = traces.map(t => t.bb!.dx);
  const medWidth = [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)];
  const rhythmThreshold = medWidth * profile.leads.rhythmStripWidthRatio;
  const rhythm = traces.filter(t => t.bb!.dx > rhythmThreshold);
  const gridTraces = traces.filter(t => t.bb!.dx <= rhythmThreshold);

  // Cluster grid traces into columns by cx (left-to-right)
  const cxSorted = [...gridTraces].sort((a, b) => a.bb!.cx - b.bb!.cx);
  const colGroups: Polyline[][] = [[]];
  for (const t of cxSorted) {
    const last = colGroups[colGroups.length - 1];
    if (last.length && t.bb!.cx - last[last.length - 1].bb!.cx > medWidth * 0.5) {
      colGroups.push([t]);
    } else {
      last.push(t);
    }
  }

  // Sort each column top-to-bottom
  for (const col of colGroups) col.sort((a, b) => a.bb!.cy - b.bb!.cy);

  const gridOrder = profile.leads.gridOrder;
  const channels: LabelledTrace[] = [];
  for (let ci = 0; ci < colGroups.length && ci < gridOrder.length; ci++) {
    for (let ri = 0; ri < colGroups[ci].length && ri < gridOrder[ci].length; ri++) {
      channels.push({ name: gridOrder[ci][ri], pts: colGroups[ci][ri].pts });
    }
  }

  // Rhythm strip(s): always named after the standard rhythm lead (II)
  for (const t of rhythm) channels.push({ name: 'II_rhythm', pts: t.pts });

  // Sort by standard 12-lead order (rhythm strips at the end)
  channels.sort((a, b) => {
    const na = a.name.replace('_rhythm', ''), nb = b.name.replace('_rhythm', '');
    const ia = LEAD_NAMES.indexOf(na), ib = LEAD_NAMES.indexOf(nb);
    const oa = ia < 0 ? 99 : ia, ob = ib < 0 ? 99 : ib;
    if (oa !== ob) return oa - ob;
    return a.name.includes('_rhythm') ? 1 : -1;
  });
  return channels;
}

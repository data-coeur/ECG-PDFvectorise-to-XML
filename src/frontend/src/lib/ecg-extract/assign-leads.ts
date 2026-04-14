import type { Point, Polyline, Label, Layout } from '../types';
import { LEAD_NAMES } from './constants';
import type { ManufacturerProfile } from './profiles';

export type AssignResult = { name: string; pts: Point[]; baselineY?: number };

// Match each trace to a lead name using text labels and position.
export function assign(tr: Polyline[], lb: Label[], lay: Layout, profile: ManufacturerProfile): AssignResult[] {
  const vK = lay.tA === 'x' ? 'y' : 'x';

  if (lay.type === 'stacked_12x1') {
    const perpKey = lay.tA === 'x' ? 'cy' : 'cx';
    const labelSortKey = lay.tA === 'x' ? 'y' : 'x';
    const s = [...tr].sort((a, b) => a.bb![perpKey as keyof typeof a.bb] - b.bb![perpKey as keyof typeof b.bb]);
    const sl = [...lb].sort((a, b) => a[labelSortKey as keyof typeof a] as number - (b[labelSortKey as keyof typeof b] as number));
    return s.map((t, i) => ({
      name: i < sl.length ? sl[i].text : i < LEAD_NAMES.length ? LEAD_NAMES[i] : `L${i + 1}`,
      pts: t.pts,
      baselineY: i < sl.length ? sl[i][vK as keyof typeof sl[0]] as number : undefined,
    }));
  }

  if (lay.type === 'grid_4x3') {
    return assignGrid4x3(tr, lb, vK, profile);
  }

  // sequential_6x2: split into upper/lower halves, sort columns left-to-right
  // and rows top-to-bottom so positional pairing with labels is stable. A
  // single sort by cx is NOT enough: JS stable-sort would preserve whatever
  // order idTraces returned (point count descending), which can scramble rows
  // within a column when the lead with the most inflection points isn't the
  // topmost one.
  const cyVals = tr.map(t => t.bb!.cy);
  const cyMid = (Math.min(...cyVals) + Math.max(...cyVals)) / 2;
  const g1 = tr.filter(t => t.bb!.cy < cyMid).sort((a, b) => a.bb!.cx - b.bb!.cx || a.bb!.cy - b.bb!.cy);
  const g2 = tr.filter(t => t.bb!.cy >= cyMid).sort((a, b) => a.bb!.cx - b.bb!.cx || a.bb!.cy - b.bb!.cy);

  let l1: Label[], l2: Label[];
  if (lb.length >= 12) {
    const labelYs = lb.map(l => l.y);
    const labelMid = (Math.min(...labelYs) + Math.max(...labelYs)) / 2;
    l1 = lb.filter(l => l.y < labelMid).sort((a, b) => a.x - b.x || a.y - b.y);
    l2 = lb.filter(l => l.y >= labelMid).sort((a, b) => a.x - b.x || a.y - b.y);
  } else {
    l1 = LEAD_NAMES.slice(0, 6).map(n => ({ text: n, x: 0, y: 0 }));
    l2 = LEAD_NAMES.slice(6).map(n => ({ text: n, x: 0, y: 0 }));
  }

  const ch: AssignResult[] = [];
  for (let i = 0; i < g1.length; i++)
    ch.push({ name: i < l1.length ? l1[i].text : `L${i + 1}`, pts: g1[i].pts, baselineY: l1[i]?.[vK as keyof Label] as number | undefined });
  for (let i = 0; i < g2.length; i++)
    ch.push({ name: i < l2.length ? l2[i].text : `L${i + 7}`, pts: g2[i].pts, baselineY: l2[i]?.[vK as keyof Label] as number | undefined });

  ch.sort((a, b) => {
    const ia = LEAD_NAMES.indexOf(a.name), ib = LEAD_NAMES.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return ch;
}

// 4x3 grid: 4 columns (I/II/III, aVR/aVL/aVF, V1/V2/V3, V4/V5/V6) × 3 rows + rhythm strip.
// Uses positional assignment via profile.leads.gridOrder. Label-based matching was tried
// before but was unreliable (greedy nearest-neighbor produced duplicate / wrong assignments
// when label positions in the PDF didn't perfectly match their traces).
function assignGrid4x3(tr: Polyline[], _lb: Label[], _vK: string, profile: ManufacturerProfile): AssignResult[] {
  const widths = tr.map(t => t.bb!.dx);
  const medWidth = [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)];
  const rhythmThreshold = medWidth * profile.leads.rhythmStripWidthRatio;
  const rhythm = tr.filter(t => t.bb!.dx > rhythmThreshold);
  const grid = tr.filter(t => t.bb!.dx <= rhythmThreshold);

  // Cluster grid traces into columns by cx (left-to-right)
  const cxSorted = [...grid].sort((a, b) => a.bb!.cx - b.bb!.cx);
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
  const ch: AssignResult[] = [];

  // Positional assignment: column index → group of leads, row index → lead within group
  for (let ci = 0; ci < colGroups.length && ci < gridOrder.length; ci++) {
    for (let ri = 0; ri < colGroups[ci].length && ri < gridOrder[ci].length; ri++) {
      ch.push({ name: gridOrder[ci][ri], pts: colGroups[ci][ri].pts });
    }
  }

  // Rhythm strip(s): always named after the standard rhythm lead (II)
  for (const t of rhythm) {
    ch.push({ name: 'II_rhythm', pts: t.pts });
  }

  // Sort by standard 12-lead order (rhythm strips at the end)
  ch.sort((a, b) => {
    const na = a.name.replace('_rhythm', ''), nb = b.name.replace('_rhythm', '');
    const ia = LEAD_NAMES.indexOf(na), ib = LEAD_NAMES.indexOf(nb);
    const oa = ia < 0 ? 99 : ia, ob = ib < 0 ? 99 : ib;
    if (oa !== ob) return oa - ob;
    return a.name.includes('_rhythm') ? 1 : -1;
  });
  return ch;
}

import { pdfjsLib } from './pdf-config';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { Point, Polyline, Label, Layout, ScaleInfo, ECGData } from './types';

const LEAD_NAMES = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'];
const LEAD_ALIASES: Record<string, string> = {
  'D1': 'I', 'D2': 'II', 'D3': 'III',
  'DI': 'I', 'DII': 'II', 'DIII': 'III',
};
const ALL_LEAD_TOKENS = [...LEAD_NAMES, ...Object.keys(LEAD_ALIASES)];
const OPS = pdfjsLib.OPS;

// ── Matrix helpers (6-element affine: [a,b,c,d,e,f]) ──
function matMul(m1: number[], m2: number[]): number[] {
  return [
    m1[0]*m2[0]+m1[2]*m2[1],       m1[1]*m2[0]+m1[3]*m2[1],
    m1[0]*m2[2]+m1[2]*m2[3],       m1[1]*m2[2]+m1[3]*m2[3],
    m1[0]*m2[4]+m1[2]*m2[5]+m1[4], m1[1]*m2[4]+m1[3]*m2[5]+m1[5]
  ];
}

function matApply(m: number[], x: number, y: number): Point {
  return { x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] };
}

// ── PDF extraction ──
export async function extractFromPdf(file: File): Promise<ECGData | null> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  return extract(page, file.name);
}

async function extract(pg: PDFPageProxy, fn: string): Promise<ECGData | null> {
  const vp = pg.getViewport({ scale: 1 });
  const ops = await pg.getOperatorList();
  const tc = await pg.getTextContent();

  const ap = parse(ops, vp);

  const lb: Label[] = [];
  const seenLabels = new Set<string>();
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    const t = it.str.trim();
    if (ALL_LEAD_TOKENS.includes(t)) {
      const normalized = LEAD_ALIASES[t] || t;
      if (seenLabels.has(normalized)) continue;
      seenLabels.add(normalized);
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      lb.push({ text: normalized, x, y });
    }
  }

  const tr = idTraces(ap);
  if (!tr.length) return null;

  const sc = computeScaleFromCalibration(ap, vp) || computeScale(vp);
  const lay = detectLayout(tr, vp);
  const ch = assign(tr, lb, lay);

  return {
    manufacturer: detectMfr(tr, fn),
    layout: lay.type,
    filename: fn,
    page_size: { width: Math.round(vp.width), height: Math.round(vp.height) },
    scale: { mm_per_s: 25, mm_per_mV: 10, pts_per_mm: Math.round(sc.pmm * 100) / 100 },
    channels: ch.map(c => {
      const s = toPhysical(c.pts, sc, lay);
      let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
      for (const p of c.pts) {
        if (p.x < bx0) bx0 = p.x; if (p.x > bx1) bx1 = p.x;
        if (p.y < by0) by0 = p.y; if (p.y > by1) by1 = p.y;
      }
      return {
        name: c.name, samples: s.samples, duration_s: s.dur,
        sample_rate_hz: s.samples.length > 1 ? Math.round(s.samples.length / s.dur) : 0,
        voltage_unit: 'mV', time_unit: 's',
        bbox: { x0: bx0, x1: bx1, y0: by0, y1: by1 },
      };
    }),
  };
}

// ── Parse paths with CTM tracking ──
function parse(ops: { fnArray: number[]; argsArray: unknown[][] }, vp: { transform: number[]; width: number; height: number }): Polyline[] {
  const vpT = vp.transform;
  const withCTM = parseWithCTM(ops, vpT);

  const margin = Math.max(vp.width, vp.height) * 0.5;
  const bounds = { xMin: -margin, xMax: vp.width + margin, yMin: -margin, yMax: vp.height + margin };

  let inBounds = 0, total = 0;
  for (const p of withCTM) {
    for (const pt of p.pts) {
      total++;
      if (pt.x >= bounds.xMin && pt.x <= bounds.xMax && pt.y >= bounds.yMin && pt.y <= bounds.yMax) inBounds++;
    }
    if (total > 500) break;
  }

  if (total > 0 && inBounds / total > 0.5) return withCTM;

  console.log('[ECG] CTM tracking gave out-of-bounds coords, falling back to viewport-only');
  return parseViewportOnly(ops, vpT);
}

function parseWithCTM(ops: { fnArray: number[]; argsArray: unknown[][] }, vpT: number[]): Polyline[] {
  const P: Polyline[] = [];
  let c: Point[] = [], col = [0, 0, 0], w = 1;
  let ctm = [1, 0, 0, 1, 0, 0];
  const ctmStack: number[][] = [];

  const fullT = () => matMul(vpT, ctm);
  const fl = () => { if (c.length > 1) P.push({ pts: [...c], col: [...col], w }); c = []; };
  const addPt = (ux: number, uy: number) => { c.push(matApply(fullT(), ux, uy)); };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i], a = ops.argsArray[i] as number[];
    switch (f) {
      case OPS.save: ctmStack.push([...ctm]); break;
      case OPS.restore: if (ctmStack.length) ctm = ctmStack.pop()!; break;
      case OPS.transform: ctm = matMul(ctm, a); break;
      case OPS.setStrokeRGBColor: col = [a[0], a[1], a[2]]; break;
      case OPS.setStrokeGray: col = [a[0], a[0], a[0]]; break;
      case OPS.setLineWidth: w = a[0]; break;
      case OPS.moveTo: fl(); addPt(a[0], a[1]); break;
      case OPS.lineTo: addPt(a[0], a[1]); break;
      case OPS.stroke: case OPS.closeStroke: case OPS.fillStroke: fl(); break;
      case OPS.endPath: case OPS.fill: case OPS.eoFill: c = []; break;
      case OPS.constructPath: {
        const s = (a as unknown as [number[], number[]])[0];
        const sa = (a as unknown as [number[], number[]])[1];
        let ai = 0;
        for (const op of s) {
          switch (op) {
            case OPS.moveTo: fl(); addPt(sa[ai++], sa[ai++]); break;
            case OPS.lineTo: addPt(sa[ai++], sa[ai++]); break;
            case OPS.curveTo: ai += 4; addPt(sa[ai++], sa[ai++]); break;
            case OPS.curveTo2: case OPS.curveTo3: ai += 2; addPt(sa[ai++], sa[ai++]); break;
            case OPS.rectangle: ai += 4; c = []; break;
          }
        }
        break;
      }
    }
  }
  fl();
  return P;
}

function parseViewportOnly(ops: { fnArray: number[]; argsArray: unknown[][] }, vpT: number[]): Polyline[] {
  const P: Polyline[] = [];
  let c: Point[] = [], col = [0, 0, 0], w = 1;

  const fl = () => { if (c.length > 1) P.push({ pts: [...c], col: [...col], w }); c = []; };
  const addPt = (ux: number, uy: number) => { c.push(matApply(vpT, ux, uy)); };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i], a = ops.argsArray[i] as number[];
    switch (f) {
      case OPS.setStrokeRGBColor: col = [a[0], a[1], a[2]]; break;
      case OPS.setStrokeGray: col = [a[0], a[0], a[0]]; break;
      case OPS.setLineWidth: w = a[0]; break;
      case OPS.moveTo: fl(); addPt(a[0], a[1]); break;
      case OPS.lineTo: addPt(a[0], a[1]); break;
      case OPS.stroke: case OPS.closeStroke: case OPS.fillStroke: fl(); break;
      case OPS.endPath: case OPS.fill: case OPS.eoFill: c = []; break;
      case OPS.constructPath: {
        const s = (a as unknown as [number[], number[]])[0];
        const sa = (a as unknown as [number[], number[]])[1];
        let ai = 0;
        for (const op of s) {
          switch (op) {
            case OPS.moveTo: fl(); addPt(sa[ai++], sa[ai++]); break;
            case OPS.lineTo: addPt(sa[ai++], sa[ai++]); break;
            case OPS.curveTo: ai += 4; addPt(sa[ai++], sa[ai++]); break;
            case OPS.curveTo2: case OPS.curveTo3: ai += 2; addPt(sa[ai++], sa[ai++]); break;
            case OPS.rectangle: ai += 4; c = []; break;
          }
        }
        break;
      }
    }
  }
  fl();
  return P;
}

function idTraces(P: Polyline[]): Polyline[] {
  let candidates = P.filter(p => p.col[0] < 0.15 && p.col[1] < 0.15 && p.col[2] < 0.15 && p.pts.length > 50);
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.pts.length - a.pts.length);
  const mx = candidates[0].pts.length;
  candidates = candidates.filter(p => p.pts.length >= mx * 0.15);

  for (const t of candidates) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of t.pts) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    t.bb = { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, dx: x1 - x0, dy: y1 - y0 };
  }
  return candidates.slice(0, 15);
}

function detectLayout(tr: Polyline[], vp: { width: number; height: number }): Layout {
  let xMonoCount = 0, yMonoCount = 0;
  for (const t of tr) {
    const pts = t.pts;
    let xMono = true, yMonoInc = true, yMonoDec = true;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x < pts[i - 1].x - 0.5) xMono = false;
      if (pts[i].y < pts[i - 1].y - 0.5) yMonoInc = false;
      if (pts[i].y > pts[i - 1].y + 0.5) yMonoDec = false;
    }
    if (xMono) xMonoCount++;
    if (yMonoInc || yMonoDec) yMonoCount++;
  }

  let tA: 'x' | 'y', vI: boolean;
  if (xMonoCount >= tr.length * 0.8) {
    tA = 'x'; vI = true;
  } else if (yMonoCount >= tr.length * 0.8) {
    tA = 'y'; vI = true;
  } else {
    const adx = tr.reduce((s, t) => s + t.bb!.dx, 0) / tr.length;
    const ady = tr.reduce((s, t) => s + t.bb!.dy, 0) / tr.length;
    tA = adx >= ady ? 'x' : 'y';
    vI = tA === 'x';
  }

  const timeExtent = tA === 'x' ? vp.width : vp.height;
  const allWide = tr.every(t => (tA === 'x' ? t.bb!.dx : t.bb!.dy) > timeExtent * 0.6);

  // Detect 4×3 grid: group traces by X center into columns
  if (tA === 'x' && tr.length >= 12) {
    const cxVals = tr.map(t => t.bb!.cx).sort((a, b) => a - b);
    const cols = clusterValues(cxVals, vp.width * 0.1);
    const cyVals = tr.map(t => t.bb!.cy).sort((a, b) => a - b);
    const rows = clusterValues(cyVals, vp.height * 0.08);
    if (cols.length >= 4 && rows.length >= 3) {
      return { type: 'grid_4x3', tA, vI };
    }
  }

  const perpVals = tr.map(t => t.bb!.cy);
  const perpMin = Math.min(...perpVals), perpMax = Math.max(...perpVals);
  const perpMid = (perpMin + perpMax) / 2;
  const grp1 = tr.filter(t => t.bb!.cy < perpMid);
  const grp2 = tr.filter(t => t.bb!.cy >= perpMid);

  // All traces span most of the page width → stacked vertically, not side by side
  if (allWide) return { type: 'stacked_12x1', tA, vI };

  if (grp1.length >= 4 && grp2.length >= 4 && grp1.length <= 8 && grp2.length <= 8) {
    return { type: 'sequential_6x2', tA, vI };
  }
  return { type: 'stacked_12x1', tA, vI };
}

// Group sorted values into clusters separated by gaps > threshold
function clusterValues(sorted: number[], threshold: number): number[][] {
  if (!sorted.length) return [];
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > threshold) clusters.push([sorted[i]]);
    else clusters[clusters.length - 1].push(sorted[i]);
  }
  return clusters;
}

type AssignResult = { name: string; pts: Point[]; baselineY?: number };

function assign(tr: Polyline[], lb: Label[], lay: Layout): AssignResult[] {
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
    return assignGrid4x3(tr, lb, vK);
  }

  const cyVals = tr.map(t => t.bb!.cy);
  const cyMid = (Math.min(...cyVals) + Math.max(...cyVals)) / 2;
  const g1 = tr.filter(t => t.bb!.cy < cyMid).sort((a, b) => a.bb!.cx - b.bb!.cx);
  const g2 = tr.filter(t => t.bb!.cy >= cyMid).sort((a, b) => a.bb!.cx - b.bb!.cx);

  let l1: Label[], l2: Label[];
  if (lb.length >= 12) {
    const labelYs = lb.map(l => l.y);
    const labelMid = (Math.min(...labelYs) + Math.max(...labelYs)) / 2;
    l1 = lb.filter(l => l.y < labelMid).sort((a, b) => a.x - b.x);
    l2 = lb.filter(l => l.y >= labelMid).sort((a, b) => a.x - b.x);
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

// 4×3 grid: 4 columns (I/aVR/V1/V4, II/aVL/V2/V5, III/aVF/V3/V6) × 3 rows + optional rhythm strip
function assignGrid4x3(tr: Polyline[], lb: Label[], vK: string): AssignResult[] {
  // Separate rhythm strip (full-width trace spanning most of the page)
  const widths = tr.map(t => t.bb!.dx);
  const medWidth = [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)];
  const rhythmThreshold = medWidth * 1.8;
  const rhythm = tr.filter(t => t.bb!.dx > rhythmThreshold);
  const grid = tr.filter(t => t.bb!.dx <= rhythmThreshold);

  // Cluster grid traces into columns by cx
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

  // Sort each column by cy (top to bottom)
  for (const col of colGroups) col.sort((a, b) => a.bb!.cy - b.bb!.cy);

  // Standard 4×3 grid order: col0=[I,II,III], col1=[aVR,aVL,aVF], col2=[V1,V2,V3], col3=[V4,V5,V6]
  const gridOrder = [
    ['I','II','III'], ['aVR','aVL','aVF'], ['V1','V2','V3'], ['V4','V5','V6'],
  ];

  const ch: AssignResult[] = [];

  // Try label-based matching first: find the closest label for each trace
  if (lb.length >= 12) {
    for (const t of [...grid, ...rhythm]) {
      let bestLabel: Label | null = null, bestDist = Infinity;
      for (const l of lb) {
        const dx = l.x - t.bb!.x0;
        const dy = l.y - t.bb!.y0;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) { bestDist = dist; bestLabel = l; }
      }
      const usedNames = ch.map(c => c.name);
      const name = bestLabel ? (usedNames.includes(bestLabel.text) ? bestLabel.text + '_rhythm' : bestLabel.text) : `L${ch.length + 1}`;
      ch.push({ name, pts: t.pts, baselineY: bestLabel?.[vK as keyof Label] as number | undefined });
    }
  } else {
    // Positional assignment — no label positions available
    for (let ci = 0; ci < colGroups.length && ci < gridOrder.length; ci++) {
      for (let ri = 0; ri < colGroups[ci].length && ri < gridOrder[ci].length; ri++) {
        ch.push({ name: gridOrder[ci][ri], pts: colGroups[ci][ri].pts });
      }
    }
    for (const t of rhythm) {
      ch.push({ name: 'II_rhythm', pts: t.pts });
    }
  }

  // Sort by standard lead order
  ch.sort((a, b) => {
    const na = a.name.replace('_rhythm', ''), nb = b.name.replace('_rhythm', '');
    const ia = LEAD_NAMES.indexOf(na), ib = LEAD_NAMES.indexOf(nb);
    const oa = ia < 0 ? 99 : ia, ob = ib < 0 ? 99 : ib;
    if (oa !== ob) return oa - ob;
    return a.name.includes('_rhythm') ? 1 : -1;
  });
  return ch;
}

function detectMfr(tr: Polyline[], fn: string): string {
  const f = fn.toLowerCase();
  if (f.startsWith('ek_') || f.includes('mortara') || f.includes('burdick')) return 'Mortara/Burdick';
  if (f.includes('muse') || f.includes('12sl')) return 'GE MUSE';
  if (f.includes('schiller') || f.includes('scm') || f.includes('nodata')) return 'Schiller';
  const a = tr.reduce((s, t) => s + t.pts.length, 0) / tr.length;
  if (a > 3000) return 'Philips/Spacelabs';
  if (a > 1500) return 'GE MUSE (probable)';
  if (a < 600) return 'Schiller (probable)';
  return 'Inconnu';
}

function computeScale(vp: { width: number; height: number }): ScaleInfo {
  const w = vp.width, h = vp.height;
  const maxDim = Math.max(w, h), minDim = Math.min(w, h);
  let wm: number, hm: number;
  if (Math.abs(maxDim - 842) < 10 && Math.abs(minDim - 595) < 10) { wm = 297; hm = 210; }
  else if (Math.abs(maxDim - 792) < 10 && Math.abs(minDim - 612) < 10) { wm = 279.4; hm = 215.9; }
  else { wm = w / 2.8346; hm = h / 2.8346; }

  const pmmX = w / (w >= h ? wm : hm);
  const pmmY = h / (w >= h ? hm : wm);
  const pmm = (pmmX + pmmY) / 2;
  return { pmm, pps: pmm * 25, ppv: pmm * 10, pmmX, pmmY };
}

// Try to extract scale from calibration pulses (rectangular 1mV pulses at end of traces)
function computeScaleFromCalibration(P: Polyline[], _vp: { width: number; height: number }): ScaleInfo | null {
  // Look for small black drawings with exactly 6 line segments (calibration pulse shape)
  const calCandidates = P.filter(p =>
    p.col[0] < 0.15 && p.col[1] < 0.15 && p.col[2] < 0.15 &&
    p.pts.length >= 4 && p.pts.length <= 10
  );

  for (const cal of calCandidates) {
    const ys = cal.pts.map(p => p.y);
    const dy = Math.max(...ys) - Math.min(...ys);
    const xs = cal.pts.map(p => p.x);
    const dx = Math.max(...xs) - Math.min(...xs);
    // Calibration pulse: tall and narrow (height >> width), height = 1mV = 10mm
    if (dy > 20 && dy < 200 && dx < dy * 1.5 && dx > 5) {
      const ppv = dy; // points per mV
      const pmmY = ppv / 10;
      const pmmX = pmmY; // assume isotropic
      const pmm = (pmmX + pmmY) / 2;
      return { pmm, pps: pmm * 25, ppv, pmmX, pmmY };
    }
  }
  return null;
}

function toPhysical(pts: Point[], sc: ScaleInfo, lay: Layout): { samples: number[]; dur: number } {
  if (pts.length < 2) return { samples: [], dur: 0 };
  const tA = lay.tA, vK = tA === 'x' ? 'y' : 'x';
  const ppsAxis = tA === 'x' ? sc.pmmX * 25 : sc.pmmY * 25;
  const ppvAxis = vK === 'y' ? sc.pmmY * 10 : sc.pmmX * 10;

  const s = [...pts].sort((a, b) => a[tA] - b[tA]);

  if (pts.length > 10) {
    const firstT = pts[0][tA], lastT = pts[pts.length - 1][tA];
    if (firstT > lastT + 1) s.reverse();
  }

  const dur = Math.abs(s[s.length - 1][tA] - s[0][tA]) / ppsAxis;

  // Baseline = mode of voltage-axis values (most frequent Y value).
  // Between heartbeats, the signal sits on the isoelectric line — the Y value
  // that appears most often. This is more accurate than the median (pulled by
  // large QRS complexes) or label position (offset from the grid line).
  const ref = computeMode(s.map(p => p[vK]), 0.5);

  const samples = s.map(p => {
    let mv = (p[vK] - ref) / ppvAxis;
    if (lay.vI) mv = -mv;
    return Math.round(mv * 10000) / 10000;
  });
  return { samples, dur };
}

// Compute mode (most frequent value) using a histogram with given bin size
function computeMode(values: number[], binSize: number): number {
  const hist: Record<number, number> = {};
  for (const v of values) {
    const bin = Math.round(v / binSize) * binSize;
    hist[bin] = (hist[bin] || 0) + 1;
  }
  let bestBin = 0, bestCount = 0;
  for (const bin in hist) {
    if (hist[bin] > bestCount) { bestCount = hist[bin]; bestBin = parseFloat(bin); }
  }
  return bestBin;
}

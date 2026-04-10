import type { Point, Polyline } from '../types';
import { OPS } from './constants';

// Normalize an RGB color to [0, 1] range. pdfjs sometimes returns colors in
// [0, 255] range (e.g. for matplotlib-generated PDFs) — detect this by checking
// if any component is > 1 and divide by 255 in that case.
function normalizeColor(c: number[]): number[] {
  if (c[0] > 1 || c[1] > 1 || c[2] > 1) {
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }
  return c;
}

// 6-element affine matrix: [a, b, c, d, e, f]
// Transforms (x, y) → (a*x + c*y + e, b*x + d*y + f)
export function matMul(m1: number[], m2: number[]): number[] {
  return [
    m1[0]*m2[0]+m1[2]*m2[1],       m1[1]*m2[0]+m1[3]*m2[1],
    m1[0]*m2[2]+m1[2]*m2[3],       m1[1]*m2[2]+m1[3]*m2[3],
    m1[0]*m2[4]+m1[2]*m2[5]+m1[4], m1[1]*m2[4]+m1[3]*m2[5]+m1[5]
  ];
}

export function matApply(m: number[], x: number, y: number): Point {
  return { x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] };
}

// Parse PDF operator list into polylines. Tries CTM tracking first;
// falls back to viewport-only if most points land out of bounds.
export function parse(ops: { fnArray: number[]; argsArray: unknown[][] }, vp: { transform: number[]; width: number; height: number }): Polyline[] {
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
      case OPS.setStrokeRGBColor: col = normalizeColor([a[0], a[1], a[2]]); break;
      case OPS.setStrokeGray: col = normalizeColor([a[0], a[0], a[0]]); break;
      // SC/SCN operators (DeviceRGB CS then SC r g b) → pdfjs emits setStrokeColorN
      case OPS.setStrokeColorN:
        if (a.length >= 3) col = normalizeColor([a[0], a[1], a[2]]);
        else if (a.length === 1) col = normalizeColor([a[0], a[0], a[0]]);
        break;
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
      case OPS.setStrokeRGBColor: col = normalizeColor([a[0], a[1], a[2]]); break;
      case OPS.setStrokeGray: col = normalizeColor([a[0], a[0], a[0]]); break;
      case OPS.setStrokeColorN:
        if (a.length >= 3) col = normalizeColor([a[0], a[1], a[2]]);
        else if (a.length === 1) col = normalizeColor([a[0], a[0], a[0]]);
        break;
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

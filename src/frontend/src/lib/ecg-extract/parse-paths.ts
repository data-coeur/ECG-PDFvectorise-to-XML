// 01  parse-paths — turn pdfjs's flat operator list into our internal
// polyline structure (each polyline = colour + width + array of points
// in viewport coordinates).
//
// pdfjs gives us paths as `moveTo / lineTo / curveTo / stroke` operators
// expressed in user-space coordinates relative to the current
// transformation matrix (CTM). We track the CTM and apply it (combined
// with the page's viewport transform) so every emitted point is already
// in viewport coordinates.
//
// Two parse strategies:
//   parseWithCTM         the default — honours `q / Q / cm` operators
//   parseViewportOnly    fallback when CTM tracking yields out-of-bounds
//                        points (some PDFs use the operator list in
//                        non-standard ways)

import type { Point, Polyline } from '../types';
import { OPS } from '../pdf-config';
import { normalizeColor } from './polyline-utils';

// 6-element affine matrix [a, b, c, d, e, f] applied as
//   (x, y) → (a*x + c*y + e, b*x + d*y + f)
export function matMul(m1: number[], m2: number[]): number[] {
  return [
    m1[0]*m2[0]+m1[2]*m2[1],       m1[1]*m2[0]+m1[3]*m2[1],
    m1[0]*m2[2]+m1[2]*m2[3],       m1[1]*m2[2]+m1[3]*m2[3],
    m1[0]*m2[4]+m1[2]*m2[5]+m1[4], m1[1]*m2[4]+m1[3]*m2[5]+m1[5],
  ];
}

export function matApply(m: number[], x: number, y: number): Point {
  return { x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] };
}

export function parse(
  ops: { fnArray: number[]; argsArray: unknown[][] },
  viewport: { transform: number[]; width: number; height: number },
): Polyline[] {
  const viewportTransform = viewport.transform;
  const withCTM = parseWithCTM(ops, viewportTransform);

  // Sample up to 500 points to check whether CTM-tracked output landed
  // inside the page; if not, the PDF likely uses operators in a way our
  // tracker doesn't expect, and parsing in viewport-only mode is safer.
  const margin = Math.max(viewport.width, viewport.height) * 0.5;
  const bounds = {
    xMin: -margin, xMax: viewport.width + margin,
    yMin: -margin, yMax: viewport.height + margin,
  };
  let inBounds = 0, total = 0;
  for (const poly of withCTM) {
    for (const pt of poly.pts) {
      total++;
      if (pt.x >= bounds.xMin && pt.x <= bounds.xMax && pt.y >= bounds.yMin && pt.y <= bounds.yMax) inBounds++;
    }
    if (total > 500) break;
  }
  if (total > 0 && inBounds / total > 0.5) return withCTM;

  console.log('[ECG] CTM tracking gave out-of-bounds coords, falling back to viewport-only');
  return parseViewportOnly(ops, viewportTransform);
}

function parseWithCTM(
  ops: { fnArray: number[]; argsArray: unknown[][] },
  viewportTransform: number[],
): Polyline[] {
  const polylines: Polyline[] = [];
  let current: Point[] = [];
  let color = [0, 0, 0];
  let width = 1;
  let ctm = [1, 0, 0, 1, 0, 0];
  const ctmStack: number[][] = [];

  const fullTransform = () => matMul(viewportTransform, ctm);
  const flush = () => {
    if (current.length > 1) polylines.push({ pts: [...current], col: [...color], w: width });
    current = [];
  };
  const addPoint = (userX: number, userY: number) => {
    current.push(matApply(fullTransform(), userX, userY));
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i];
    const args = ops.argsArray[i] as number[];
    switch (op) {
      case OPS.save: ctmStack.push([...ctm]); break;
      case OPS.restore: if (ctmStack.length) ctm = ctmStack.pop()!; break;
      case OPS.transform: ctm = matMul(ctm, args); break;
      case OPS.setStrokeRGBColor: color = normalizeColor([args[0], args[1], args[2]]); break;
      case OPS.setStrokeGray: color = normalizeColor([args[0], args[0], args[0]]); break;
      // SC/SCN operators (DeviceRGB CS then SC r g b) → pdfjs emits setStrokeColorN
      case OPS.setStrokeColorN:
        if (args.length >= 3) color = normalizeColor([args[0], args[1], args[2]]);
        else if (args.length === 1) color = normalizeColor([args[0], args[0], args[0]]);
        break;
      case OPS.setLineWidth: width = args[0]; break;
      case OPS.moveTo: flush(); addPoint(args[0], args[1]); break;
      case OPS.lineTo: addPoint(args[0], args[1]); break;
      case OPS.stroke: case OPS.closeStroke: case OPS.fillStroke: flush(); break;
      case OPS.endPath: case OPS.fill: case OPS.eoFill: current = []; break;
      case OPS.constructPath: {
        const subOps = (args as unknown as [number[], number[]])[0];
        const subArgs = (args as unknown as [number[], number[]])[1];
        let argIdx = 0;
        for (const subOp of subOps) {
          switch (subOp) {
            case OPS.moveTo: flush(); addPoint(subArgs[argIdx++], subArgs[argIdx++]); break;
            case OPS.lineTo: addPoint(subArgs[argIdx++], subArgs[argIdx++]); break;
            case OPS.curveTo: argIdx += 4; addPoint(subArgs[argIdx++], subArgs[argIdx++]); break;
            case OPS.curveTo2: case OPS.curveTo3: argIdx += 2; addPoint(subArgs[argIdx++], subArgs[argIdx++]); break;
            case OPS.rectangle: argIdx += 4; current = []; break;
          }
        }
        break;
      }
    }
  }
  flush();
  return polylines;
}

function parseViewportOnly(
  ops: { fnArray: number[]; argsArray: unknown[][] },
  viewportTransform: number[],
): Polyline[] {
  const polylines: Polyline[] = [];
  let current: Point[] = [];
  let color = [0, 0, 0];
  let width = 1;

  const flush = () => {
    if (current.length > 1) polylines.push({ pts: [...current], col: [...color], w: width });
    current = [];
  };
  const addPoint = (userX: number, userY: number) => {
    current.push(matApply(viewportTransform, userX, userY));
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i];
    const args = ops.argsArray[i] as number[];
    switch (op) {
      case OPS.setStrokeRGBColor: color = normalizeColor([args[0], args[1], args[2]]); break;
      case OPS.setStrokeGray: color = normalizeColor([args[0], args[0], args[0]]); break;
      case OPS.setStrokeColorN:
        if (args.length >= 3) color = normalizeColor([args[0], args[1], args[2]]);
        else if (args.length === 1) color = normalizeColor([args[0], args[0], args[0]]);
        break;
      case OPS.setLineWidth: width = args[0]; break;
      case OPS.moveTo: flush(); addPoint(args[0], args[1]); break;
      case OPS.lineTo: addPoint(args[0], args[1]); break;
      case OPS.stroke: case OPS.closeStroke: case OPS.fillStroke: flush(); break;
      case OPS.endPath: case OPS.fill: case OPS.eoFill: current = []; break;
      case OPS.constructPath: {
        const subOps = (args as unknown as [number[], number[]])[0];
        const subArgs = (args as unknown as [number[], number[]])[1];
        let argIdx = 0;
        for (const subOp of subOps) {
          switch (subOp) {
            case OPS.moveTo: flush(); addPoint(subArgs[argIdx++], subArgs[argIdx++]); break;
            case OPS.lineTo: addPoint(subArgs[argIdx++], subArgs[argIdx++]); break;
            case OPS.curveTo: argIdx += 4; addPoint(subArgs[argIdx++], subArgs[argIdx++]); break;
            case OPS.curveTo2: case OPS.curveTo3: argIdx += 2; addPoint(subArgs[argIdx++], subArgs[argIdx++]); break;
            case OPS.rectangle: argIdx += 4; current = []; break;
          }
        }
        break;
      }
    }
  }
  flush();
  return polylines;
}

// Detect content-stream rotation (90 / 180 / 270°) by analysing the
// monotonicity of the longest dark polylines, then rotate every polyline so
// that downstream stages — which all assume time runs along x — can stay
// unchanged.
//
// This is content-based: we never look at the page /Rotate metadata, nor at
// the manufacturer profile. A user-rotated MUSE PDF and a landscape Mortara
// take the exact same code path.

import type { Point, Polyline } from '../types';

export interface VpDims { width: number; height: number; }

export interface RectifiedOrientation {
  polylines: Polyline[];
  vp: VpDims;
  rotation: 0 | 90 | 180 | 270;
}

// Rotate a point inside a (w × h) box by `rot` degrees clockwise.
// After rotation, the coordinates land in:
//   - 90 / 270:  (h × w) box
//   - 180:       (w × h) box
export function rotatePoint(p: Point, rot: 0 | 90 | 180 | 270, w: number, h: number): Point {
  switch (rot) {
    case 0:   return p;
    case 90:  return { x: h - p.y, y: p.x };       // 90° CW
    case 180: return { x: w - p.x, y: h - p.y };
    case 270: return { x: p.y, y: w - p.x };       // 90° CCW (= 270° CW)
  }
}

// Score a candidate rotation by counting how many traces become x-monotonic.
function scoreRotation(rot: 0 | 90 | 180 | 270, traces: Polyline[], w: number, h: number): number {
  const TOL = 1.0; // pt — absorbs the small backtracks of real ECG traces
  let mono = 0;
  for (const t of traces) {
    let lastX = -Infinity;
    let ok = true;
    for (const pt of t.pts) {
      const r = rotatePoint(pt, rot, w, h);
      if (r.x < lastX - TOL) { ok = false; break; }
      lastX = r.x;
    }
    if (ok) mono++;
  }
  return mono;
}

export function rectifyOrientation(polylines: Polyline[], vp: VpDims): RectifiedOrientation {
  // Pick the longest dark polylines as signal-trace candidates. We don't
  // need them to actually be ECG traces — any vector path long enough to
  // measure orientation works.
  const candidates = polylines
    .filter(p => p.col[0] < 0.4 && p.col[1] < 0.4 && p.col[2] < 0.4 && p.pts.length >= 50)
    .slice()
    .sort((a, b) => b.pts.length - a.pts.length)
    .slice(0, 30);

  if (candidates.length < 4) return { polylines, vp, rotation: 0 };

  const score0 = scoreRotation(0, candidates, vp.width, vp.height);
  const score90 = scoreRotation(90, candidates, vp.width, vp.height);
  const score180 = scoreRotation(180, candidates, vp.width, vp.height);
  const score270 = scoreRotation(270, candidates, vp.width, vp.height);

  // Conservative selection: only commit to a non-zero rotation if it is
  // *clearly* better than no rotation. This avoids false positives on noisy
  // landscape ECGs where a few traces happen to be roughly y-monotonic too.
  let best: 0 | 90 | 180 | 270 = 0;
  let bestScore = score0;
  const minMargin = score0 * 1.5;
  const minAbsolute = Math.max(4, candidates.length / 2);

  for (const [rot, sc] of [[90, score90], [180, score180], [270, score270]] as const) {
    if (sc >= minAbsolute && sc > minMargin && sc > bestScore) {
      bestScore = sc;
      best = rot;
    }
  }

  if (best === 0) return { polylines, vp, rotation: 0 };

  const rotated: Polyline[] = polylines.map(p => ({
    ...p,
    pts: p.pts.map(pt => rotatePoint(pt, best, vp.width, vp.height)),
  }));
  const newVp: VpDims = (best === 90 || best === 270)
    ? { width: vp.height, height: vp.width }
    : { width: vp.width, height: vp.height };

  console.log(`[ECG] Detected ${best}° content rotation — polylines normalized (${bestScore}/${candidates.length} monotonic, baseline ${score0})`);
  return { polylines: rotated, vp: newVp, rotation: best };
}

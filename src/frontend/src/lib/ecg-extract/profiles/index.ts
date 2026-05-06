// ── Manufacturer profile system ──
//
// Each ECG manufacturer (GE MUSE, Schiller, Mortara...) has different PDF
// characteristics. A profile defines the thresholds used by each pipeline step.
// Manufacturer-specific overrides live in profiles/manufacturers/.

import type { Polyline } from '../../types';
import { GE_MUSE } from './manufacturers/ge-muse';
import { SCHILLER } from './manufacturers/schiller';
import { SCHILLER_CS } from './manufacturers/schiller-cs';
import { MORTARA_BURDICK } from './manufacturers/mortara-burdick';
import { PTBXL } from './manufacturers/ptbxl';
import { VECTRACOR } from './manufacturers/vectracor';

// ── Types ──

export interface ManufacturerProfile {
  name: string;

  trace: {
    blackThreshold: number;       // max RGB component to count as "black" (default: 0.15)
    minPoints: number;            // min points per trace (default: 50)
    minSizeRatio: number;         // min size vs largest trace (default: 0.15)
    maxTraces: number;            // max traces to keep (default: 15)
  };

  grid: {
    lineStraightness: number;     // max perpendicular spread for a "line" (default: 1.5)
    minHLineFraction: number;     // min H line length as fraction of page width (default: 0.15)
    minVLineFraction: number;     // min V line length as fraction of page height (default: 0.15)
    dedupDistance: number;        // cluster radius for dedup (default: 0.8)
    majorGridThreshold: number;   // above this spacing, divide by 5 (default: 8)
    minLineCount: number;         // min H and V lines for valid grid (default: 3)
  };

  calibration: {
    minPoints: number;            // min points in calibration pulse (default: 4)
    maxPoints: number;            // max points in calibration pulse (default: 100)
    heightTolerance: number;      // tolerance on 1mV height (default: 0.15)
  };

  layout: {
    monotonicityThreshold: number;   // fraction of traces that must be monotonic (default: 0.8)
    monotonicityTolerance: number;   // pts tolerance in check (default: 0.5)
    colClusterFraction: number;      // cx clustering threshold (default: 0.10)
    rowClusterFraction: number;      // cy clustering threshold (default: 0.08)
    wideTraceFraction: number;       // trace wider than this = "allWide" (default: 0.6)
    expectedLayout?: 'stacked_12x1' | 'sequential_6x2' | 'grid_4x3';
  };

  leads: {
    extraAliases: Record<string, string>;  // additional label aliases
    gridOrder: string[][];                  // column order for grid_4x3
    rhythmStripWidthRatio: number;          // rhythm strip detection (default: 1.8)
  };

  // Optional post-processing hook applied between parse and findSignalTraces. Used by
  // manufacturers whose PDFs need non-trivial polyline rewriting (e.g. Vectracor-
  // style per-segment subpaths that must be fused into continuous traces).
  // Keep exotic manufacturer code in profiles/manufacturers/*.ts — this hook
  // exists so the main pipeline doesn't have to know about these edge cases.
  postProcessPolylines?: (P: Polyline[]) => Polyline[];

  // When set, bypass the content-based rotation detection in
  // rectifyOrientation and apply this fixed rotation instead. Useful for
  // manufacturers whose page orientation is always the same but whose pages
  // may contain only 1-2 traces (not enough for the generic detector to
  // score reliably). Vectracor always draws portrait with time flowing
  // down the page → forceRotation: 90.
  forceRotation?: 0 | 90 | 180 | 270;
}

export type DeepPartial<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]?: T[K] extends (...args: any[]) => unknown
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

// ── Default profile (all current hardcoded values) ──

const DEFAULT_PROFILE: ManufacturerProfile = {
  name: 'Unknown',

  trace: { blackThreshold: 0.15, minPoints: 50, minSizeRatio: 0.15, maxTraces: 15 },

  grid: {
    lineStraightness: 1.5, minHLineFraction: 0.15, minVLineFraction: 0.15,
    dedupDistance: 0.8, majorGridThreshold: 8, minLineCount: 3,
  },

  calibration: { minPoints: 4, maxPoints: 100, heightTolerance: 0.15 },

  layout: {
    monotonicityThreshold: 0.8, monotonicityTolerance: 0.5,
    colClusterFraction: 0.10, rowClusterFraction: 0.08, wideTraceFraction: 0.6,
  },

  leads: {
    extraAliases: {},
    gridOrder: [['I','II','III'], ['aVR','aVL','aVF'], ['V1','V2','V3'], ['V4','V5','V6']],
    rhythmStripWidthRatio: 1.8,
  },
};

// ── Detection & resolution ──

// Detect manufacturer from PDF content (not filename).
// Cascade: metadata → page size → grid color signature → unknown.
export function detectManufacturer(
  info: Record<string, string> | null,
  pageSize: { width: number; height: number },
  polylines: Polyline[],
): string {
  // 1. Metadata (most reliable when present)
  const producer = (info?.Producer || '').toLowerCase();
  const creator = (info?.Creator || '').toLowerCase();
  const author = (info?.Author || '').toLowerCase();
  const meta = producer + ' ' + creator + ' ' + author;

  if (meta.includes('muse')) return 'GE MUSE';
  if (meta.includes('matplotlib')) return 'PTB-XL';

  // 2. Page size (Mortara uses very large pages > 2000 pts)
  const maxDim = Math.max(pageSize.width, pageSize.height);
  if (maxDim > 2000) return 'Mortara/Burdick';

  // 2b. Per-segment subpath format (Vectracor, some Philips/Cardioline
  // exports): the signal is drawn as thousands of 2-point subpaths. Normal
  // clinical ECGs have at most a few hundred polylines, so a count above
  // ~3000 combined with >80% being 2-point is a very specific fingerprint.
  if (polylines.length > 3000) {
    let twoPt = 0;
    for (const p of polylines) if (p.pts.length === 2) twoPt++;
    if (twoPt / polylines.length > 0.8) return 'Vectracor';
  }

  // 3. Grid color
  // Standard Schiller: pure red grid (R>0.9, G<0.1, B<0.1)
  const hasRedGrid = polylines.some(p =>
    p.col[0] > 0.9 && p.col[1] < 0.1 && p.col[2] < 0.1 && p.pts.length >= 2
  );
  if (hasRedGrid) return 'Schiller';

  // Schiller CS variant: pink grid (R~0.9, G~0.7, B~0.7) — uses CS/SC color ops
  const hasPinkGrid = polylines.some(p =>
    p.col[0] > 0.8 && p.col[1] > 0.5 && p.col[1] < 0.8 && p.col[2] > 0.5 && p.col[2] < 0.8 && p.pts.length >= 2
  );
  if (hasPinkGrid) return 'Schiller CS';

  return 'Unknown';
}

// Registry: manufacturer name → partial overrides
const REGISTRY: Record<string, DeepPartial<ManufacturerProfile>> = {
  'GE MUSE': GE_MUSE,
  'Schiller': SCHILLER,
  'Schiller CS': SCHILLER_CS,
  'Mortara/Burdick': MORTARA_BURDICK,
  'PTB-XL': PTBXL,
  'Vectracor': VECTRACOR,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(base: any, overrides: any): any {
  const result = { ...base };
  for (const key of Object.keys(overrides)) {
    const val = overrides[key];
    if (val !== undefined && typeof val === 'object' && !Array.isArray(val) && val !== null) {
      result[key] = deepMerge(base[key] ?? {}, val);
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

// Resolve a manufacturer name to a full profile (defaults + overrides)
export function resolveProfile(manufacturer: string): ManufacturerProfile {
  const overrides = REGISTRY[manufacturer];
  const profile: ManufacturerProfile = overrides
    ? deepMerge(DEFAULT_PROFILE, { ...overrides, name: manufacturer })
    : { ...DEFAULT_PROFILE, name: manufacturer };
  console.log(`[ECG] Using profile: ${profile.name}`);
  return profile;
}

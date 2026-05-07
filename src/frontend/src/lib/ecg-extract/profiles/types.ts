// profiles/types — interface ManufacturerProfile (toutes les molettes par
// fabricant : seuils traces, grille, calibration, layout, alias leads, hooks
// postProcessPolylines et forceRotation) + DEFAULT_PROFILE (valeurs canoniques)
// + utilitaire DeepPartial. Importé par registry.ts et tous les manufacturers/*.ts.
// Raison : un seul endroit pour documenter ce qu'un profil peut surcharger.

import type { Polyline } from '../../types';

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

  // Optional post-processing hook applied between parse and findSignalTraces.
  // Used by manufacturers whose PDFs need non-trivial polyline rewriting
  // (e.g. Vectracor-style per-segment subpaths that must be fused into
  // continuous traces). Keep exotic manufacturer code in
  // profiles/manufacturers/*.ts — this hook exists so the main pipeline
  // doesn't have to know about these edge cases.
  postProcessPolylines?: (P: Polyline[]) => Polyline[];

  // When set, bypass the content-based rotation detection in
  // rectifyOrientation and apply this fixed rotation instead. Useful for
  // manufacturers whose page orientation is always the same but whose
  // pages may contain only 1-2 traces (not enough for the generic
  // detector to score reliably). Vectracor always draws portrait with
  // time flowing down the page → forceRotation: 90.
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

// All profiles inherit these defaults; manufacturer files in
// profiles/manufacturers/*.ts only override the keys that differ.
export const DEFAULT_PROFILE: ManufacturerProfile = {
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

# `lib/ecg-extract/` — ECG signal extraction pipeline

Each PDF runs through 13 named stages, in the order they're called from
[`index.ts`](./index.ts). Open that file first if you want to see the
whole flow on one screen — the comments map every step to its file. This
README is the long-form companion: what each stage does, what it consumes,
what it produces, and where to look when something is off.

## The pipeline at a glance

```
        ┌─────────────────────────┐
PDF ──▶ │ 01  parse-paths         │ → polylines (color, width, points)
        │     parse-paths.ts      │
        ├─────────────────────────┤
        │ 02  detect-manufacturer │ → manufacturer name
        │     profiles/           │
        ├─────────────────────────┤
        │ 03  apply profile pre-  │ → polylines (after vendor weld /
        │     process             │    colour remap, e.g. Vectracor)
        │     profile.postProcess │
        ├─────────────────────────┤
        │ 04  rectify-orientation │ → polylines in time-on-X convention
        │     rectify-orientation │
        ├─────────────────────────┤
        │ 05  extract-text-labels │ → labels (I, II, V1...) with positions
        │     index.ts (inline)   │
        ├─────────────────────────┤
        │ 06  find-signal-traces  │ → 12 black trace polylines
        │     find-signal-traces  │
        ├─────────────────────────┤
        │ 07  extract-grid        │ → H/V grid line positions
        │     extract-grid.ts     │
        ├─────────────────────────┤
        │ 08  compute-scale       │ → pts/mm, pts/sec, pts/mV
        │     compute-scale.ts    │
        ├─────────────────────────┤
        │ 09  detect-layout       │ → 12×1 / 6×2 / grid_4x3
        │     detect-layout.ts    │
        ├─────────────────────────┤
        │ 10  pair-traces-with-   │ → trace ↔ lead name
        │     labels              │
        │     pair-traces-with-…  │
        ├─────────────────────────┤
        │ 11  find-baselines      │ → 0 mV reference per trace
        │     find-baselines.ts   │
        ├─────────────────────────┤
        │ 12  convert-to-mv       │ → samples in millivolts
        │     convert-to-mv.ts    │
        ├─────────────────────────┤
        │ 13  build rhythm strip  │ → cloned / repeated lead II if needed
        │     index.ts (inline)   │
        └─────────────────────────┘
                                  ↓
                              ECGData
```

## Stage details

| #  | File                          | In                                 | Out                                  |
|----|-------------------------------|------------------------------------|--------------------------------------|
| 01 | `parse-paths.ts`              | pdfjs operator list                | `Polyline[]`                         |
| 02 | `profiles/detect-manufacturer.ts` | metadata + viewport + polylines | manufacturer name string             |
| 03 | per-profile `postProcessPolylines` | `Polyline[]`                  | `Polyline[]` (rewritten)             |
| 04 | `rectify-orientation.ts`      | `Polyline[]` + viewport            | rotated `Polyline[]` + new viewport  |
| 05 | inline in `index.ts`          | pdfjs text content + rotation      | `Label[]`                            |
| 06 | `find-signal-traces.ts`       | `Polyline[]` + profile             | `Polyline[]` (12 traces with bbox)   |
| 07 | `extract-grid.ts`             | `Polyline[]` + viewport + profile  | `GridInfo` or `null`                 |
| 08 | `compute-scale.ts`            | `GridInfo`                         | `ScaleInfo`                          |
| 09 | `detect-layout.ts`            | traces + viewport + profile        | `Layout`                             |
| 10 | `pair-traces-with-labels.ts`  | traces + labels + layout           | `LabelledTrace[]`                    |
| 11 | `find-baselines.ts`           | polylines + scale + layout + grid  | per-trace 0 mV Y                     |
| 12 | `convert-to-mv.ts`            | trace points + scale + layout + baseline | `{ samples: mV[], dur: s }`    |
| 13 | inline in `index.ts`          | labelled traces + standard channels | one rhythm-strip `ECGChannel`       |

## Manufacturer profiles

Vendor-specific knobs live in [`profiles/`](./profiles/):

```
profiles/
├── index.ts                  barrel re-export
├── types.ts                  ManufacturerProfile + DEFAULT_PROFILE
├── detect-manufacturer.ts    the cascade (metadata → page size → fingerprint → grid colour)
├── registry.ts               REGISTRY map + resolveProfile()
└── manufacturers/
    ├── ge-muse.ts
    ├── schiller.ts
    ├── schiller-cs.ts
    ├── mortara-burdick.ts
    ├── ptbxl.ts
    └── vectracor.ts
```

A profile is a `DeepPartial<ManufacturerProfile>`: vendor files only override
the keys that differ from `DEFAULT_PROFILE`, and `deepMerge` (in
`registry.ts`) fills in the rest.

Two optional hooks let exotic vendors plug in without touching the main
pipeline:

- **`postProcessPolylines(polylines): polylines`** — runs at stage 03.
  Vectracor uses it to fuse thousands of 2-point subpaths back into
  continuous traces and remap the dominant non-black signal colour to
  pure black.
- **`forceRotation: 0 | 90 | 180 | 270`** — bypasses the content-based
  scoring in stage 04. Vectracor sets `90` because its pages are always
  portrait but individual pages can have only 1-2 traces, too few for the
  generic detector to score reliably.

## Glossary

- **Polyline** — one continuous pen-down stroke from the PDF, with its
  colour, stroke width, and viewport-coordinate point array.
- **Trace** — a polyline that's been identified as an ECG signal trace
  (versus a grid line, axis, calibration pulse, etc.).
- **Lead** — one of the standard 12-lead names (I, II, III, aVR, aVL, aVF,
  V1–V6) plus the rhythm strip (`II_rhythm`).
- **Layout** — how the leads are arranged on the page:
  - `stacked_12x1` — 12 traces stacked one above the other, full-width
  - `sequential_6x2` — 6 rows × 2 columns
  - `grid_4x3` — 4 columns × 3 rows + optional rhythm strip
- **Time axis / value axis** — `Layout.timeAxis` is `'x'` or `'y'`; the
  remaining axis carries voltage. Most PDFs have time on X; some
  (Vectracor) have time on Y, in which case `rectify-orientation` rotates
  everything so downstream stages can keep assuming X.
- **`verticalInverted`** — true when smaller value-axis coordinates
  correspond to higher voltage (i.e. Y grows downward, as in pdfjs's
  viewport).
- **Baseline** — the 0 mV reference position for one trace.
- **Calibration pulse** — a small black 1-mV-tall square wave printed on
  the PDF; its bottom edge is an exact 0 mV baseline.
- **Bounding box (`bb` on a `Polyline`)** — `{ x0, x1, y0, y1, cx, cy,
  dx, dy }`. The centre and span values are precomputed by
  `computeBoundingBox` so consumers don't recalculate them.
- **CTM** — the PDF Current Transformation Matrix. `parse-paths` tracks
  it as the operator list is walked.
- **Per-segment subpath PDFs** — vendors (Vectracor, some Philips and
  Cardioline exports) draw signals as thousands of 2-point subpaths
  instead of one continuous polyline. The Vectracor profile's
  `postProcessPolylines` welds them back together.

## Where to look when…

- **A new vendor is misclassified** — start in
  [`profiles/detect-manufacturer.ts`](./profiles/detect-manufacturer.ts).
- **The signal comes out flat** — usually a wrong layout/orientation.
  Check what `[ECG] Rotation: …` and `[ECG] findSignalTraces: …` print
  in the console.
- **No traces are found** — `findSignalTraces` is too strict for the
  vendor (signal isn't black, or polyline count too low). Override
  `profile.trace.blackThreshold` or add a `postProcessPolylines` hook.
- **Wrong leads on screen (V2 is showing V3's signal, etc.)** — that's
  in `pair-traces-with-labels.ts`. The 6×2 case is sensitive to stable
  sort order; remember to break ties with a secondary key.
- **Baseline drift** — `find-baselines.ts`. Calibration detection vs
  histogram-mode-with-grid-snap fallback.

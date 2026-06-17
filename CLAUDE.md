# ECG Pipeline — Claude Configuration

## Project Overview

Full ECG analysis pipeline: upload vectorized PDF ECG → extract signal → automated diagnosis.

> **See also:** `README.md` for the project overview, build/run instructions, and user-facing documentation.

Working directory: `/workspace/ecg-pipeline/`

## Architecture

### Pipeline Flow (React/Node stack)
1. User drops 1–100 PDF ECGs via the React web UI (DropZone)
2. Client-side file detection: magic bytes + pdfjs operator inspection (vectorized vs raster vs image vs XML)
3. Client-side extraction: pdfjs parses page 1 → parse-paths (CTM tracking, color via RG/SC/SCN) → rectify orientation (auto-detect 90/180/270°) → detect manufacturer → find signal traces → extract grid → compute scale → detect layout → pair traces with lead labels → convert to mV
4. Extracted signal (ECGData JSON) sent to the Express backend for conversion:
   - HL7 aECG XML (server-side, Python)
   - ECG image rendering (server-side, Python matplotlib via ecgmind_raw2paper)
   - PDF Vectoriel download (client-side, raw or anonymized via pdf-lib)
5. Batch processing: sequential queue with per-file status, stop button, time estimate, image pre-rendering cache
6. Future: signal forwarded to the DeepECG backend (FastAPI) for AI diagnosis

### Services (docker-compose.yml)
| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| web | ecg-dev-web | 8300 | Node.js (Express) — React frontend + backend API (ECG conversion, image rendering) |
| database | ecg-dev-database | — | MySQL 8.0 — future: store results |
| phpmyadmin | ecg-dev-phpmyadmin | 8301 | Database admin |
| deepecg-backend | ecg-dev-deepecg | 8302 | FastAPI Python — ECG analysis API |
| deepecg-frontend | ecg-dev-deepecg-frontend | 8303 | React (Vite) — DeepECG interface |
| ai-engine | — | — | GPU profile — HeartWise AI models (not active) |

### Docker commands
```bash
docker compose ps                    # List running services
docker compose logs -f web           # Follow web logs
docker compose restart web           # Restart web service
docker compose build web && docker compose up -d web   # Rebuild and redeploy (frontend + backend)
```

## File Structure
```
ecg-pipeline/
├── src/
│   ├── frontend/                  # React (Vite) — ECG Extractor UI
│   │   ├── src/
│   │   │   ├── App.tsx            # Main app — batch state, queue processor, routing
│   │   │   ├── components/
│   │   │   │   ├── DropZone.tsx               # Drag-and-drop (single + multi-file)
│   │   │   │   ├── BatchPanel.tsx             # Batch file list with status, stop, time estimate
│   │   │   │   ├── FormatCards.tsx            # Output format cards (HL7, PDF, Image) + batch convert + ZIP
│   │   │   │   ├── ECGImageView.tsx           # Layout selector (3×4/6×2/12×1 ±1) + PDF viewer + image cache
│   │   │   │   ├── BatchConversionButton.tsx  # "Process full database" button
│   │   │   │   ├── BatchConversionModal.tsx   # Managed service / self-hosted options
│   │   │   │   ├── UnsupportedFileModal.tsx   # Error popup per file type (raster, image, XML, DICOM...)
│   │   │   │   ├── ReportModal.tsx            # Report unsupported ECG (anonymize + upload)
│   │   │   │   ├── InfoCard.tsx               # Home page intro sections
│   │   │   │   ├── LanguageToggle.tsx         # FR/EN switch
│   │   │   │   └── StepIndicator.tsx          # 4-step progress indicator
│   │   │   ├── lib/
│   │   │   │   ├── file-detect.ts         # File type detection (magic bytes + pdfjs + XML sniff)
│   │   │   │   ├── pdf-anonymize.ts       # Client-side PDF anonymization (smart/full modes)
│   │   │   │   ├── pdf-split.ts           # Split multi-page PDFs (1 ECG per page)
│   │   │   │   ├── pdf-config.ts          # pdfjs worker configuration
│   │   │   │   ├── types.ts               # ECGData, BatchItem, ECGChannel, etc.
│   │   │   │   └── ecg-extract/           # ECG extraction pipeline
│   │   │   │       ├── index.ts                   # Pipeline entry: parse → rectify → detect → extract → convert
│   │   │   │       ├── parse-paths.ts             # PDF operator list → polylines (CTM, colors RG/SC/SCN)
│   │   │   │       ├── rectify-orientation.ts     # Auto-detect & rectify 90/180/270° rotation
│   │   │   │       ├── find-signal-traces.ts      # Filter signal traces from grid/other polylines
│   │   │   │       ├── detect-layout.ts           # Detect layout type (stacked/sequential/grid)
│   │   │   │       ├── pair-traces-with-labels.ts # Assign traces to lead names (I, II, V1...)
│   │   │   │       ├── extract-grid.ts            # Grid detection
│   │   │   │       ├── compute-scale.ts           # Scale computation (pts/mm → mm/mV, mm/s)
│   │   │   │       ├── find-baselines.ts          # Calibration baseline detection
│   │   │   │       ├── convert-to-mv.ts           # PDF coords → mV samples (uniform or resampled)
│   │   │   │       ├── polyline-utils.ts          # Shared polyline helpers
│   │   │   │       ├── lead-names.ts              # Lead name constants/aliases
│   │   │   │       └── profiles/                  # Manufacturer detection + thresholds
│   │   │   │           ├── detect-manufacturer.ts # Detection cascade
│   │   │   │           ├── registry.ts            # Profile registry
│   │   │   │           └── manufacturers/         # GE MUSE, Schiller, Schiller CS, Mortara/Burdick, PTB-XL, Vectracor, AMPS-LLC
│   │   │   └── i18n/                      # FR/EN translations with interpolation support
│   │   └── package.json                   # Dependencies: pdfjs-dist, jszip, pdf-lib
│   └── backend/                   # Node.js (Express) — API server
│       ├── src/routes/            # convert, render-image, report, data-files endpoints
│       ├── src/writers/           # hl7aecg.ts, musexml.ts (XML writers for the Python pipeline)
│       ├── src/lib/               # github-issue.ts, signal-resample.ts
│       ├── scripts/render_ecg_image.py  # Python entry point for matplotlib rendering
│       └── python/                # Vendored Python packages
│           ├── ecgmind_raw2paper/ # ECG signal → paper image pipeline
│           └── ecg_generator/     # Matplotlib rendering engine (raw2paper)
├── deepecg/                       # Git submodule → github.com/benoitleq/DeepECGAnalyser (external analysis app)
├── data/                          # Docker volumes (gitignored)
├── docker-compose.yml
├── Dockerfile                     # Multi-stage: frontend build → backend build → slim runtime
├── CLAUDE.md                      # This file
└── README.md
```

## File Exclusions
Ignore when analyzing:
- `data/` (Docker volumes, MySQL data)
- `deepecg/` (external submodule)
- `node_modules/`, `dist/`, `.git/`

## Focus Areas
- `src/frontend/src/` — React extraction UI, batch processing, file detection, format conversion
- `src/frontend/src/lib/ecg-extract/` — Core extraction pipeline (parsing, orientation, layout, profiles)
- `src/backend/src/routes/` — Express API (HL7 conversion, image rendering, report upload)
- `src/backend/python/ecgmind_raw2paper/` — Python rendering pipeline (matplotlib)
- `docker-compose.yml` — Service orchestration

## Coding Standards
- Comments and file headers in French (project language); code identifiers in English
- Concise code, ternary operators when readable
- Python: PEP 8 style

## Current Status
- [x] ECG extractor (PDF vectorisé → signal mV) — React/pdfjs, multi-manufacturer
- [x] Manufacturer profiles: GE MUSE, Schiller (red grid), Schiller CS (pink grid/SC ops), Mortara/Burdick, PTB-XL, Vectracor, AMPS-LLC (libharu, grille per-segment + signal continu, paysage, démographie en image raster)
- [x] Orientation normalization: auto-detect 90/180/270° content-stream rotation
- [x] File type detection: vectorized PDF, raster PDF, images, ECG XML, DICOM, unknown
- [x] Batch processing: sequential queue up to 100 files, stop button, time estimate, image pre-cache
- [x] Output formats: HL7 aECG XML (server), ECG image via matplotlib (server), PDF vectoriel brut/anonymisé (client)
- [x] Layout selector: 3×4, 3×4+1, 6×2, 6×2+1, 12×1 — with rhythm strip logic
- [x] Batch download: per format, files or ZIP (JSZip client-side), PDF brut/anonymisé × files/ZIP
- [x] PDF viewer: original PDF side-by-side with rendered image for comparison
- [x] Report system: anonymize + upload unsupported ECGs for algorithm improvement
- [x] Timeout 30s on extraction to prevent infinite loops
- [x] Multi-page PDFs: extract page 1, warn user about remaining pages
- [x] DeepECG frontend React — deployed at /deepecg/
- [x] DeepECG backend FastAPI — running (AI engine not loaded)
- [ ] CPU mode adaptation for DeepECG AI engine
- [ ] Integration: extractor → DeepECG analysis pipeline
- [ ] Results storage in MySQL
- [ ] Support for per-point-cm PDFs (Philips/Cardioline with 100K+ cm operators)
- [ ] Input from source XML (GE MUSE RestingECG, HL7 aECG)
- [ ] Input from images (scanned ECGs)

# ECG Pipeline — Claude Configuration

## Project Overview

Full ECG analysis pipeline: upload vectorized PDF ECG → extract signal → automated diagnosis.

> **See also:** `README.md` for project overview, URLs, development methods, and user-facing documentation.

**Domain**: https://ecg-dev.data-coeur.com
**Repo**: https://github.com/data-coeur/ecg-pipeline

## Environment

This project runs inside an isolated Docker-in-Docker (DinD) container. The MCP server has **full root access** within this container — all shell commands, file operations, and Docker operations are allowed. The isolation is provided by the container boundary, not by code restrictions.

Working directory: `/workspace/ecg-pipeline/`

## URLs for Testing

Use Playwright to verify changes after deployment:

| Page | URL | What to check |
|------|-----|---------------|
| ECG Extractor | https://ecg-dev.data-coeur.com/ | Main UI loads, PDF upload form visible |
| DeepECG Frontend | https://ecg-dev.data-coeur.com/deepecg/ | React app loads |
| DeepECG API docs | https://ecg-dev.data-coeur.com/api/deepecg/docs | Swagger UI visible |
| phpMyAdmin | https://ecg-dev.data-coeur.com/phpmyadmin/ | Login page loads |

## Playwright (Browser Automation)

The "Playwright Browser" MCP connector in claude.ai provides tools like `browser_navigate`, `browser_click`, `browser_snapshot`, `browser_screenshot`. Use these to test pages, fill forms, take screenshots. Playwright MCP runs on the host server, separate from this project's DinD container.

## Architecture

### Pipeline Flow (current — React/Node stack)
1. User drops 1–100 PDF ECGs via React web UI (DropZone)
2. Client-side file detection: magic bytes + pdfjs operator inspection (vectorized vs raster vs image vs XML)
3. Client-side extraction: pdfjs parses page 1 → parse-paths (CTM tracking, color via RG/SC/SCN) → normalize orientation (auto-detect 90/180/270°) → detect manufacturer → identify traces → detect grid → compute scale → detect layout → assign leads → convert to mV
4. Extracted signal (ECGData JSON) sent to Express backend for conversion:
   - HL7 aECG XML (server-side, Python)
   - ECG image rendering (server-side, Python matplotlib via ecgmind_raw2paper)
   - PDF Vectoriel download (client-side, raw or anonymized via pdf-lib)
5. Batch processing: sequential queue with per-file status, stop button, time estimate, image pre-rendering cache
6. Future: signal forwarded to DeepECG backend (FastAPI) for AI diagnosis

### Infrastructure
```
HOST
└── profile-data-coeur (Docker-in-Docker, privileged)
    ├── dockerd (isolated Docker daemon)
    ├── MCP server (port 8385 → host 8585 → nginx → ecg-dev.data-coeur.com/mcp/)
    └── Inner Docker containers:
        ├── ecg-dev-web          (PHP 8.3 Apache, port 8300)
        ├── ecg-dev-database     (MySQL 8.0)
        ├── ecg-dev-phpmyadmin   (port 8301)
        ├── ecg-dev-deepecg      (FastAPI, port 8302)
        └── ecg-dev-deepecg-frontend (React/Vite, port 8303)
```

### Services (docker-compose.yml)
| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| web | ecg-dev-web | 8300 | Node.js (Express) — React frontend + backend API (ECG conversion, image rendering) |
| database | ecg-dev-database | — | MySQL 8.0 — future: store results |
| phpmyadmin | ecg-dev-phpmyadmin | 8301 | Database admin |
| deepecg-backend | ecg-dev-deepecg | 8302 | FastAPI Python — ECG analysis API |
| deepecg-frontend | ecg-dev-deepecg-frontend | 8303 | React (Vite) — interface DeepECG |
| ai-engine | — | — | GPU profile — HeartWise AI models (NOT ACTIVE) |

### Docker commands
All docker commands run inside the DinD container and affect only the inner containers:
```bash
# Via MCP shell_exec:
docker compose ps                    # List running services
docker compose logs -f web           # Follow web logs
docker compose restart web           # Restart web service
docker compose up -d --build web     # Rebuild and restart web
```

### MySQL access
The MCP provides a dedicated `mysql_query` tool that reads credentials from `.env` automatically:
- `mysql_query(query="SHOW TABLES;")` — uses ecguser from .env
- `mysql_query(query="SHOW DATABASES;", database="root")` — uses root credentials

## File Structure
```
ecg-pipeline/
├── src/
│   ├── frontend/                  # React (Vite) — ECG Extractor UI
│   │   ├── src/
│   │   │   ├── App.tsx            # Main app — batch state, queue processor, routing
│   │   │   ├── components/
│   │   │   │   ├── DropZone.tsx           # Drag-and-drop (single + multi-file)
│   │   │   │   ├── BatchPanel.tsx         # Batch file list with status, stop, time estimate
│   │   │   │   ├── FormatCards.tsx        # Output format cards (HL7, PDF, Image) + batch convert + ZIP
│   │   │   │   ├── ECGImageView.tsx       # Layout selector (3×4/6×2/12×1 ±1) + PDF viewer + image cache
│   │   │   │   ├── BatchConversionButton.tsx  # "Process full database" button
│   │   │   │   ├── BatchConversionModal.tsx   # Managed service / self-hosted options
│   │   │   │   ├── UnsupportedFileModal.tsx   # Error popup per file type (raster, image, XML, DICOM...)
│   │   │   │   ├── ReportModal.tsx        # Report unsupported ECG (anonymize + upload)
│   │   │   │   ├── InfoCard.tsx           # Home page intro sections
│   │   │   │   ├── StepIndicator.tsx      # 4-step progress indicator
│   │   │   │   ├── StatusBar.tsx          # (legacy — replaced by BatchPanel)
│   │   │   │   └── _legacy/              # Archived: DevModeView, AnonymizeCard, etc.
│   │   │   ├── lib/
│   │   │   │   ├── file-detect.ts         # File type detection (magic bytes + pdfjs + XML sniff)
│   │   │   │   ├── pdf-anonymize.ts       # Client-side PDF anonymization (smart/full modes)
│   │   │   │   ├── types.ts               # ECGData, BatchItem, ECGChannel, etc.
│   │   │   │   └── ecg-extract/           # ECG extraction pipeline
│   │   │   │       ├── index.ts           # Pipeline entry: parse → normalize → detect → extract → convert
│   │   │   │       ├── parse-paths.ts     # PDF operator list → polylines (CTM, colors RG/SC/SCN)
│   │   │   │       ├── normalize-orientation.ts  # Auto-detect & rectify 90/180/270° rotation
│   │   │   │       ├── identify-traces.ts # Filter signal traces from grid/other polylines
│   │   │   │       ├── detect-layout.ts   # Detect layout type (stacked/sequential/grid)
│   │   │   │       ├── assign-leads.ts    # Assign traces to lead names (I, II, V1...)
│   │   │   │       ├── grid-and-scale.ts  # Grid detection, scale computation, calibration baselines
│   │   │   │       ├── signal-convert.ts  # PDF coords → mV samples (uniform or resampled)
│   │   │   │       └── profiles/          # Manufacturer-specific thresholds
│   │   │   │           ├── index.ts       # Detection cascade + profile registry
│   │   │   │           └── manufacturers/ # GE MUSE, Schiller, Schiller CS, Mortara, PTB-XL
│   │   │   └── i18n/                      # FR/EN translations with interpolation support
│   │   └── package.json                   # Dependencies: pdfjs-dist, jszip, pdf-lib
│   └── backend/                   # Node.js (Express) — API server
│       ├── src/routes/ecg.ts      # /convert/:format, /render-image, /report endpoints
│       ├── src/writers/musexml.ts  # MUSE-style XML writer for Python pipeline
│       ├── scripts/render_ecg_image.py  # Python entry point for matplotlib rendering
│       └── python/                # Vendored Python packages
│           ├── ecgmind_raw2paper/ # ECG signal → paper image pipeline
│           └── ecg_generator/     # Matplotlib rendering engine (raw2paper)
├── deepecg/                       # Cloned from github.com/benoitleq/DeepECGAnalyser — DO NOT TOUCH
├── data/                          # Docker volumes (gitignored)
├── docker-compose.yml
├── Dockerfile                     # Multi-stage: frontend build → backend build → slim runtime
├── CLAUDE.md                      # This file
└── README.md
```

## File Exclusions
Ignore when analyzing:
- `data/` (Docker volumes, MySQL data)
- `deepecg/.git/`
- `deepecg/frontend/node_modules/`
- `.git/`

## Focus Areas
- `src/frontend/src/` — React extraction UI, batch processing, file detection, format conversion
- `src/frontend/src/lib/ecg-extract/` — Core extraction pipeline (parsing, orientation, layout, profiles)
- `src/backend/src/routes/ecg.ts` — Express API (HL7 conversion, image rendering, report upload)
- `src/backend/python/ecgmind_raw2paper/` — Python rendering pipeline (matplotlib)
- `docker-compose.yml` — Service orchestration

## SFTP & Permissions
Files are shared between the host user `data-coeur` (UID 1019) via SFTP and the Apache web server (www-data) inside the container. Apache is configured with group `datacoeur` (GID 1019) and directories have setgid, so files created by either are accessible to both.

## Coding Standards
- Comments in English
- Concise code, ternary operators when readable
- PHP: PSR-12 style
- Python: PEP 8 style

## Current Status
- [x] ECG extractor (PDF vectorisé → signal mV) — React/pdfjs, multi-manufacturer
- [x] Manufacturer profiles: GE MUSE, Schiller (red grid), Schiller CS (pink grid/SC ops), Mortara/Burdick, PTB-XL
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
- [x] DinD isolated environment with full MCP access
- [ ] CPU mode adaptation for DeepECG AI engine
- [ ] Integration: extractor → DeepECG analysis pipeline
- [ ] Results storage in MySQL
- [ ] Support for per-point-cm PDFs (Philips/Cardioline with 100K+ cm operators)
- [ ] Input from source XML (GE MUSE RestingECG, HL7 aECG)
- [ ] Input from images (scanned ECGs)

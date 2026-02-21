# ECG Pipeline — Claude Configuration

## Project Overview

Full ECG analysis pipeline: upload vectorized PDF ECG → extract signal → automated diagnosis.

> **See also:** `README.md` for project overview, URLs, development setup, and user-facing documentation.

**Domain**: https://ecg-dev.data-coeur.com
**Repo**: https://github.com/data-coeur/ecg-pipeline

## URLs for Testing

Use these URLs when testing with Playwright or verifying deployments:

| Page | URL | What to check |
|------|-----|---------------|
| ECG Extractor | https://ecg-dev.data-coeur.com/ | Main UI loads, PDF upload form visible |
| DeepECG Frontend | https://ecg-dev.data-coeur.com/deepecg/ | React app loads |
| DeepECG API docs | https://ecg-dev.data-coeur.com/api/deepecg/docs | Swagger UI visible |
| phpMyAdmin | https://ecg-dev.data-coeur.com/phpmyadmin/ | Login page loads |

## Playwright (Browser Automation)

Playwright allows autonomous browsing, form interaction, screenshots, and page inspection.

**Via claude.ai MCP connector** (Streamable HTTP): the "Playwright Browser" connector provides tools like `browser_navigate`, `browser_click`, `browser_snapshot`, `browser_screenshot`, etc. Use these to test pages, fill forms, take screenshots.

**Via CLI** inside the Docker container `ecg-dev-playwright` (official Microsoft image `mcr.microsoft.com/playwright/mcp`). Example:
```bash
docker exec ecg-dev-playwright npx playwright test
```

**Architecture**: The official Microsoft image runs Playwright with `--port 8931` HTTP transport. An OAuth proxy (`playwright-mcp`) sits in front on port 8386 to handle authentication required by claude.ai. Nginx at `playwright-mcp.data-coeur.com` routes to this proxy.

## Architecture

### Pipeline Flow
1. User uploads PDF ECG via web interface (`index.html`)
2. Client-side JS extracts signal from vectorized PDF (SVG paths → voltage samples)
3. Extracted signal sent to `ecg_receive.php` → saved in multiple formats (EDF+, WFDB, DICOM, HDF5, WebP)
4. Signal forwarded to DeepECGAnalyser backend (FastAPI) for AI diagnosis
5. Results displayed: 77 diagnostic classes, LVEF screening, AF risk prediction

### Services (docker-compose)
| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| web | ecg-dev-web | 8300 | PHP 8.3 Apache — extractor UI + signal receiver |
| database | ecg-dev-database | — | MySQL 8.0 — future: store results |
| phpmyadmin | ecg-dev-phpmyadmin | 8301 | Database admin |
| deepecg-backend | ecg-dev-deepecg | 8302 | FastAPI Python — ECG analysis API |
| deepecg-frontend | ecg-dev-deepecg-frontend | 8303 | React (Vite) — DeepECG UI |
| ai-engine | ecg-dev-ai-engine | — | GPU profile — HeartWise AI models (NOT ACTIVE) |

### Networks
- `ecg-dev_default`: Internal project network
- `dev-network`: External, shared with other projects on server

## File Structure
```
ecg-dev/
├── src/                    # PHP web source (Apache document root)
│   ├── index.html          # Main UI — PDF upload + signal extraction
│   ├── ecg_receive.php     # Signal receiver — saves in 5 formats
│   ├── data/               # Output directory for extracted ECGs
│   └── ecg_data/           # Sample/test data
├── deepecg/                # Cloned from github.com/benoitleq/DeepECGAnalyser
│   ├── backend/            # FastAPI app
│   └── frontend/           # React frontend
├── data/                   # Docker volumes (gitignored)
│   ├── mysql/
│   ├── deepecg-temp/
│   └── deepecg-work/
├── docker-compose.yml
├── Dockerfile              # PHP web container
├── .env
├── mcp-server-ecg.js       # MCP server for claude.ai
├── playwright-oauth-proxy.js # OAuth proxy for Playwright MCP
└── ecg-mcp.service         # systemd unit
```

## File Exclusions
Ignore when analyzing:
- `data/` (Docker volumes)
- `deepecg/.git/`
- `deepecg/frontend/node_modules/`
- `.git/`
- `node_modules/`

## Focus Areas
- `src/index.html` — Signal extraction UI
- `src/ecg_receive.php` — Signal processing + format conversion
- `deepecg/backend/app/` — AI analysis backend
- `docker-compose.yml` — Service orchestration
- Integration between extractor output and DeepECG input

## Coding Standards
- Comments in English
- Concise code, ternary operators when readable
- PHP: PSR-12 style
- Python: PEP 8 style

## Current Status
- [x] ECG extractor (PDF → signal) — working
- [x] Signal receiver (PHP, saves EDF+/WFDB/DICOM/HDF5/WebP) — working
- [x] DeepECG frontend React — deployed
- [ ] DeepECG backend — starts but AI engine not available (no GPU)
- [ ] CPU mode adaptation for DeepECG
- [ ] Integration: extractor → DeepECG analysis pipeline
- [ ] Results storage in MySQL

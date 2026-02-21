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

### Pipeline Flow
1. User uploads PDF ECG via web interface (`index.html`)
2. Client-side JS extracts signal from vectorized PDF (SVG paths → voltage samples)
3. Extracted signal sent to `ecg_receive.php` → saved in multiple formats (EDF+, WFDB, DICOM, HDF5, WebP)
4. Signal forwarded to DeepECGAnalyser backend (FastAPI) for AI diagnosis
5. Results displayed: 77 diagnostic classes, LVEF screening, AF risk prediction

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
| web | ecg-dev-web | 8300 | PHP 8.3 Apache — extractor UI + signal receiver |
| database | ecg-dev-database | — | MySQL 8.0 — future: store results |
| phpmyadmin | ecg-dev-phpmyadmin | 8301 | Database admin |
| deepecg-backend | ecg-dev-deepecg | 8302 | FastAPI Python — ECG analysis API |
| deepecg-frontend | ecg-dev-deepecg-frontend | 8303 | React (Vite) — DeepECG UI |
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
├── src/                    # PHP web source (Apache document root)
│   ├── index.html          # Main UI — PDF upload + signal extraction
│   ├── ecg_receive.php     # Signal receiver — saves in 5 formats
│   ├── data/               # Output directory for extracted ECGs (gitignored)
│   └── ecg_data/           # Sample/test ECG data
├── deepecg/                # Cloned from github.com/benoitleq/DeepECGAnalyser
│   ├── backend/            # FastAPI app
│   └── frontend/           # React frontend (base path: /deepecg/)
├── data/                   # Docker volumes (gitignored)
│   ├── mysql/
│   ├── deepecg-temp/
│   └── deepecg-work/
├── docker-compose.yml      # Service orchestration
├── Dockerfile              # PHP web container image
├── .env                    # Environment variables (gitignored)
├── .env.example            # Template for .env
├── CLAUDE.md               # This file — AI context
└── README.md               # Project documentation
```

## File Exclusions
Ignore when analyzing:
- `data/` (Docker volumes, MySQL data)
- `deepecg/.git/`
- `deepecg/frontend/node_modules/`
- `.git/`

## Focus Areas
- `src/index.html` — Signal extraction UI (JavaScript)
- `src/ecg_receive.php` — Signal processing + format conversion
- `deepecg/backend/app/` — AI analysis backend (Python/FastAPI)
- `docker-compose.yml` — Service orchestration
- Integration between extractor output and DeepECG input

## SFTP & Permissions
Files are shared between the host user `data-coeur` (UID 1019) via SFTP and the Apache web server (www-data) inside the container. Apache is configured with group `datacoeur` (GID 1019) and directories have setgid, so files created by either are accessible to both.

## Coding Standards
- Comments in English
- Concise code, ternary operators when readable
- PHP: PSR-12 style
- Python: PEP 8 style

## Current Status
- [x] ECG extractor (PDF → signal) — working
- [x] Signal receiver (PHP, saves EDF+/WFDB/DICOM/HDF5/WebP) — working
- [x] DeepECG frontend React — deployed at /deepecg/
- [x] DeepECG backend FastAPI — running (AI engine not loaded)
- [x] DinD isolated environment with full MCP access
- [x] SFTP access for file editing
- [ ] CPU mode adaptation for DeepECG AI engine
- [ ] Integration: extractor → DeepECG analysis pipeline
- [ ] Results storage in MySQL

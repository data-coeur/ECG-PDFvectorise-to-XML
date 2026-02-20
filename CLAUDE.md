# ECG Pipeline — Claude Configuration

## Project Overview
Full ECG analysis pipeline: upload vectorized PDF ECG → extract signal → automated diagnosis.

**Domain**: https://ecg-dev.data-coeur.com
**Repo**: https://github.com/data-coeur/ecg-pipeline

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
│   └── frontend/           # React frontend (not used yet, we use index.html)
├── data/                   # Docker volumes (gitignored)
│   ├── mysql/
│   ├── deepecg-temp/
│   └── deepecg-work/
├── docker-compose.yml
├── Dockerfile              # PHP web container
├── .env
├── mcp-server-ecg.js       # MCP server for claude.ai
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
- [ ] DeepECG backend — starts but AI engine not available (no GPU)
- [ ] CPU mode adaptation for DeepECG
- [ ] Integration: extractor → DeepECG analysis pipeline
- [ ] Results storage in MySQL

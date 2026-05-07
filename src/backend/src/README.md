# `src/backend/src/` — Backend Express

Petit backend Node.js qui sert d'API HTTP au frontend React et de glue vers
les modules Python vendored (matplotlib raw2paper). Pas de base de données,
pas d'authentification : tout l'état métier vit dans le frontend (browser),
le backend ne fait que de la conversion stateless + une archive de fichiers
signalés sous `DATA_DIR`.

## La story

```
                   ┌─────────────────┐
                   │   server.ts     │  Express : CORS, JSON 60MB,
                   │   bootstrap     │  monte /api/ecg, sert /ecg/
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │ routes/index.ts │  barrel : assemble les 4 sous-routes
                   └────────┬────────┘
              ┌────────┬────┴────┬─────────────┐
              ▼        ▼         ▼             ▼
        ┌──────────┐ ┌──────┐ ┌─────────────┐ ┌────────┐
        │data-files│ │convert│ │render-image│ │ report │
        │GET /data │ │POST   │ │POST /render │ │POST    │
        │/:filename│ │/conv… │ │-image       │ │/report │
        └──────────┘ └───┬──┘ └──────┬──────┘ └────┬───┘
                         │           │             │
                         ▼           ▼             ▼
                    ┌──────────┐ ┌──────────┐ ┌──────────────┐
                    │writers/  │ │writers/  │ │lib/github-   │
                    │hl7aecg.ts│ │musexml.ts│ │issue.ts      │
                    └──────────┘ └────┬─────┘ └──────────────┘
                                      │
                                      ▼
                              ┌────────────────┐
                              │scripts/        │
                              │render_ecg_     │  matplotlib via
                              │image.py        │  ecgmind_raw2paper
                              └────────────────┘
```

## Fichiers in-scope

| Fichier | Rôle | In | Out |
|---|---|---|---|
| `server.ts` | Bootstrap Express | env `PORT`, `DATA_DIR` | HTTP listener |
| `routes/index.ts` | Barrel : monte les 4 sous-routes sur `/api/ecg` | — | `Router` Express |
| `routes/data-files.ts` | Sert les fichiers générés (XML, PDF…) | `GET /data/<filename>` | binary download |
| `routes/convert.ts` | Convertit ECGData JSON en HL7 aECG XML | `POST /convert/hl7aecg` body JSON | `{success, base, files, info}` JSON |
| `routes/render-image.ts` | ECG JSON → MUSE XML → script Python → image WebP | `POST /render-image` body JSON | image WebP binaire |
| `routes/report.ts` | Reçoit un PDF anonymisé, archive + post sur GitHub | `POST /report` multipart | `{success, filename}` JSON |
| `writers/hl7aecg.ts` | Sérialise ECG → HL7 aECG XML (FDA) | `Channel[]` + samples | fichier XML |
| `writers/musexml.ts` | Sérialise ECG → GE MUSE XML (entrée raw2paper) | `Channel[]` + samples | fichier XML |
| `lib/signal-resample.ts` | `fitChannelToDuration` + `resample` | `Channel[]` | reshapés + métadonnées |
| `lib/github-issue.ts` | Poste un commentaire markdown sur l'issue #3 | string body | côté GitHub |
| `scripts/render_ecg_image.py` | Wrapper Python du pipeline raw2paper | XML path + output path | image WebP |
| `scripts/parse_xml_ecg.py` | Parser XML legacy (désactivé pour confidentialité) | XML path | ECGData JSON |

## Fichiers hors scope (vendored, ne pas toucher)

- `python/ecg_generator/` — moteur matplotlib (DPI 304.8 figé)
- `python/ecgmind_raw2paper/` — pipeline rendu papier
- `python/shared/`, `python/DataAugmentation/` — modules adjacents

## Glossaire

- **Channel** — un seul lead ECG : `{ name: 'V1', samples: [...mV], duration_s, sample_rate_hz }`
- **Lead** — synonyme métier de Channel ; nom d'une dérivation (I, II, III, aVR, aVL, aVF, V1-V6)
- **mV / µV** — millivolt / microvolt ; les samples circulent en mV, encodés en µV dans HL7 et int16 LE dans MUSE
- **Sample rate** — fréquence d'échantillonnage en Hz (typiquement 500 Hz côté client)
- **HL7 aECG** — Annotated ECG R1 DSTU 2004, le format FDA
- **MUSE XML** — format d'entrée du pipeline Python matplotlib raw2paper (re-package des leads en base64)
- **DATA_DIR** — répertoire d'archivage (`/app/data` en prod), persiste les XML générés et les reports PDF

## Cheat sheet : où regarder quand…

- **Le rendu d'image plante (500)** → logs container : `docker compose logs -f web` ; chercher `[render] Python stderr:`. Le XML temp reste dans `DATA_DIR/_render_<uid>.xml` si `routes/render-image.ts:194` n'arrive pas au `finally`.
- **Le report ne poste pas de comment GitHub** → vérifier `process.env.GITHUB_TOKEN` ; sans token, `lib/github-issue.ts` log un warning et skip silencieusement (le fichier PDF est quand même archivé).
- **Conversion HL7 retourne erreur 400 "No channels"** → frontend envoie un `ECGData` malformé ; vérifier le body JSON.
- **`/data/foo` retourne 403** → tentative de path traversal détectée par `routes/data-files.ts`. Le chemin résolu doit rester dans `DATA_DIR`.
- **Backend ne démarre pas après `docker compose up -d web`** → vérifier `routes/index.ts` ; un import cassé fait crasher Express avant le `app.listen`.

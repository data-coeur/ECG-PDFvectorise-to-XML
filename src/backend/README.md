# ECG Pipeline — Backend

## Contexte

Le backend est un serveur **Node.js / Express** (TypeScript) qui reçoit le signal ECG extrait par le frontend et fournit deux fonctionnalités :

1. **Conversion en HL7 aECG XML** — format FDA/HL7 v3 pour la soumission réglementaire
2. **Rendu en image ECG standardisée** — appelle un sous-processus Python (matplotlib + ecg_generator) qui produit une image WebP papier ECG (A4, layout 6x2+1, grille millimétrique). Cette image remplace la grille canvas custom du frontend (plus de bugs d'alignement).

Le backend ne fait **aucune extraction de signal** — c'est le frontend qui parse le PDF vectorisé. Le backend reçoit les échantillons en mV et produit les fichiers de sortie.

## Architecture

```
src/backend/
├── src/
│   ├── server.ts                       # Express, port 3000
│   ├── routes/
│   │   └── ecg.ts                      # Routes /api/ecg/*
│   ├── writers/
│   │   ├── hl7aecg.ts                  # HL7 aECG XML (téléchargement utilisateur)
│   │   └── musexml.ts                  # GE MUSE RestingECG XML (interne, pour le rendu Python)
│   └── _legacy/
│       ├── README.md
│       └── writers/                    # edf, wfdb, dicom, hdf5, webp (désactivés)
├── scripts/
│   ├── render_ecg_image.py             # Wrapper CLI Python — appelle ecgmind_raw2paper
│   └── parse_xml_ecg.py                # [LEGACY] Parser XML désactivé
├── python/                             # Packages Python vendorisés (PYTHONPATH=/app/python)
│   ├── ecg_generator/                  # Pipeline de rendu (depuis ECGPerturb)
│   ├── ecgmind_raw2paper/              # Wrapper de configuration (depuis ECGMind_Raw2Paper)
│   ├── shared/                         # Utilitaires partagés (depuis ECGPerturb)
│   └── DataAugmentation/               # Module minimal (multilingual_medical seulement)
├── dist/                               # Code JS compilé (tsc)
├── node_modules/
├── package.json
└── tsconfig.json
```

### Build et déploiement

Conteneur Docker `ecg-dev-web`, port 3000. Multi-étapes :

1. **Stage 1** : Build frontend React/Vite
2. **Stage 2** : Build backend TypeScript (`tsc` → `dist/`)
3. **Stage 3** : Runtime **node:18-slim** (Debian) avec Python 3 + matplotlib + opencv

```bash
docker compose build --no-cache web && docker compose up -d web
```

Note importante : on est passé de **Alpine** à **Debian slim** car Alpine ne fournit pas de wheels pré-compilés pour `opencv-python` (compilation lourde nécessitant gcc + cmake).

---

## Routes API

Toutes sous `/api/ecg/`.

### `POST /api/ecg/convert/:format`

Convertit le signal ECG en HL7 aECG XML.

**Entrée** : JSON `{ manufacturer, layout, channels: [{ name, samples, duration_s, sample_rate_hz }] }`
**Paramètre URL** : `:format` — uniquement `hl7aecg` accepté
**Sortie** : `{ success, base, files: { hl7aecg }, info }`

Le fichier généré est téléchargeable via `GET /api/ecg/data/<filename>`.

### `POST /api/ecg/render-image`

Génère une image ECG standardisée (matplotlib) à partir du signal.

**Entrée** : JSON `{ channels: [...] }` (même format que `/convert`)
**Sortie** : binaire `image/webp` directement dans le body de la réponse (pas via fichier statique)

**Pipeline interne** :
1. Resample des canaux à fréquence uniforme
2. `writeMuseXml()` → écrit un fichier temporaire `_render_<timestamp>.xml` au format **GE MUSE RestingECG** (le format que le parser Python attend, base64 int16 little-endian µV)
3. `execFile('python3', 'render_ecg_image.py', xml, image)` — sous-processus Python (timeout 30s)
4. Lecture du fichier WebP, envoi en réponse
5. Cleanup des fichiers temporaires (XML + image) dans le `finally`

**Codes d'erreur** :
- `400` : pas de canaux dans la requête
- `500` : Python a crashé, timeout, ou n'a produit aucun fichier

### `GET /api/ecg/data/:filename`

Télécharge un fichier généré. Vérifie que le chemin résolu reste dans `DATA_DIR` (protection path traversal).

### `POST /api/ecg/report`

Reçoit un PDF anonymisé pour signalement de bug. Multipart `pdf` (max 50 Mo, MIME `application/pdf`). Si `GITHUB_TOKEN` est défini, poste un commentaire sur l'issue GitHub `data-coeur/ecg-pipeline#3`.

---

## Writers

### `hl7aecg.ts` — HL7 aECG XML (format FDA)

Format XML structuré HL7 v3 utilisé pour les soumissions FDA américaines. Utilisé pour le téléchargement utilisateur via `/convert/hl7aecg`.

**Structure** :
- `<AnnotatedECG>` racine avec namespaces HL7
- `<series>` > `<sequenceSet>` contenant un composant temps + une `<sequence>` par dérivation
- Échantillons en **microvolts** (mV × 1000), encodés en `<digits>` séparés par des espaces
- Codes MDC : `MDC_ECG_LEAD_I`, `MDC_ECG_LEAD_V1`, etc.

### `musexml.ts` — GE MUSE RestingECG XML (interne)

Format XML propriétaire GE MUSE utilisé **uniquement en interne** pour alimenter le rendu Python. Le parser `ecg_generator/in_out/xml_parser.py` attend ce format précis (et pas du HL7 aECG).

**Structure** :
```xml
<RestingECG>
  <SampleBase>500</SampleBase>
  <Waveform>
    <WaveformType>Rhythm</WaveformType>
    <LeadData>
      <LeadID>I</LeadID>
      <LeadAmplitudeUnitsPerBit>4.88</LeadAmplitudeUnitsPerBit>
      <LeadAmplitudeUnits>MICROVOLTS</LeadAmplitudeUnits>
      <LeadSampleCountTotal>5000</LeadSampleCountTotal>
      <WaveFormData>{base64 int16 LE µV}</WaveFormData>
    </LeadData>
    ...
  </Waveform>
</RestingECG>
```

**Encodage** : chaque échantillon mV est converti en int16 ADC : `int16 = round(mV × 1000 / 4.88)` (gain GE MUSE standard 4.88 µV/bit pour 16 bits). Concaténés en buffer little-endian, puis base64.

**Note** : ce writer n'est pas exposé via une route — il est appelé directement par `/render-image`.

### Writers legacy (`_legacy/writers/`)

Désactivés mais conservés pour réactivation future :
- `edf.ts` — European Data Format
- `wfdb.ts` — PhysioNet WFDB
- `dicom.ts` — DICOM Waveform
- `hdf5.ts` — HDF5 simplifié
- `webp.ts` — Image WebP via SVG + sharp (rendu maison, remplacé par le pipeline Python)

Pour réactiver un format : déplacer le writer dans `src/writers/`, ré-importer dans `routes/ecg.ts`, ré-ajouter dans `FormatCards.tsx` côté frontend.

---

## Pipeline Python (rendu d'image)

Le rendu d'image ECG est délégué à un sous-processus Python isolé. C'est le choix d'architecture qui évite les problèmes de thread-safety de matplotlib et qui permet de réutiliser un code Python éprouvé.

### `scripts/render_ecg_image.py`

Wrapper CLI minimal (~40 lignes) :
```bash
python3 render_ecg_image.py <xml_path> <output_path>
```

Stratégie d'erreur : exit code non-nul + message sur stderr → Node.js détecte l'échec et renvoie 500.

### Packages vendorisés (`python/`)

Trois packages copiés depuis le repo `ECGPerturb` (pas en dépendance pip car privé) :

| Package | Origine | Rôle |
|---------|---------|------|
| `ecg_generator/` | ECGPerturb (~10 000 lignes) | Pipeline complet de rendu : parse XML, layout, grille, signal, calibration, savefig matplotlib |
| `ecgmind_raw2paper/` | ECGMind_Raw2Paper (~260 lignes) | Wrapper de haut niveau avec config standardisée (A4, layout 6x2+1, theme `softer_yellow_red`) |
| `shared/` | ECGPerturb | Utilitaires (npz_schema, mask_generator) |
| `DataAugmentation/` | ECGPerturb (minimal) | Seulement `multilingual_medical.py` (textes médicaux multilingues utilisés par `ecg_generator/config/randomization.py`) |

`PYTHONPATH=/app/python` est défini dans le Dockerfile pour que les imports `from ecg_generator...`, `from ecgmind_raw2paper...`, `from shared...`, `from DataAugmentation...` fonctionnent.

### Format de sortie

Image **WebP lossless 3564×2520** (A4 à 304.8 DPI) avec :
- Fond crème `#FDFAF5`
- Grille millimétrique dorée `#C8A020` (mineure 1mm + majeure 5mm `solid`)
- Tracés noirs antialiased
- 6 dérivations en 2 colonnes + 1 rythme strip (lead II) en bas
- Pulses de calibration 1mV à droite de chaque ligne

### Pipeline d'appel complet

```
[Frontend]                    [Backend Node.js]                          [Python sub-process]
ECG JSON      ──HTTP──>   POST /api/ecg/render-image
                               ↓
                            resample(channels)
                               ↓
                            writeMuseXml() → /app/data/_render_<ts>.xml
                               ↓
                            execFile('python3', 'render_ecg_image.py', xml, img)
                                                                            ↓
                                                                  ecgmind_raw2paper.generate_ecg_image
                                                                            ↓
                                                                  ecg_generator parse XML, render, savefig
                                                                            ↓
                                                                       /app/data/_render_<ts>.webp
                               ↓
                            fs.readFileSync(img) → buffer
                               ↓
                            res.set('Content-Type', 'image/webp')
                               ↓
                            res.send(buf)
                               ↓
                            finally: unlink xml + img
              <─binary─    image/webp blob
```

---

## Bugs résolus en cours d'intégration

Pour la postérité, voici les blockers rencontrés lors de l'ajout du rendu Python :

| # | Problème | Cause | Fix |
|---|----------|-------|-----|
| 1 | `ModuleNotFoundError: DataAugmentation` | `ecg_generator/config/randomization.py` importe `from DataAugmentation.resources.multilingual_medical import ...` au niveau module | Vendoriser uniquement `DataAugmentation/__init__.py`, `resources/__init__.py`, `multilingual_medical.py` et `medical_phrases.txt` (~40 Ko vs 471 Mo total) |
| 2 | `ModuleNotFoundError: cv2` | `shared/map_utils.py` importe opencv au niveau module | Installer `opencv-python-headless` via pip |
| 3 | `pip._vendor.packaging.version.InvalidVersion: 'python-4.10.0'` | Le paquet apk `py3-opencv` sur Alpine a une version mal formée que pip ne sait pas parser | Ne pas mélanger apk + pip pour opencv |
| 4 | `Failed building wheel for opencv-python-headless` | Alpine n'a pas de wheels pré-compilés, scikit-build veut gcc + cmake | Passer de `node:18-alpine` à `node:18-slim` (Debian) qui a des wheels manylinux |
| 5 | `StopIteration` dans `render_ecg_layout` (`leads_data.values()` vide) | On envoyait notre HL7 aECG mais le parser Python attend du **GE MUSE RestingECG** XML (structures complètement différentes) | Créer `writers/musexml.ts` qui produit le format MUSE attendu |
| 6 | Image rendue avec fond blanc (pas le crème `#FDFAF5`) | `create_standard_figure()` ne définit pas `facecolor` → matplotlib défaut blanc | Patcher `ecgmind_raw2paper/pipeline.py` : `fig.patch.set_facecolor(bg)` + `savefig(facecolor=bg)` |
| 7 | Grille complètement absente (image 7.5 Ko, juste signal sur fond crème) | La config avait `grid_style: ["lignes", "lignes"]` (mots français) mais le code n'accepte que `"solid"`, `"dashed"`, `"dotted"`, `"dots"` → tous les `if` du dessin échouent silencieusement | Changer en `grid_style: ["solid", "solid"]` |

---

## Dépendances

### Production npm (`dependencies`)

| Package | Rôle |
|---------|------|
| `express` | Serveur HTTP et routage |
| `cors` | Headers CORS pour le frontend |
| `multer` | Upload multipart/form-data (route /report) |
| `sharp` | (Plus utilisé activement — était pour le writer WebP legacy) |

### Runtime système (Dockerfile)

```dockerfile
RUN apt-get install -y --no-install-recommends \
        fontconfig fonts-dejavu python3 python3-pip
RUN pip3 install --no-cache-dir --break-system-packages \
        numpy scipy Pillow matplotlib lxml h5py wfdb faker pyyaml \
        opencv-python-headless scikit-image
```

---

## Tests unitaires

**Aucun test pour l'instant.** Tests recommandés à implémenter :

| Priorité | Cible | Ce qu'il faut tester |
|----------|-------|----------------------|
| **Haute** | `writeMuseXml()` | Round-trip mV → base64 int16 → mV identique au gain près. Vérifier que le parser Python reload correctement les leads |
| **Haute** | `writeHL7aECG()` | XML bien formé, valeurs en µV correctes, schéma HL7 valide |
| **Haute** | `/api/ecg/render-image` | Bout-en-bout : envoyer un JSON ECG, recevoir une image WebP valide non vide |
| **Haute** | `render_ecg_image.py` | Échec gracieux (exit code 2 + stderr) si XML invalide |
| **Moyenne** | `resample()` | Canal vide, 1 point, fréquences mixtes |
| **Moyenne** | Path traversal | `GET /api/ecg/data/../../etc/passwd` → 403 |

---

## Évaluation sécurité — Confidentialité

### Données qui transitent vers le serveur

| Donnée | Route | Contient des infos patient ? |
|--------|-------|------------------------------|
| Signal ECG en mV (JSON) | `POST /api/ecg/convert/hl7aecg`, `POST /api/ecg/render-image` | **Signal uniquement** — pas de nom, ID, date. Mais le signal ECG est une donnée de santé au sens RGPD |
| PDF anonymisé | `POST /api/ecg/report` | Non — anonymisé côté client avant envoi |

### Points d'attention spécifiques au pipeline Python

| Risque | Niveau | Détail |
|--------|--------|--------|
| **Fichiers temporaires sur disque** | Moyen | `/render-image` écrit le XML et l'image dans `/app/data/` pendant 1-3 secondes. Le `finally` les supprime, mais en cas de crash entre-temps ils restent. |
| **Sous-processus Python** | Faible | `execFile` avec arguments tableau (pas de shell), timeout 30s, paths absolus. Pas d'injection possible. |
| **Concurrence matplotlib** | OK | Chaque appel fork un nouveau processus Python isolé → pas de problème de thread-safety. |
| **Mémoire** | Moyen | matplotlib + savefig à 3564×2520 consomme ~150-300 Mo par appel. À surveiller en charge. |
| **Latence** | Moyen | Rendu Python : 1-3 secondes par image. Pas de queue → si plusieurs requêtes simultanées, elles s'empilent. |

### Recommandations

1. **Cron de nettoyage** de `DATA_DIR` (supprimer les fichiers > 24h)
2. **Authentification** ou rate limiting sur les routes (actuellement ouvertes)
3. **Tests round-trip** writeMuseXml ↔ render Python pour valider la fidélité
4. **Métriques** : logger le temps de rendu Python pour détecter les régressions de performance
5. **Pool de processus Python** si la charge augmente (avec un système type RQ/Celery)

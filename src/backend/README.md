# ECG Pipeline — Backend

## Contexte

Le backend est un serveur **Node.js / Express** écrit en TypeScript. Son rôle unique : recevoir le signal ECG extrait par le frontend (valeurs en mV par dérivation) et le convertir en fichiers aux formats médicaux standards (EDF+, WFDB, DICOM, HDF5, WebP, HL7 aECG).

Le backend ne fait **aucune extraction de signal** — c'est le frontend qui parse le PDF vectorisé et extrait les courbes. Le backend reçoit le résultat (un JSON avec les échantillons) et produit des fichiers.

## Architecture

```
src/backend/
├── src/
│   ├── server.ts              # Point d'entrée — lance Express sur le port 3000
│   ├── routes/
│   │   └── ecg.ts             # Routeur API — toutes les routes /api/ecg/*
│   └── writers/
│       ├── edf.ts             # Writer EDF+ (European Data Format)
│       ├── wfdb.ts            # Writer WFDB (PhysioNet)
│       ├── dicom.ts           # Writer DICOM Waveform
│       ├── hdf5.ts            # Writer HDF5 (simplifié)
│       ├── webp.ts            # Writer WebP (image 4K)
│       └── hl7aecg.ts         # Writer HL7 aECG XML (format FDA)
├── scripts/
│   └── parse_xml_ecg.py       # [LEGACY] Parser XML via ecg-datakit (désactivé)
├── dist/                       # Code JS compilé (généré par `tsc`, ne pas modifier)
├── node_modules/               # Dépendances (généré par `npm install`, ne pas modifier)
├── package.json                # Dépendances et scripts npm
└── tsconfig.json               # Configuration TypeScript
```

### Build et déploiement

Le backend est compilé et exécuté dans un conteneur Docker (`ecg-dev-web`, port 3000).
Le Dockerfile utilise un build multi-étapes :

1. **Stage 1** : Build du frontend React (Vite)
2. **Stage 2** : Build du backend TypeScript (`tsc` → `dist/`)
3. **Stage 3** : Image de production Node.js Alpine — copie `dist/`, `node_modules/`, `frontend-dist/`

Pour redéployer après modification :
```bash
docker compose build --no-cache web && docker compose up -d web
```

---

## Routes API

Toutes les routes sont montées sous `/api/ecg/`.

### `POST /api/ecg/convert/:format`

Convertit le signal ECG dans un format donné.

**Entrée** : JSON (`Content-Type: application/json`, limite 60 Mo)

```json
{
  "manufacturer": "GE MUSE",
  "layout": "sequential_6x2",
  "channels": [
    {
      "name": "I",
      "samples": [0.012, 0.015, -0.003, ...],
      "duration_s": 9.96,
      "sample_rate_hz": 500
    },
    ...
  ]
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `manufacturer` | string | Fabricant détecté (pour métadonnées du fichier de sortie) |
| `layout` | string | Layout détecté (`stacked_12x1`, `sequential_6x2`, `grid_4x3`) |
| `channels[].name` | string | Nom de la dérivation (`I`, `II`, `V1`...) |
| `channels[].samples` | number[] | Valeurs en **millivolts** (mV), relatives à la baseline (0mV) |
| `channels[].duration_s` | number | Durée du tracé en secondes |
| `channels[].sample_rate_hz` | number | Fréquence d'échantillonnage en Hz |

**Paramètre URL** : `:format` — un de : `edf`, `wfdb`, `dicom`, `hdf5`, `webp`, `hl7aecg`

**Sortie** : JSON

```json
{
  "success": true,
  "base": "ecg_GE_MUSE_2026_04_03_08_30_00",
  "files": { "edf": "ecg_GE_MUSE_2026_04_03_08_30_00.edf" },
  "info": {
    "manufacturer": "GE MUSE",
    "layout": "sequential_6x2",
    "channels": 12,
    "sample_rate": 500,
    "duration": 9.96
  }
}
```

Les fichiers générés sont téléchargeables via `GET /api/ecg/data/<filename>`.

**Codes d'erreur** :
- `400` : format invalide ou pas de canaux
- `500` : erreur interne de conversion

---

### `GET /api/ecg/data/:filename`

Télécharge un fichier généré.

**Entrée** : nom du fichier dans l'URL (ex: `/api/ecg/data/ecg_GE_MUSE_2026_04_03.edf`)

**Sortie** : le fichier binaire en téléchargement (`Content-Disposition: attachment`)

**Sécurité** : vérifie que le chemin résolu commence bien par `DATA_DIR` (protection path traversal).

**Codes d'erreur** :
- `403` : tentative de path traversal
- `404` : fichier non trouvé

---

### `POST /api/ecg/report`

Reçoit un PDF anonymisé pour signaler un problème d'extraction.

**Entrée** : `multipart/form-data`

| Champ | Type | Description |
|-------|------|-------------|
| `pdf` | File | Le PDF anonymisé (max 50 Mo, MIME `application/pdf` uniquement) |
| `manufacturer` | string | Fabricant détecté |
| `layout` | string | Layout détecté |
| `channels` | string | Nombre de canaux |
| `filename` | string | Nom du fichier source |

**Sortie** : JSON `{ "success": true, "filename": "report_2026_04_03.pdf" }`

**Effet secondaire** : si `GITHUB_TOKEN` est défini dans `.env`, poste un commentaire
sur l'issue GitHub `data-coeur/ecg-pipeline#3` avec les métadonnées du signalement.

---

## Writers — Détail par format

### `edf.ts` — EDF+ (European Data Format)

| | |
|---|---|
| **Format** | Binaire, standard ouvert |
| **Extension** | `.edf` |
| **Lecteurs** | EDFbrowser, MATLAB, Python (pyedflib, mne) |
| **Entrée** | `channels`, `resampled[][]`, `nSamples`, `sampleRate`, `duration`, `filename` |
| **Sortie** | Fichier `.edf` sur disque |

**Structure du fichier** :
- Header global (256 octets) : version, patient, date, durée, nombre de canaux
- Header par canal (256 octets × N) : nom, unité (mV), min/max physique et digital
- Données : valeurs converties en int16 (−32768 à +32767), proportionnelles à l'étendue [pMin, pMax] de chaque canal

**Limite** : résolution 16 bits. Pour un signal de ±3mV, la résolution est ~0.09µV — largement suffisant pour l'ECG clinique.

---

### `wfdb.ts` — WFDB (PhysioNet)

| | |
|---|---|
| **Format** | Texte (header) + binaire (données) |
| **Extensions** | `.hea` + `.dat` |
| **Lecteurs** | PhysioNet WFDB, Python (wfdb), MATLAB |
| **Entrée** | `channels`, `resampled[][]`, `nSamples`, `sampleRate`, `basePath` |
| **Sortie** | Deux fichiers sur disque |

**`.hea`** (header texte) : une ligne par canal avec nom du fichier .dat, format (16 bits), gain, unité, nom du canal.

**`.dat`** (données binaires) : int16 **entrelacé** (échantillon 1 de tous les canaux, puis échantillon 2, etc.). C'est le format opposé de EDF qui est séquentiel (tout le canal 1, puis tout le canal 2).

---

### `dicom.ts` — DICOM Waveform

| | |
|---|---|
| **Format** | Binaire structuré (tags TLV) |
| **Extension** | `.dcm` |
| **Lecteurs** | OsiriX, Horos, MATLAB, Python (pydicom) |
| **Entrée** | `channels`, `resampled[][]`, `nSamples`, `sampleRate`, `filename` |
| **Sortie** | Fichier `.dcm` sur disque |

**Structure** :
- Préambule (128 octets vides + magic `DICM`)
- Tags méta : Transfer Syntax, SOP Class (12-Lead ECG Waveform)
- Tags patient : nom anonyme
- Waveform Sequence (tag 5400,0100) contenant :
  - Nombre de canaux, nombre d'échantillons, fréquence
  - Channel Definition Sequence : nom et facteur de sensibilité par canal
  - Waveform Data (tag 5400,1010) : int16 entrelacé

**Remarque** : le facteur de sensibilité (`sensitivity`) est stocké par canal dans le tag 003A,0210. Il est essentiel pour reconvertir les valeurs int16 en mV.

---

### `hdf5.ts` — HDF5 (simplifié)

| | |
|---|---|
| **Format** | Binaire custom (PAS un vrai HDF5 complet) |
| **Extension** | `.h5` |
| **Lecteurs** | Code custom uniquement (pas compatible avec h5py/HDFView tel quel) |
| **Entrée** | `channels`, `resampled[][]`, `nSamples`, `sampleRate`, `duration`, `filename`, `meta` |
| **Sortie** | Fichier `.h5` sur disque |

**Structure** :
1. Magic bytes HDF5 (8 octets) — pour identification
2. Longueur du header JSON (uint32 LE)
3. Header JSON : métadonnées complètes (fréquence, durée, noms des canaux, fabricant...)
4. Données brutes : float32 little-endian, channels-first (tout le canal 1, puis canal 2, etc.)

**Attention** : ce format utilise les magic bytes HDF5 mais n'est **pas** un vrai fichier HDF5 conforme. Il ne sera pas lisible par h5py ou HDFView. C'est un format propriétaire simplifié. Si la compatibilité HDF5 est requise, ce writer doit être réécrit avec une vraie bibliothèque HDF5.

---

### `webp.ts` — Image WebP 4K

| | |
|---|---|
| **Format** | Image WebP |
| **Extension** | `.webp` |
| **Résolution** | 3840 × 2160 (4K) |
| **Entrée** | `channels`, `data` (avec layout/scale), `filename` |
| **Sortie** | Fichier `.webp` sur disque |

**Processus** :
1. Construit un SVG en mémoire contenant :
   - Fond blanc
   - Grille ECG (lignes roses 1mm et 5mm)
   - Signal de chaque dérivation en `<polyline>`
   - Pulse de calibration 1mV/200ms
   - Labels des dérivations et infos fabricant
2. Convertit le SVG en WebP via **sharp** (qualité 85%)

Supporte deux layouts : `stacked_12x1` (12 lignes) ou 2 colonnes (6+6).

---

### `hl7aecg.ts` — HL7 aECG XML

| | |
|---|---|
| **Format** | XML structuré |
| **Extension** | `.xml` |
| **Standard** | HL7 Annotated ECG R1 DSTU (2004) |
| **Lecteurs** | Systèmes HL7 v3, soumissions FDA |
| **Entrée** | `channels`, `resampled[][]`, `nSamples`, `sampleRate`, `duration`, `filename`, `meta` |
| **Sortie** | Fichier `.xml` sur disque |

**Structure XML** :
- `<AnnotatedECG>` racine avec namespaces HL7
- `<id>` : identifiant unique du document
- `<subject>` : patient anonymisé
- `<series>` > `<sequenceSet>` contenant :
  - Un composant temps : point de départ (0s) + incrément (1/fréquence)
  - Un composant par dérivation : code MDC standard + valeurs en **microvolts** (mV × 1000)

Les codes de dérivation suivent la nomenclature MDC : `MDC_ECG_LEAD_I`, `MDC_ECG_LEAD_V1`, etc.

---

## Fonctions utilitaires (routes/ecg.ts)

### `resample(channels)`

Uniformise tous les canaux au même nombre d'échantillons par **interpolation linéaire**.

- Prend la fréquence la plus élevée parmi tous les canaux (ou 500Hz par défaut)
- Calcule le nombre de points cible : `fréquence × durée_max`
- Pour chaque canal, interpole linéairement entre les points existants

Nécessaire car les writers attendent des canaux de taille identique.

### `makeBase(manufacturer)`

Génère un nom de fichier unique : `ecg_<fabricant>_<timestamp>`.
Les caractères spéciaux du fabricant sont remplacés par `_`.

### `convertFormat(format, ...)`

Aiguilleur qui appelle le bon writer selon le format demandé.

---

## Scripts legacy

### `scripts/parse_xml_ecg.py`

**Statut** : DÉSACTIVÉ — la route `/api/ecg/parse-xml` a été supprimée pour des raisons de confidentialité (le XML contenant potentiellement des données patient transitait vers le serveur).

**Rôle** : parsait les fichiers XML ECG propriétaires (GE MUSE XML, Philips Sierra, HL7 aECG...) via la bibliothèque Python `ecg-datakit`, et renvoyait le signal en JSON.

**Remplacement prévu** : parsing côté client (dans le navigateur) pour éviter tout transit de données patient.

---

## Dépendances

### Production (`dependencies`)

| Package | Version | Rôle |
|---------|---------|------|
| `express` | ^4.18.2 | Serveur HTTP et routage |
| `cors` | ^2.8.5 | Headers CORS pour les requêtes cross-origin du frontend |
| `multer` | ^2.1.1 | Parsing multipart/form-data (upload de fichiers PDF pour /report) |
| `sharp` | ^0.33.2 | Conversion SVG → WebP (utilisé uniquement par le writer webp) |

### Développement (`devDependencies`)

| Package | Version | Rôle |
|---------|---------|------|
| `typescript` | ^5.2.2 | Compilateur TypeScript → JavaScript |
| `tsx` | ^4.7.0 | Exécution TypeScript directe en dev (`npm run dev`) |
| `@types/cors` | ^2.8.17 | Types TypeScript pour cors |
| `@types/express` | ^4.17.21 | Types TypeScript pour express |
| `@types/multer` | ^2.1.0 | Types TypeScript pour multer |
| `@types/node` | ^20.10.0 | Types TypeScript pour Node.js |

### Runtime système (installé dans le Dockerfile)

| Package | Rôle |
|---------|------|
| `fontconfig`, `font-dejavu` | Polices pour le rendu SVG → WebP (sharp) |
| `python3`, `py3-pip`, `py3-numpy`, `py3-scipy` | [LEGACY] Runtime Python pour parse_xml_ecg.py |
| `ecgdatakit` (pip) | [LEGACY] Bibliothèque de parsing XML ECG |

> Les dépendances Python peuvent être retirées du Dockerfile lorsque le parser XML sera définitivement supprimé.

---

## Tests unitaires

**Il n'y a actuellement aucun test unitaire.**

### Tests recommandés à implémenter

| Priorité | Cible | Ce qu'il faut tester |
|----------|-------|----------------------|
| **Haute** | `resample()` | Canal vide, canal à 1 point, canaux de tailles différentes, fréquences différentes, interpolation correcte |
| **Haute** | `writeEDF()` | Header conforme EDF+ (256 octets), conversion mV → int16 aller-retour, lecture avec pyedflib |
| **Haute** | `writeWFDB()` | Header .hea parsable, données .dat entrelacées, lecture avec wfdb-python |
| **Moyenne** | `writeDICOM()` | Tags DICOM valides, lecture avec pydicom |
| **Moyenne** | `writeHL7aECG()` | XML bien formé, valeurs en µV correctes, schéma HL7 valide |
| **Moyenne** | Path traversal | `GET /api/ecg/data/../../etc/passwd` → 403 |
| **Basse** | `writeWebP()` | Image générée non vide, résolution correcte |
| **Basse** | `writeHDF5()` | Structure lisible (magic + JSON + float32) |

### Tests d'intégration (round-trip)

Le test le plus important : **round-trip** — écrire un fichier puis le relire et vérifier que les valeurs mV sont identiques (à la précision 16 bits près pour EDF/WFDB/DICOM, exact pour HDF5/HL7).

---

## Evaluation de sécurité — Confidentialité

### Données qui transitent vers le serveur

| Donnée | Contient des infos patient ? | Remarque |
|--------|------------------------------|----------|
| Signal ECG (JSON via `/convert`) | **Partiellement** — le signal ECG lui-même est une donnée de santé, mais il est déjà anonymisé (pas de nom, pas d'ID). Le champ `manufacturer` ne contient aucune info patient. | Risque modéré |
| PDF anonymisé (via `/report`) | **Non** — le frontend anonymise le PDF avant envoi (suppression nom, ID, dates). | Risque faible si l'anonymisation frontend est correcte |
| Fichiers XML ECG | **[DÉSACTIVÉ]** — cette route envoyait le XML brut (avec potentiellement nom, ID, date de naissance) au serveur. C'est la raison de sa désactivation. | N/A |

### Points d'attention

| Risque | Niveau | Détail |
|--------|--------|--------|
| **Signal ECG = donnée de santé** | Moyen | Même sans nom/ID, un signal ECG est considéré comme donnée de santé au sens RGPD. Le signal transite en HTTPS mais est stocké dans `DATA_DIR` sur le serveur. |
| **Pas de nettoyage automatique** | Moyen | Les fichiers générés dans `DATA_DIR` ne sont jamais supprimés automatiquement. Ils s'accumulent. Un cron de nettoyage est recommandé. |
| **Pas d'authentification** | Elevé | L'API est ouverte — n'importe qui peut appeler `/convert` ou `/report`. En production, ajouter une authentification ou un rate limiting. |
| **Path traversal (GET /data)** | Faible | Protection existante : `filePath.startsWith(DATA_DIR)`. Cependant, cette vérification peut être contournée avec des encodages exotiques. Utiliser `path.resolve()` + vérification serait plus robuste. |
| **Injection dans le nom de fichier** | Faible | `makeBase()` nettoie le fabricant avec une regex `[^a-zA-Z0-9_-]`. Les noms de fichiers sont sûrs. |
| **GitHub token** | Faible | Le `GITHUB_TOKEN` est dans `.env` (gitignored). Il n'est utilisé que pour poster des commentaires sur une issue. Scope minimal recommandé. |
| **Taille des requêtes** | Faible | Limite à 60 Mo pour le JSON, 50 Mo pour les uploads PDF. Suffisant pour empêcher les abus basiques, mais pas de rate limiting. |

### Recommandations

1. **Ajouter un cron de nettoyage** de `DATA_DIR` (supprimer les fichiers > 24h)
2. **Ajouter une authentification** ou au minimum un rate limiting sur les routes
3. **Renforcer la protection path traversal** avec `path.resolve()` + vérification stricte
4. **Retirer les dépendances Python** du Dockerfile (legacy XML parser)
5. **Implémenter les tests round-trip** pour garantir la fidélité des conversions
6. **Évaluer si le signal ECG anonyme doit transiter** — idéalement, la conversion en formats médicaux se ferait aussi côté client (via WebAssembly ou JS pur) pour éliminer tout transit de données de santé

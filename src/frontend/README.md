# ECG Pipeline — Frontend

## Contexte

Le frontend est une application **React + TypeScript** construite avec **Vite**. C'est le coeur du pipeline : il extrait le signal ECG directement depuis un PDF vectorisé, **dans le navigateur de l'utilisateur**, sans envoyer le PDF à un serveur. Les données patient ne quittent jamais la machine.

L'extraction repose sur **pdfjs-dist** (la bibliothèque PDF de Mozilla Firefox) qui donne accès aux opérations vectorielles du PDF (tracés, couleurs, transformations). Le frontend identifie les courbes ECG, les lignes de grille, les pulses de calibration, et convertit le tout en valeurs millivolts.

## Architecture

```
src/frontend/src/
├── main.tsx                         # Point d'entrée React
├── App.tsx                          # Composant principal — orchestre le pipeline
├── index.css                        # Styles globaux (Tailwind CSS)
├── vite-env.d.ts                    # Types Vite
│
├── lib/                             # Logique métier (pas de React ici)
│   ├── ecg-extract.ts               # Extraction du signal depuis le PDF vectorisé
│   ├── pdf-config.ts                # Configuration pdfjs-dist (worker)
│   ├── pdf-anonymize.ts             # Anonymisation PDF côté client
│   ├── types.ts                     # Types TypeScript partagés
│   ├── xml-anonymize.ts             # [LEGACY] Anonymisation XML côté client
│   └── xml-extract.ts               # [LEGACY] Envoi XML au backend pour parsing
│
├── components/                      # Composants React UI
│   ├── DropZone.tsx                  # Zone de drag-and-drop pour upload PDF
│   ├── StatusBar.tsx                 # Barre de statut (extraction en cours, erreurs)
│   ├── StepIndicator.tsx             # Indicateur 4 étapes (Upload → Extract → Send → Download)
│   ├── ECGChannels.tsx               # Rendu du signal sur grille ECG (canvas)
│   ├── FormatCards.tsx               # Cartes de conversion (EDF, WFDB, DICOM...)
│   ├── AnonymizeCard.tsx             # Carte d'anonymisation PDF/XML
│   ├── MetadataGrid.tsx              # Grille de métadonnées (fabricant, layout, scale)
│   ├── InfoCard.tsx                  # Carte d'information (avant extraction)
│   ├── JsonViewer.tsx                # Affichage JSON brut des données extraites
│   ├── PdfPreview.tsx                # Rendu visuel du PDF original (canvas)
│   ├── LanguageToggle.tsx            # Bouton FR/EN
│   ├── ReportModal.tsx               # Modal de signalement de problème d'extraction
│   ├── DevModeView.tsx               # Mode développeur (comparaison PDF vs signal)
│   └── RoundTripCard.tsx             # Test round-trip (écriture → relecture)
│
└── i18n/                            # Internationalisation
    ├── index.ts                      # Export du hook useLanguage
    ├── LanguageContext.tsx            # Context React pour la langue
    └── translations.ts               # Traductions FR/EN
```

### Build et déploiement

Le frontend est compilé par Vite au stage 1 du Dockerfile, puis servi comme fichiers statiques par le backend Express sur `/ecg/`.

```bash
# Rebuild complet (frontend + backend)
docker compose build --no-cache web && docker compose up -d web
```

---

## Pipeline d'extraction — Flux de données

```
PDF vectorisé (fichier local de l'utilisateur)
  │
  ▼ pdfjs-dist : page.getOperatorList() + page.getTextContent()
  │
  ├─ Opérations vectorielles (moveTo, lineTo, stroke, couleurs, matrices)
  │    │
  │    ▼ parse() — reconstruit les polylines avec transformations CTM
  │    │
  │    ├─ Polylines noires (>50 pts) ─────────────── idTraces() → traces ECG
  │    ├─ Polylines colorées (horizontales/verticales) ── extractGridLines() → grille
  │    └─ Petites polylines noires (4-100 pts, hauteur ≈ 1mV) ── extractCalibrationBaselines() → baselines 0mV
  │
  └─ Texte (labels I, II, III, aVR, V1...)
       │
       ▼ assign() — associe chaque trace à un nom de dérivation
  
  detectLayout() → type de mise en page (stacked_12x1, sequential_6x2, grid_4x3)
  
  toPhysical() → convertit les coordonnées PDF en millivolts
    - baseline = position Y du pulse de calibration (0mV exact)
    - scale = espacement de la grille (pts/mm → pts/mV)
    - résultat : tableau de valeurs mV par dérivation

  │
  ▼
  ECGData JSON {manufacturer, layout, scale, channels[{name, samples[], duration_s, sample_rate_hz}]}
  │
  ├─ Rendu local (ECGChannels.tsx) — signal sur grille ECG canvas
  ├─ Export JSON (téléchargement direct)
  └─ Conversion via backend (POST /api/ecg/convert/:format) → EDF, WFDB, DICOM...
```

---

## Fichiers `lib/` — Logique métier

### `ecg-extract.ts` — Extraction du signal ECG

C'est le fichier le plus important et le plus complexe du projet. Il transforme un PDF vectorisé en données ECG numériques.

**Entrée** : `File` (PDF depuis le navigateur)
**Sortie** : `ECGData` (JSON avec les canaux, métadonnées, grille)

#### Fonctions principales

| Fonction | Rôle |
|----------|------|
| `extractFromPdf(file)` | Point d'entrée public. Charge le PDF, appelle `extract()` |
| `extract(page, filename)` | Orchestre tout : parse les paths, détecte la grille, assigne les labels, convertit en mV |
| `parse(ops, vp)` | Décide entre `parseWithCTM()` et `parseViewportOnly()` selon que les coordonnées CTM sont exploitables |
| `parseWithCTM(ops, vpT)` | Parcourt les opérations PDF en maintenant la pile de matrices de transformation (CTM). Reconstruit chaque polyline avec ses coordonnées transformées, sa couleur et son épaisseur |
| `parseViewportOnly(ops, vpT)` | Fallback : même chose mais ignore les transformations CTM (pour les PDF où le CTM produit des coordonnées hors limites) |
| `idTraces(P)` | Identifie les tracés ECG parmi toutes les polylines : noirs, >50 points, taille significative. Retourne max 15 candidats |
| `extractGridLines(P, vp)` | Identifie les lignes de grille : polylines non-noires, horizontales (dy<1.5) ou verticales (dx<1.5), couvrant >15% de la page. Déduplique, calcule l'espacement médian, détecte si c'est une grille 1mm ou 5mm |
| `computeScaleFromGrid(grid)` | Convertit l'espacement de la grille en échelle physique : pts/mm, pts/s, pts/mV |
| `extractCalibrationBaselines(P, sc, lay)` | Trouve les pulses de calibration 1mV (petites polylines noires dont la hauteur ≈ pts_per_mV). Le bas de chaque pulse = position exacte du 0mV |
| `findBaselineForTrace(pts, baselines, lay)` | Associe chaque tracé à la baseline de calibration la plus proche (par le centre vertical du tracé) |
| `detectLayout(tr, vp)` | Détermine la disposition des tracés : `stacked_12x1` (12 lignes empilées), `sequential_6x2` (2 colonnes de 6), `grid_4x3` (grille 4×3 + rhythm strip) |
| `assign(tr, lb, lay)` | Associe chaque tracé à un nom de dérivation (I, II, V1...) en utilisant les labels texte du PDF ou la position |
| `assignGrid4x3(tr, lb, vK)` | Assignation spécifique au layout 4×3 : sépare le rhythm strip, regroupe par colonnes, associe par position ou par labels |
| `toPhysical(pts, sc, lay, baseline)` | Convertit les coordonnées PDF en valeurs physiques : temps (secondes) et amplitude (millivolts). Utilise la baseline de calibration comme référence 0mV |
| `detectMfr(tr, fn)` | Détecte le fabricant à partir du nom de fichier et de la densité de points des tracés |

#### Helpers mathématiques

| Fonction | Rôle |
|----------|------|
| `matMul(m1, m2)` | Multiplication de matrices affines 2D (6 éléments : [a,b,c,d,e,f]) |
| `matApply(m, x, y)` | Applique une matrice affine à un point |
| `clusterValues(sorted, threshold)` | Regroupe des valeurs triées en clusters séparés par des écarts > seuil |

---

### `pdf-config.ts` — Configuration pdfjs-dist

Configure le web worker de pdfjs-dist. Le worker permet le parsing PDF en parallèle sans bloquer le thread principal de l'UI.

**Entrée** : aucune
**Sortie** : exporte `pdfjsLib` configuré, prêt à l'emploi

---

### `pdf-anonymize.ts` — Anonymisation PDF

Supprime les données patient d'un PDF, directement dans le navigateur.

**Entrée** : `File` (PDF) + `AnonMode` (`'smart'` ou `'full'`)
**Sortie** : `Uint8Array` (PDF anonymisé)

Deux modes :
- **smart** : supprime uniquement les données patient (nom, ID, date de naissance, sexe). Conserve les mesures ECG, diagnostics, paramètres d'acquisition.
- **full** : supprime TOUT le texte sauf les labels de dérivation (I, II, V1...).

Gère deux types de PDF :
- **Texte en clair** (Schiller, Mortara) : édition directe du flux de contenu PDF
- **Polices encodées** (GE MUSE) : fallback via pdfjs pour décoder, puis reconstruction avec pdf-lib

Supprime aussi les métadonnées, annotations et XMP.

---

### `types.ts` — Types TypeScript

Définit toutes les interfaces partagées entre les fichiers :

| Type | Rôle |
|------|------|
| `Point` | Coordonnée `{x, y}` |
| `Polyline` | Tracé vectoriel : points, couleur RGB, épaisseur, bounding box |
| `BoundingBox` | Boîte englobante avec centre et dimensions |
| `Label` | Texte extrait du PDF avec sa position |
| `Layout` | Type de mise en page + orientation des axes temps/voltage |
| `ScaleInfo` | Échelle physique (pts/mm, pts/s, pts/mV) |
| `GridInfo` | Lignes de grille détectées (positions H/V, espacement) |
| `ECGChannel` | Un canal ECG : nom, échantillons mV, durée, fréquence, bbox |
| `ECGData` | Résultat complet de l'extraction : fabricant, layout, scale, grille, canaux |
| `ServerResponse` | Réponse du backend après conversion |
| `FormatInfo` | Description d'un format de sortie (pour l'UI) |

---

### `xml-extract.ts` — [LEGACY] Extraction XML

**Statut** : DÉSACTIVÉ. Envoyait le fichier XML au backend pour parsing via ecg-datakit (Python). Désactivé pour raisons de confidentialité.

### `xml-anonymize.ts` — [LEGACY] Anonymisation XML

**Statut** : LEGACY. Fonctionnel mais inutilisé tant que l'import XML est désactivé. Supprime les données patient des fichiers XML ECG côté client.

---

## Composants React

### `App.tsx` — Orchestrateur principal

Gère l'état global de l'application et le flux en 4 étapes :
1. **Upload** : l'utilisateur dépose un PDF → `handleFile()`
2. **Extraction** : `extractFromPdf()` parse le PDF → `ECGData` en state
3. **Envoi** : l'utilisateur clique sur un format → `FormatCards` appelle le backend
4. **Téléchargement** : le fichier converti est téléchargé

Contient aussi le header (bouton home, mode dev, langue) et le routage conditionnel entre la vue normale et le mode développeur.

---

### `DropZone.tsx` — Zone d'upload

Zone de drag-and-drop et bouton de sélection de fichier. N'accepte que les `.pdf`. Appelle `onFile(file)` quand un fichier est déposé.

---

### `ECGImageView.tsx` — Affichage du signal (rendu Python)

**Composant principal d'affichage du signal extrait.** Remplace l'ancien `ECGChannels.tsx` (canvas custom) qui souffrait de bugs récurrents de positionnement de baseline et d'alignement de grille.

**Fonctionnement** :
1. Au montage du composant (et à chaque changement de `data`), envoie l'objet `ECGData` au backend via `POST /api/ecg/render-image`
2. Le backend génère une image WebP via un sous-processus Python (matplotlib + ecg_generator)
3. Reçoit le blob, crée une URL via `URL.createObjectURL` et l'affiche dans une `<img>`
4. Affiche un spinner pendant le rendu (1-3 secondes typiquement)
5. Gère les erreurs (réseau, Python crash) avec un message clair
6. Cleanup l'URL blob lors du démontage

**Avantages vs l'ancien canvas custom** :
- Rendu standard A4 papier ECG (matplotlib éprouvé, layout 6x2+1)
- Plus de bugs de baseline / phase de grille / décalage vertical
- Bonus : valide implicitement la conversion vers le format XML interne

**Trade-off** : latence de 1-3s à chaque extraction (vs affichage instantané du canvas).

### `ECGChannels.tsx` — [LEGACY] Canvas custom

Ancien composant qui dessinait le signal sur un canvas HTML avec grille maison. Conservé uniquement pour le mode développeur (`DevModeView`) où il sert encore à la comparaison côte-à-côte avec le PDF original. Plus utilisé dans le flux principal.

---

### `FormatCards.tsx` — Cartes de conversion / téléchargement

Affiche les formats de sortie disponibles. **Actuellement 3 cartes** :

| Carte | État | Route appelée | Sortie |
|-------|------|---------------|--------|
| **HL7 aECG XML** | actif | `POST /api/ecg/convert/hl7aecg` | JSON → fichier `.xml` téléchargeable |
| **PDF Vectoriel** | en dev (popup) | — | — |
| **Image** | actif | `POST /api/ecg/render-image` | binaire WebP direct → blob URL téléchargeable |

Le composant gère deux types de flow :
- **`json-format`** : reçoit du JSON, télécharge via `/api/ecg/data/:filename`
- **`binary-image`** : reçoit du WebP en binaire, crée un blob URL local

Les cartes "en développement" affichent une popup modale "En cours de développement" au clic.

---

### `AnonymizeCard.tsx` — Anonymisation

Carte avec deux modes (smart/full). Appelle `anonymizePdf()` (de `pdf-anonymize.ts`) directement dans le navigateur. Le PDF anonymisé est téléchargé localement — jamais envoyé au serveur.

Affiche un aperçu texte du résultat (pour vérifier ce qui a été supprimé).

---

### `DevModeView.tsx` — Mode développeur

Vue côté-à-côte pour le debug d'extraction :
- **Gauche** : bande du PDF original (rendu via pdfjs) pour chaque dérivation
- **Droite** : signal extrait sur grille ECG (via `ECGChannels`)
- Métadonnées, JSON brut, et outil de round-trip (`RoundTripCard`)

Permet de comparer visuellement si le signal extrait correspond au PDF original.

---

### `RoundTripCard.tsx` — Test aller-retour

Teste la fidélité de la conversion : écrit le signal dans un format, le relit, et compare avec l'original.
- Convertit via le backend
- Relit le fichier généré (actuellement seul le round-trip image WebP est implémenté ; HL7 aECG est désactivé)
- Affiche les signaux original vs relu côte à côte

---

### `ReportModal.tsx` — Signalement de problème

Modal pour signaler un problème d'extraction. Processus :
1. Anonymise le PDF côté client (mode full)
2. Envoie le PDF anonymisé au backend `POST /api/ecg/report`
3. Le backend le sauvegarde et poste un commentaire sur l'issue GitHub

---

### `PdfPreview.tsx` — Rendu PDF

Affiche le PDF complet dans un canvas via pdfjs. Utilisé dans le mode développeur.

### `MetadataGrid.tsx` — Métadonnées

Grille affichant les infos extraites : fabricant, layout, nombre de canaux, fréquence, durée, échelle.

### `StatusBar.tsx` — Barre de statut

Affiche les messages d'état : extraction en cours (spinner), succès (tags verts), ou erreur (texte rouge).

### `StepIndicator.tsx` — Indicateur de progression

Barre de progression 4 étapes : Upload → Extraction → Envoi → Téléchargement.

### `InfoCard.tsx` — Carte d'information

Affichée avant l'extraction. Explique le fonctionnement du pipeline à l'utilisateur.

### `JsonViewer.tsx` — Affichage JSON

Affiche les données ECG brutes en JSON formaté (limité à 100 000 caractères).

### `LanguageToggle.tsx` — Sélecteur de langue

Bouton FR/EN dans le header.

---

## Internationalisation (`i18n/`)

Système de traduction maison basé sur React Context.

- **`LanguageContext.tsx`** : Context React stockant la langue courante (`'fr'` ou `'en'`), persistée en `localStorage`
- **`translations.ts`** : Dictionnaire de traductions FR/EN (~100 clés)
- **`index.ts`** : Réexporte le hook `useLanguage()` et le type `TranslationKey`

Usage dans un composant : `const { t, lang, setLang } = useLanguage();` puis `t('drop.label')`.

---

## Dépendances

### Production (`dependencies`)

| Package | Version | Rôle |
|---------|---------|------|
| `react` | ^18.2.0 | Framework UI |
| `react-dom` | ^18.2.0 | Rendu React dans le DOM |
| `pdfjs-dist` | ^4.9.155 | Parsing PDF vectorisé (extraction des opérations graphiques) |
| `pdf-lib` | ^1.17.1 | Manipulation PDF (anonymisation : suppression de texte, métadonnées) |

Note : `pako` (décompression zlib) est utilisé par `pdf-anonymize.ts` mais importé indirectement.

### Développement (`devDependencies`)

| Package | Version | Rôle |
|---------|---------|------|
| `vite` | ^5.0.8 | Bundler/dev server |
| `@vitejs/plugin-react` | ^4.2.1 | Support JSX/React dans Vite |
| `typescript` | ^5.2.2 | Compilateur TypeScript |
| `tailwindcss` | ^3.4.19 | Framework CSS utilitaire |
| `postcss` | ^8.5.8 | Transformations CSS (requis par Tailwind) |
| `autoprefixer` | ^10.4.27 | Ajout automatique des préfixes CSS navigateur |
| `@types/react` | ^18.2.43 | Types TypeScript pour React |
| `@types/react-dom` | ^18.2.17 | Types TypeScript pour ReactDOM |
| `@types/pako` | ^2.0.4 | Types TypeScript pour pako |

---

## Tests unitaires

**Il n'y a actuellement aucun test unitaire.**

### Tests recommandés à implémenter

| Priorité | Cible | Ce qu'il faut tester |
|----------|-------|----------------------|
| **Haute** | `extractFromPdf()` | Round-trip avec des PDF de test connus (GE MUSE, Schiller, Mortara). Vérifier le nombre de canaux, les noms, les ranges mV attendues |
| **Haute** | `extractGridLines()` | Détection correcte des lignes de grille sur des PDF avec grille 1mm vs 5mm |
| **Haute** | `extractCalibrationBaselines()` | Détection des pulses de calibration, position exacte du 0mV |
| **Haute** | `toPhysical()` | Conversion coordonnées PDF → mV correcte. Vérifier le signe (vI) et la baseline |
| **Moyenne** | `detectLayout()` | Identification correcte du layout pour chaque type de PDF |
| **Moyenne** | `assign()` | Correspondance correcte trace → nom de dérivation |
| **Moyenne** | `anonymizePdf()` | Vérifier que les données patient sont supprimées et que les labels ECG sont conservés |
| **Basse** | Composants React | Rendu correct de `ECGChannels`, `FormatCards`, `DropZone` |

### Données de test disponibles

Des PDF de test existent dans `data_test/` :
- `MUSE_12 Lead ECG_*.PDF` — GE MUSE, layout sequential_6x2
- `NODATA_NODATA_*.pdf` — Schiller, layout stacked_12x1
- `ptbxl_record_*.pdf` — PTB-XL, layout variable

---

## Evaluation de sécurité — Confidentialité

### Ce qui reste dans le navigateur (jamais envoyé)

| Donnée | Détail |
|--------|--------|
| **PDF original** | Jamais uploadé. Le parsing est 100% côté client via pdfjs-dist |
| **Données patient du PDF** | Nom, ID, dates — restent dans le navigateur. L'anonymisation se fait localement |
| **Signal ECG brut** (coordonnées PDF) | Les coordonnées vectorielles du PDF restent dans le navigateur |

### Ce qui est envoyé au serveur

| Donnée | Route | Contient des infos patient ? |
|--------|-------|------------------------------|
| Signal ECG en mV (JSON) | `POST /api/ecg/convert/:format` | **Signal uniquement** — pas de nom, ID, date. Mais le signal ECG est une donnée de santé au sens RGPD |
| PDF anonymisé | `POST /api/ecg/report` | **Non** — anonymisé côté client avant envoi |

### Points d'attention

| Risque | Niveau | Détail |
|--------|--------|--------|
| **Le signal ECG est une donnée de santé** | Moyen | Même sans identifiant, un ECG est considéré comme donnée de santé. Le signal est envoyé au serveur pour la conversion en formats médicaux |
| **Qualité de l'anonymisation PDF** | Moyen | L'anonymisation smart repose sur des patterns regex pour identifier les données patient. Un format de PDF inhabituel pourrait laisser passer des infos |
| **pdf-lib en mode full** | Faible | Le mode full supprime TOUT le texte sauf les labels ECG — plus sûr mais perd les mesures/diagnostics |
| **localStorage** | Faible | Seule la préférence de langue est stockée. Aucune donnée patient |
| **Pas de CSP stricte** | Faible | Le Content-Security-Policy n'est pas configuré. Un XSS pourrait exfiltrer les données en mémoire |

### Recommandations

1. **Conversion côté client** — Idéalement, les writers (EDF, WFDB...) devraient tourner dans le navigateur (via JS ou WASM) pour éliminer tout transit de données de santé vers le serveur
2. **CSP stricte** — Ajouter des headers Content-Security-Policy pour limiter les risques XSS
3. **Audit de l'anonymisation** — Tester l'anonymisation smart sur un corpus de PDF de fabricants variés pour vérifier qu'aucune info patient ne passe
4. **Tests automatisés round-trip** — Pour chaque PDF de test, vérifier que les valeurs mV extraites correspondent à celles attendues (vérification manuelle initiale, puis automatisée)

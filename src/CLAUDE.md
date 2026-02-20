# ECG PDF Signal Extractor

## Objectif
Extraire les signaux ECG numériques depuis des PDF vectorisés (tout fabricant) côté navigateur, puis les convertir côté serveur en 5 formats standards.

## Architecture

```
ecg_extractor.html  →  POST JSON  →  ecg_receive.php  →  data/*.{edf,hea,dat,dcm,h5,webp}
   (client JS)                          (serveur PHP)
```

### Client (`ecg_extractor.html`)
- **pdf.js 4.9.155** (CDN) pour parser le PDF côté client
- Parse `getOperatorList()` pour extraire les polylignes vectorielles (moveTo/lineTo/stroke)
- Applique la transformation viewport (gère la rotation des pages A4 landscape)
- Filtre les paths noirs >50 points = traces ECG
- Détecte le layout automatiquement :
  - `stacked_12x1` : chaque trace couvre >50% de la largeur (Philips/Spacelabs, 10s par canal)
  - `sequential_6x2` : 2 bandes de 6 canaux (Schiller, GE MUSE, ~5s par canal)
- Assigne les noms de dérivations via matching positionnel labels ↔ traces (split par bande)
- **Soustraction de la médiane** comme baseline (robuste aux QRS)
- Conversion en mV/s via géométrie de page + échelle standard (25mm/s, 10mm/mV)
- Envoie le JSON au serveur, affiche les liens de téléchargement des 5 formats

### Serveur (`ecg_receive.php`)
- Reçoit le JSON, rééchantillonne tous les canaux à un taux uniforme
- Génère 5 formats dans `data/` :
  1. **EDF+** (.edf) — European Data Format, standard polysomnographie/ECG
  2. **WFDB** (.hea + .dat) — PhysioNet, standard recherche cardiologie
  3. **DICOM Waveform** (.dcm) — Standard hospitalier, compatible PACS
  4. **HDF5-lite** (.h5) — Format binaire auto-descriptif (JSON header + float32)
  5. **WebP 4K** (.webp) — Image 3840×2160 avec grille ECG standard
- Retourne un JSON avec les noms de fichiers pour téléchargement

## Fabricants testés
| Fabricant | Layout | Points/trace | Durée | Axe temps |
|-----------|--------|-------------|-------|-----------|
| Schiller (SCM 310) | 6×2 | ~357 | 5s | Y (vertical) |
| GE MUSE (12SL) | 6×2 | ~2487 | 5s | Y (vertical) |
| Philips/Spacelabs | 12×1 | ~3700-4100 | 10s | X (horizontal) |

## Algorithme de détection des traces

1. Parser les opérateurs PDF → paths (séquences moveTo/lineTo/stroke)
2. Transformer en coordonnées viewport
3. Filtrer : couleur noire (RGB < 0.15), >50 points
4. Trier par nombre de points décroissant, garder ceux ≥15% du max
5. Calculer bounding boxes (minX, maxX, minY, maxY, centre)
6. Détecter layout par ratio dx/dy et couverture de largeur

## Algorithme d'assignation des dérivations

### Layout 12×1 (Philips)
- Trier traces par cy (haut→bas), labels par y → matching direct

### Layout 6×2 (Schiller/MUSE)
- Séparer traces en 2 bandes par le cy médian (haut = I-aVF, bas = V1-V6)
- Séparer labels en 2 groupes par le y médian
- Trier chaque groupe par x → matching par position
- Tri final par ordre standard (I, II, III, aVR, aVL, aVF, V1-V6)

## Dépendances serveur
- PHP ≥ 7.4 avec extension GD (`php-gd`)
- Police TrueType (DejaVu, Liberation...) pour les labels image

## Formats de sortie — détails

### EDF+ (European Data Format)
- Header 256 octets global + 256 par signal
- Données int16 little-endian, séquentielles par canal dans chaque record
- Un seul data record couvrant toute la durée

### WFDB (PhysioNet)
- `.hea` : en-tête texte (nom, nb signaux, fréquence, gain par canal)
- `.dat` : int16 little-endian, entrelacé (sample1_ch1, sample1_ch2, ..., sample2_ch1, ...)

### DICOM Waveform
- Preamble 128 octets + "DICM" + tags Explicit VR Little Endian
- SOP Class : 12-Lead ECG (1.2.840.10008.5.1.4.1.1.9.1.1)
- Waveform Sequence (5400,0100) avec Channel Definition + Waveform Data (OW)

### HDF5-lite
- Magic bytes HDF5 + header JSON (métadonnées) + float32 channels_first
- Auto-descriptif, lisible avec un script Python minimal

### WebP 4K
- 3840×2160, grille ECG (1mm rose clair / 5mm rose foncé)
- Pulse de calibration 1mV/200ms, labels, info fabricant
- Qualité WebP 85

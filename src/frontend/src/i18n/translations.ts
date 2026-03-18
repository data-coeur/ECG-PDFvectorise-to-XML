const translations = {
  fr: {
    // Header
    'app.title': 'Extracteur ECG',
    'app.subtitle': 'Extraction du signal & conversion en formats standards',

    // Steps
    'step.upload': 'Upload',
    'step.extract': 'Extraction',
    'step.send': 'Envoi',
    'step.download': 'Téléchargement',

    // DropZone
    'drop.label': 'Glissez un fichier ECG ici ou cliquez',
    'drop.sub': 'PDF vectorisé ou XML propriétaire (Philips, MUSE, HL7, Mortara)',

    // Buttons
    'btn.send': 'Envoyer au serveur',
    'btn.json': 'JSON local',
    'btn.rawJson': 'JSON brut',

    // Status
    'status.extracting': 'Extraction...',
    'status.nonPdf': 'Fichier non-PDF',
    'status.unsupported': 'Format non supporté (PDF ou XML attendu)',
    'status.noSignal': 'Aucun signal ECG vectoriel',
    'status.sending': 'Envoi et conversion...',
    'status.error': 'Erreur',
    'status.serverError': 'Erreur serveur',
    'status.channels': 'canaux',
    'status.formats': 'formats générés',

    // Metadata
    'meta.manufacturer': 'Fabricant',
    'meta.layout': 'Disposition',
    'meta.channels': 'Canaux',
    'meta.scale': 'Échelle',

    // Layout labels
    'layout.grid_4x3': 'Grille 4×3',
    'layout.sequential_6x2': 'Séquentiel 6×2',
    'layout.stacked_12x1': 'Empilé 12×1',

    // Results
    'results.title': 'Signaux extraits',

    // Format cards
    'fmt.title': 'Convertir et télécharger',
    'fmt.convert': 'Convertir',
    'fmt.converting': 'Conversion...',
    'fmt.download': 'Télécharger',
    'fmt.error': 'Erreur',

    // Downloads
    'dl.title': 'Fichiers générés — cliquez pour télécharger',
    'dl.edf.desc': 'European Data Format — Standard ouvert pour les signaux physiologiques. Lisible par EDFbrowser, Polyman, MATLAB, Python (pyedflib).',
    'dl.wfdb.desc': 'WaveForm DataBase — Format de PhysioNet (MIT). Fichier .hea + .dat. Standard de référence pour la recherche en cardiologie.',
    'dl.dicom.desc': 'DICOM Waveform — Format standard hospitalier pour l\'imagerie et les signaux médicaux. Compatible PACS.',
    'dl.hdf5.desc': 'Hierarchical Data Format v5 — Format binaire haute performance. Utilisé par la NASA, le CERN, et en deep learning.',
    'dl.webp.desc': 'Image 4K (3840×2160) avec grille ECG standard, pulse de calibration 1mV/200ms et labels.',
    'dl.hl7.desc': 'HL7 Annotated ECG (aECG) XML — Format FDA pour la soumission réglementaire. Compatible avec les systèmes HL7 v3.',
    'dl.badge.std': 'Standard',
    'dl.badge.physionet': 'PhysioNet',
    'dl.badge.medical': 'Médical',
    'dl.badge.scientific': 'Scientifique',
    'dl.badge.image': 'Image',
    'dl.badge.fda': 'FDA/HL7',

    // Info card
    'info.principle.title': 'Principe',
    'info.principle.text': 'Cet outil extrait le signal électrique depuis un ECG au format PDF vectorisé, puis le convertit en formats numériques standards. L\'extraction est réalisée directement dans votre navigateur — aucune donnée patient n\'est extraite ni transmise.',
    'info.upload.title': 'Upload',
    'info.upload.text': 'Déposez un PDF ECG vectorisé (non scanné). Les principaux fabricants sont supportés : Schiller, GE MUSE, Philips, Mortara/Burdick, et autres. Le fichier est lu localement par votre navigateur.',
    'info.extract.title': 'Extraction',
    'info.extract.text': 'Le signal est extrait en analysant les tracés vectoriels (chemins SVG) contenus dans le PDF. Les 12 dérivations standard sont identifiées automatiquement avec leur calibration (gain, vitesse).',
    'info.convert.title': 'Conversion',
    'info.convert.text': 'Le signal extrait peut être converti en 6 formats : EDF+ (standard ouvert), WFDB (PhysioNet), DICOM (hospitalier), HDF5 (scientifique), WebP (image 4K), HL7 aECG (FDA). La conversion est effectuée côté serveur.',
    'info.privacy.title': 'Confidentialité',
    'info.privacy.text': 'Seul le signal numérique brut est envoyé au serveur pour conversion. Les données patient (nom, date de naissance, identifiants) contenues dans le PDF ne sont jamais extraites ni transmises.',

    // Header buttons
    'btn.home': 'Accueil',
    'btn.devMode': 'Mode développeur',

    // Anonymization
    'anon.title': 'Anonymisation PDF',
    'anon.title.xml': 'Anonymisation XML',
    'anon.smart.label': 'Retirer données patient',
    'anon.smart.desc': 'Supprime les données personnelles (nom, date de naissance, identifiants). Les dérivations, mesures et infos ECG sont conservés.',
    'anon.smart.action': 'Anonymiser',
    'anon.smart.done': 'Données patient retirées',
    'anon.badge.smart': 'Vie privée',
    'anon.full.label': 'Vider tout sauf la grille',
    'anon.full.desc': 'Supprime tout le texte du PDF. Seuls la grille ECG et les tracés sont conservés. Anonymisation maximale garantie.',
    'anon.full.action': 'Vider le texte',
    'anon.badge.full': 'Nettoyage total',
    'anon.processing': 'Anonymisation & vérification...',
    'anon.download': 'Télécharger',
    'anon.verified': 'Vérifié : 0 texte restant',
    'anon.removed': 'éléments texte supprimés',
    'anon.error': 'Erreur',

    // Dev mode
    'dev.pdfSource': 'Source PDF',
    'dev.extractedSignals': 'Signaux extraits',
    'dev.details': 'Détails d\'extraction',
    'dev.channelDetails': 'Détails par canal',
    'dev.samples': 'échantillons',
    'dev.pageDimensions': 'Dimensions page',
  },
  en: {
    // Header
    'app.title': 'ECG Extractor',
    'app.subtitle': 'Signal extraction & standard format conversion',

    // Steps
    'step.upload': 'Upload',
    'step.extract': 'Extract',
    'step.send': 'Send',
    'step.download': 'Download',

    // DropZone
    'drop.label': 'Drop an ECG file here or click',
    'drop.sub': 'Vectorized PDF or proprietary XML (Philips, MUSE, HL7, Mortara)',

    // Buttons
    'btn.send': 'Send to server',
    'btn.json': 'Local JSON',
    'btn.rawJson': 'Raw JSON',

    // Status
    'status.extracting': 'Extracting...',
    'status.nonPdf': 'Not a PDF file',
    'status.unsupported': 'Unsupported format (PDF or XML expected)',
    'status.noSignal': 'No vectorized ECG signal found',
    'status.sending': 'Sending & converting...',
    'status.error': 'Error',
    'status.serverError': 'Server error',
    'status.channels': 'channels',
    'status.formats': 'formats generated',

    // Metadata
    'meta.manufacturer': 'Manufacturer',
    'meta.layout': 'Layout',
    'meta.channels': 'Channels',
    'meta.scale': 'Scale',

    // Layout labels
    'layout.grid_4x3': '4×3 Grid',
    'layout.sequential_6x2': '6×2 Sequential',
    'layout.stacked_12x1': '12×1 Stacked',

    // Results
    'results.title': 'Extracted signals',

    // Format cards
    'fmt.title': 'Convert & download',
    'fmt.convert': 'Convert',
    'fmt.converting': 'Converting...',
    'fmt.download': 'Download',
    'fmt.error': 'Error',

    // Downloads
    'dl.title': 'Generated files — click to download',
    'dl.edf.desc': 'European Data Format — Open standard for physiological signals. Readable by EDFbrowser, Polyman, MATLAB, Python (pyedflib).',
    'dl.wfdb.desc': 'WaveForm DataBase — PhysioNet (MIT) format. .hea + .dat files. Gold standard for cardiology research.',
    'dl.dicom.desc': 'DICOM Waveform — Hospital standard for medical imaging and signals. PACS compatible.',
    'dl.hdf5.desc': 'Hierarchical Data Format v5 — High-performance binary format. Used by NASA, CERN, and in deep learning.',
    'dl.webp.desc': '4K image (3840×2160) with standard ECG grid, 1mV/200ms calibration pulse and labels.',
    'dl.hl7.desc': 'HL7 Annotated ECG (aECG) XML — FDA format for regulatory submission. Compatible with HL7 v3 systems.',
    'dl.badge.std': 'Standard',
    'dl.badge.physionet': 'PhysioNet',
    'dl.badge.medical': 'Medical',
    'dl.badge.scientific': 'Scientific',
    'dl.badge.image': 'Image',
    'dl.badge.fda': 'FDA/HL7',

    // Info card
    'info.principle.title': 'Principle',
    'info.principle.text': 'This tool extracts the electrical signal from a vectorized PDF ECG, then converts it into standard digital formats. Extraction runs entirely in your browser — no patient data is extracted or transmitted.',
    'info.upload.title': 'Upload',
    'info.upload.text': 'Drop a vectorized (not scanned) ECG PDF. Major manufacturers are supported: Schiller, GE MUSE, Philips, Mortara/Burdick, and others. The file is read locally by your browser.',
    'info.extract.title': 'Extraction',
    'info.extract.text': 'The signal is extracted by analyzing vector paths (SVG paths) embedded in the PDF. All 12 standard leads are automatically identified along with their calibration (gain, speed).',
    'info.convert.title': 'Conversion',
    'info.convert.text': 'The extracted signal can be converted into 6 formats: EDF+ (open standard), WFDB (PhysioNet), DICOM (hospital), HDF5 (scientific), WebP (4K image), HL7 aECG (FDA). Conversion is performed server-side.',
    'info.privacy.title': 'Privacy',
    'info.privacy.text': 'Only the raw digital signal is sent to the server for conversion. Patient data (name, date of birth, identifiers) contained in the PDF is never extracted or transmitted.',

    // Header buttons
    'btn.home': 'Home',
    'btn.devMode': 'Developer mode',

    // Anonymization
    'anon.title': 'PDF Anonymization',
    'anon.title.xml': 'XML Anonymization',
    'anon.smart.label': 'Remove patient data',
    'anon.smart.desc': 'Removes personal data (name, date of birth, identifiers). Lead labels, measurements and ECG info are preserved.',
    'anon.smart.action': 'Anonymize',
    'anon.smart.done': 'Patient data removed',
    'anon.badge.smart': 'Privacy',
    'anon.full.label': 'Strip all except grid',
    'anon.full.desc': 'Removes all text from the PDF. Only the ECG grid and traces are kept. Maximum anonymization guaranteed.',
    'anon.full.action': 'Strip text',
    'anon.badge.full': 'Full strip',
    'anon.processing': 'Anonymizing & verifying...',
    'anon.download': 'Download',
    'anon.verified': 'Verified: 0 text remaining',
    'anon.removed': 'text items removed',
    'anon.error': 'Error',

    // Dev mode
    'dev.pdfSource': 'PDF Source',
    'dev.extractedSignals': 'Extracted Signals',
    'dev.details': 'Extraction Details',
    'dev.channelDetails': 'Channel Details',
    'dev.samples': 'samples',
    'dev.pageDimensions': 'Page Dimensions',
  },
} as const;

export type Lang = keyof typeof translations;
export type TranslationKey = keyof typeof translations['fr'];
export default translations;

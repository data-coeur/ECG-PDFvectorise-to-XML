const translations = {
  fr: {
    // Header
    'app.title': 'ECG PDF → Signal Numérique',
    'app.subtitle': 'Extraction vectorielle · Schiller, GE MUSE, Philips et autres',

    // Steps
    'step.upload': 'Upload',
    'step.extract': 'Extraction',
    'step.send': 'Envoi',
    'step.download': 'Téléchargement',

    // DropZone
    'drop.label': 'Glissez un PDF ECG ici ou cliquez',
    'drop.sub': 'PDF vectorisé de n\'importe quel fabricant ECG',

    // Buttons
    'btn.send': 'Envoyer au serveur',
    'btn.json': 'JSON local',
    'btn.rawJson': 'JSON brut',

    // Status
    'status.extracting': 'Extraction...',
    'status.nonPdf': 'Fichier non-PDF',
    'status.noSignal': 'Aucun signal ECG vectoriel',
    'status.sending': 'Envoi et conversion...',
    'status.error': 'Erreur',
    'status.serverError': 'Erreur serveur',
    'status.channels': 'canaux',
    'status.formats': 'formats générés',

    // Metadata
    'meta.manufacturer': 'Fabricant',
    'meta.layout': 'Layout',
    'meta.channels': 'Canaux',
    'meta.scale': 'Échelle',

    // Results
    'results.title': 'Signaux extraits',

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
  },
  en: {
    // Header
    'app.title': 'ECG PDF → Digital Signal',
    'app.subtitle': 'Vector extraction · Schiller, GE MUSE, Philips and others',

    // Steps
    'step.upload': 'Upload',
    'step.extract': 'Extract',
    'step.send': 'Send',
    'step.download': 'Download',

    // DropZone
    'drop.label': 'Drop an ECG PDF here or click',
    'drop.sub': 'Vectorized PDF from any ECG manufacturer',

    // Buttons
    'btn.send': 'Send to server',
    'btn.json': 'Local JSON',
    'btn.rawJson': 'Raw JSON',

    // Status
    'status.extracting': 'Extracting...',
    'status.nonPdf': 'Not a PDF file',
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

    // Results
    'results.title': 'Extracted signals',

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
  },
} as const;

export type Lang = keyof typeof translations;
export type TranslationKey = keyof typeof translations['fr'];
export default translations;

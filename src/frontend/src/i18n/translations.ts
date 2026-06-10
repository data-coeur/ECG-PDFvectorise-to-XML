// translations — dictionnaires FR / EN clé → texte, plus le type
// `TranslationKey` (intersection des clés des deux langues, pour repérer les
// trous au compile-time). Interpolation : `{name}` dans le texte, remplacé par
// LanguageContext.t(key, { name: '...' }).
// Toute l'app appelle t('clef.dot.notation') ; ajouter une clef ici se voit partout.

const translations = {
  fr: {
    // Header
    'app.title': 'Cardio Capture',
    'app.subtitle': 'De vos ECG en PDF vectoriel vers des formats numériques standards',

    // Steps
    'step.upload': 'Upload',
    'step.extract': 'Extraction',
    'step.send': 'Envoi',
    'step.download': 'Téléchargement',

    // DropZone
    'drop.label': 'Glissez un fichier ECG ici ou cliquez',
    'drop.sub': 'PDF vectorisé (GE MUSE, Schiller, Mortara, Philips...)',
    'drop.preparing': 'Analyse des fichiers...',
    'drop.preparingSingle': 'Lecture et découpe du PDF',
    'drop.preparingProgress': 'Fichier {done} / {total}',

    // Batch conversion
    'batch.button': 'Traiter une base de données complète',
    'batch.title': 'Conversion par lot',
    'batch.standard.subtitle': 'Pour traiter une base d\'ECG complète, deux solutions sont à votre disposition :',
    'batch.stop': 'Arrêter',
    'batch.stopped': 'Interrompu',
    'batch.option1.title': 'Confier le traitement à notre équipe',
    'batch.option1.desc': 'Nous convertissons votre base de données pour vous. Cliquez pour nous contacter.',
    'batch.option2.title': 'Déployer la solution sur vos serveurs',
    'batch.option2.desc': 'Solution open-source à installer en interne, conforme aux exigences de confidentialité hospitalières.',
    'batch.option2.github': 'Code source',
    'batch.option2.tutorial': 'Guide d\'installation',
    'batch.close': 'Fermer',

    // Buttons
    'btn.send': 'Envoyer au serveur',
    'btn.json': 'JSON local',
    'btn.rawJson': 'JSON brut',

    // Status
    'status.extracting': 'Extraction...',
    'status.nonPdf': 'Fichier non-PDF',
    'status.unsupported': 'Format non supporté (PDF vectorisé attendu)',
    'status.noSignal': 'Aucun signal ECG vectoriel',
    'status.noEcgPage': 'Pas d\'ECG détecté dans cette page',
    'status.noGrid': 'Quadrillage ECG non détecté — ce format ne peut pas être converti. Utilisez "Signaler" pour nous envoyer le fichier.',
    'status.sending': 'Envoi et conversion...',
    'status.error': 'Erreur',
    'status.timeout': 'Extraction expirée (30 s) — le fichier est probablement dans un format non supporté',
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
    'fmt.convertAll': 'Tout convertir',
    'fmt.pdf.raw': 'PDF original (brut)',
    'fmt.pdf.rawDesc': 'Le fichier PDF tel que vous l\'avez fourni, sans aucune modification.',
    'fmt.pdf.anon': 'PDF anonymisé',
    'fmt.pdf.anonDesc': 'Données patient supprimées. Les tracés ECG et la grille sont conservés.',
    'fmt.batch.zip': 'Télécharger en ZIP',
    'fmt.batch.zipDesc': 'Un seul fichier ZIP contenant tous les ECG convertis.',
    'fmt.batch.files': 'Télécharger fichier par fichier',
    'fmt.batch.filesDesc': 'Chaque fichier est téléchargé séparément.',
    'fmt.download': 'Télécharger',
    'fmt.img.title': 'Télécharger le tracé rendu',
    'fmt.img.webp': 'Image (WebP)',
    'fmt.img.webpDesc': 'Image matricielle du tracé ECG.',
    'fmt.img.pdf': 'PDF vectoriel',
    'fmt.img.pdfDesc': 'PDF vectoriel scalable, même mise en page que l\'image.',
    'fmt.anonName': 'Nom de fichier anonymisé',
    'fmt.xml.title': 'Télécharger le HL7 aECG XML',
    'fmt.xml.note': 'Le contenu est déjà anonyme (aucune donnée patient). Le choix porte sur le nom du fichier.',
    'fmt.error': 'Erreur',

    // Downloads
    'dl.title': 'Fichiers générés — cliquez pour télécharger',
    'dl.edf.desc': 'European Data Format — Standard ouvert pour les signaux physiologiques. Lisible par EDFbrowser, Polyman, MATLAB, Python (pyedflib).',
    'dl.wfdb.desc': 'WaveForm DataBase — Format de PhysioNet (MIT). Fichier .hea + .dat. Standard de référence pour la recherche en cardiologie.',
    'dl.dicom.desc': 'DICOM Waveform — Format standard hospitalier pour l\'imagerie et les signaux médicaux. Compatible PACS.',
    'dl.hdf5.desc': 'Hierarchical Data Format v5 — Format binaire haute performance. Utilisé par la NASA, le CERN, et en deep learning.',
    'dl.webp.desc': 'Image 4K (3840×2160) avec grille ECG standard, pulse de calibration 1mV/200ms et labels.',
    'dl.hl7.desc': 'Format XML standard pour l\'échange et l\'analyse de données ECG.',
    'dl.pdfvec.desc': 'PDF vectoriel du tracé ECG, anonymisé (contenu et nom du fichier).',
    'dl.image.desc': 'Image du tracé ECG.',
    'dl.badge.std': 'Standard',
    'dl.badge.physionet': 'PhysioNet',
    'dl.badge.medical': 'Médical',
    'dl.badge.scientific': 'Scientifique',
    'dl.badge.image': 'Image',
    'dl.badge.fda': 'FDA/HL7',
    'dl.badge.wip': 'En dev',
    'fmt.wip.title': 'En cours de développement',
    'fmt.wip.body': 'Cette fonctionnalité n\'est pas encore disponible. Elle sera ajoutée dans une prochaine version.',
    'fmt.wip.close': 'Fermer',
    'image.rendering': 'Génération de l\'image ECG...',
    'image.error': 'Erreur de rendu',
    'image.zoom': 'Cliquer pour agrandir',
    'image.zoom.generated': 'Image générée',
    'image.zoom.original': 'PDF original',
    'image.transform.truncated': 'Le format {layout} ne conserve que les {tgt} premières secondes du tracé d\'origine ({src} s par dérivation).',
    'image.unavailable.title': 'Format indisponible',
    'image.unavailable.duration': 'Le signal enregistré ne dure que {duration} s par dérivation. Ce format nécessite un signal plus long et ne peut pas être généré sans répéter artificiellement le tracé. Le format natif de cet ECG est {layout}.',
    'image.unavailable.rhythm': 'Ce format inclut une dérivation longue (rhythm strip) en bas de page. L\'ECG source ne contient pas de dérivation longue dédiée, il n\'est donc pas possible de générer ce format sans fabriquer artificiellement cette ligne.',

    // Info card
    'info.principle.title': 'Principe',
    'info.principle.text': 'Capture ECG convertit vos ECG en formats numériques standards, utilisables en clinique comme en recherche. L\'outil prend en charge les PDF vectoriels issus des appareils ECG. Les données patient ne quittent jamais votre poste — seul le signal numérique est transmis au serveur le temps de la conversion.',
    'info.upload.title': 'Upload',
    'info.upload.text': 'Déposez un ECG. Les fichiers acceptés sont les PDF vectoriels issus des principaux constructeurs (GE MUSE, Schiller, Mortara/Burdick…).',
    'info.extract.title': 'Extraction',
    'info.extract.text': 'Le signal est extrait localement par votre navigateur. Les valeurs numériques sont ensuite transmises au serveur, qui les convertit au format XML standard et les renvoie pour affichage.',
    'info.convert.title': 'Conversion',
    'info.convert.text': 'Trois sorties sont disponibles à la demande : un fichier XML HL7 aECG (format standard pour le stockage, l\'interopérabilité et la recherche), un PDF vectoriel anonymisé et une image. Vous ne générez que ce dont vous avez besoin.',
    'info.privacy.title': 'Confidentialité',
    'info.privacy.text': 'Les données patient présentes dans le fichier d\'origine (nom, date de naissance, identifiants) ne sont jamais transmises au serveur. Seuls les échantillons numériques du signal le sont, et uniquement le temps nécessaire à la conversion.',

    // Header buttons
    'btn.home': 'Accueil',

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

    // Unsupported file type popup
    'unsupported.title': 'Format non pris en charge',
    'unsupported.detected': 'Format détecté',
    'unsupported.close': 'Fermer',
    'unsupported.accepted': 'Formats actuellement acceptés : PDF vectoriel issu d\'un appareil ECG (GE MUSE, Schiller, Mortara/Burdick…).',
    'unsupported.pdf-raster': 'Ce fichier est un PDF, mais il s\'agit d\'un PDF image (scan ou export bitmap), pas d\'un PDF vectoriel. Capture ECG a besoin du tracé sous forme de chemins vectoriels pour reconstruire le signal.',
    'unsupported.image': 'La conversion à partir d\'images (JPEG, PNG, etc.) est encore en cours de développement.',
    'unsupported.xml': 'Les fichiers XML ne sont pas pris en charge. Capture ECG n\'accepte que les PDF vectoriels.',
    'unsupported.dicom': 'La conversion à partir de DICOM Waveform est encore en cours de développement.',
    'unsupported.unknown': 'Ce type de fichier n\'est pas pris en charge.',

    // Report unsupported ECG type
    'report.btn': 'Signaler un ECG non supporté',
    'report.title': 'Contribuez au développement',
    'report.body': 'Capture ECG est encore en développement et tous les formats ne sont pas encore reconnus. Si votre ECG ne s\'affiche pas correctement, vous pouvez nous l\'envoyer en un clic : nous l\'utiliserons pour améliorer l\'algorithme et ajouter le support de votre type d\'ECG dans une prochaine version. Le fichier est entièrement anonymisé (toutes les données patient sont supprimées) avant tout envoi.',
    'report.confirm': 'Anonymiser et envoyer',
    'report.cancel': 'Annuler',
    'report.sending': 'Anonymisation et envoi...',
    'report.done': 'Merci ! Votre ECG nous aidera à améliorer l\'outil.',
    'report.error': 'Erreur lors de l\'envoi',
  },
  en: {
    // Header
    'app.title': 'Cardio Capture',
    'app.subtitle': 'From your vectorized PDF ECGs to standard digital formats',

    // Steps
    'step.upload': 'Upload',
    'step.extract': 'Extract',
    'step.send': 'Send',
    'step.download': 'Download',

    // DropZone
    'drop.label': 'Drop an ECG file here or click',
    'drop.sub': 'Vectorized PDF (GE MUSE, Schiller, Mortara, Philips...)',
    'drop.preparing': 'Analysing files...',
    'drop.preparingSingle': 'Reading and splitting PDF',
    'drop.preparingProgress': 'File {done} / {total}',

    // Batch conversion
    'batch.button': 'Process a full database',
    'batch.title': 'Batch conversion',
    'batch.standard.subtitle': 'To process a full ECG database, two options are available:',
    'batch.stop': 'Stop',
    'batch.stopped': 'Stopped',
    'batch.option1.title': 'Let our team handle it',
    'batch.option1.desc': 'We convert your database for you. Click to contact us.',
    'batch.option2.title': 'Deploy the solution on your servers',
    'batch.option2.desc': 'Open-source solution to install in-house, compliant with hospital privacy requirements.',
    'batch.option2.github': 'Source code',
    'batch.option2.tutorial': 'Installation guide',
    'batch.close': 'Close',

    // Buttons
    'btn.send': 'Send to server',
    'btn.json': 'Local JSON',
    'btn.rawJson': 'Raw JSON',

    // Status
    'status.extracting': 'Extracting...',
    'status.nonPdf': 'Not a PDF file',
    'status.unsupported': 'Unsupported format (vectorized PDF expected)',
    'status.noSignal': 'No vectorized ECG signal found',
    'status.noEcgPage': 'No ECG detected on this page',
    'status.noGrid': 'ECG grid not detected — this format cannot be converted. Use "Report" to send us the file.',
    'status.sending': 'Sending & converting...',
    'status.error': 'Error',
    'status.timeout': 'Extraction timed out (30 s) — the file is likely in an unsupported format',
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
    'fmt.convertAll': 'Convert all',
    'fmt.pdf.raw': 'Original PDF (raw)',
    'fmt.pdf.rawDesc': 'The PDF file as you provided it, with no modifications.',
    'fmt.pdf.anon': 'Anonymized PDF',
    'fmt.pdf.anonDesc': 'Patient data removed. ECG traces and grid are preserved.',
    'fmt.batch.zip': 'Download as ZIP',
    'fmt.batch.zipDesc': 'A single ZIP file containing all converted ECGs.',
    'fmt.batch.files': 'Download file by file',
    'fmt.batch.filesDesc': 'Each file is downloaded separately.',
    'fmt.download': 'Download',
    'fmt.img.title': 'Download the rendered trace',
    'fmt.img.webp': 'Image (WebP)',
    'fmt.img.webpDesc': 'Raster image of the ECG trace.',
    'fmt.img.pdf': 'Vector PDF',
    'fmt.img.pdfDesc': 'Scalable vector PDF, same layout as the image.',
    'fmt.anonName': 'Anonymized filename',
    'fmt.xml.title': 'Download the HL7 aECG XML',
    'fmt.xml.note': 'The content is already anonymous (no patient data). The choice only affects the filename.',
    'fmt.error': 'Error',

    // Downloads
    'dl.title': 'Generated files — click to download',
    'dl.edf.desc': 'European Data Format — Open standard for physiological signals. Readable by EDFbrowser, Polyman, MATLAB, Python (pyedflib).',
    'dl.wfdb.desc': 'WaveForm DataBase — PhysioNet (MIT) format. .hea + .dat files. Gold standard for cardiology research.',
    'dl.dicom.desc': 'DICOM Waveform — Hospital standard for medical imaging and signals. PACS compatible.',
    'dl.hdf5.desc': 'Hierarchical Data Format v5 — High-performance binary format. Used by NASA, CERN, and in deep learning.',
    'dl.webp.desc': '4K image (3840×2160) with standard ECG grid, 1mV/200ms calibration pulse and labels.',
    'dl.hl7.desc': 'Standard XML format for ECG data exchange and analysis.',
    'dl.pdfvec.desc': 'Vectorized PDF of the ECG trace, anonymized (content and filename).',
    'dl.image.desc': 'Image of the ECG trace.',
    'dl.badge.std': 'Standard',
    'dl.badge.physionet': 'PhysioNet',
    'dl.badge.medical': 'Medical',
    'dl.badge.scientific': 'Scientific',
    'dl.badge.image': 'Image',
    'dl.badge.fda': 'FDA/HL7',
    'dl.badge.wip': 'WIP',
    'fmt.wip.title': 'Under development',
    'fmt.wip.body': 'This feature is not available yet. It will be added in a future release.',
    'fmt.wip.close': 'Close',
    'image.rendering': 'Rendering ECG image...',
    'image.error': 'Render error',
    'image.zoom': 'Click to enlarge',
    'image.zoom.generated': 'Generated image',
    'image.zoom.original': 'Original PDF',
    'image.transform.truncated': 'The {layout} format only keeps the first {tgt} seconds of the source signal ({src} s per lead).',
    'image.unavailable.title': 'Format unavailable',
    'image.unavailable.duration': 'The recorded signal is only {duration} s per lead. This format requires a longer signal and cannot be generated without artificially repeating the trace. The native format for this ECG is {layout}.',
    'image.unavailable.rhythm': 'This format includes a long lead (rhythm strip) at the bottom of the page. The source ECG does not contain a dedicated long lead, so this format cannot be generated without artificially fabricating that row.',

    // Info card
    'info.principle.title': 'Principle',
    'info.principle.text': 'Capture ECG converts your ECGs into standard digital formats, usable in clinical practice and research. The tool accepts vectorized PDFs from ECG devices. Patient data never leaves your machine — only the digital signal is transmitted to the server, and only for the time the conversion takes.',
    'info.upload.title': 'Upload',
    'info.upload.text': 'Drop an ECG. Accepted files are vectorized PDFs from major manufacturers (GE MUSE, Schiller, Mortara/Burdick…).',
    'info.extract.title': 'Extraction',
    'info.extract.text': 'The signal is extracted locally by your browser. The numeric values are then sent to the server, which converts them to the standard XML format and sends them back for display.',
    'info.convert.title': 'Conversion',
    'info.convert.text': 'Three outputs are available on demand: an HL7 aECG XML file (the standard format for storage, interoperability and research), an anonymized vectorized PDF, and an image. You only generate what you need.',
    'info.privacy.title': 'Privacy',
    'info.privacy.text': 'Patient data present in the source file (name, date of birth, identifiers) is never transmitted to the server. Only the numeric signal samples are, and only for the time the conversion takes.',

    // Header buttons
    'btn.home': 'Home',

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

    // Unsupported file type popup
    'unsupported.title': 'Unsupported file type',
    'unsupported.detected': 'Detected format',
    'unsupported.close': 'Close',
    'unsupported.accepted': 'Currently accepted formats: vectorized PDF from an ECG device (GE MUSE, Schiller, Mortara/Burdick…).',
    'unsupported.pdf-raster': 'This file is a PDF, but it is a raster PDF (scan or bitmap export), not a vectorized one. Capture ECG needs the trace as vector paths to reconstruct the signal.',
    'unsupported.image': 'Conversion from images (JPEG, PNG, etc.) is still under development.',
    'unsupported.xml': 'XML files are not supported. Capture ECG only accepts vectorized PDFs.',
    'unsupported.dicom': 'Conversion from DICOM Waveform is still under development.',
    'unsupported.unknown': 'This file type is not supported.',

    // Report unsupported ECG type
    'report.btn': 'Report an unsupported ECG',
    'report.title': 'Help us improve Capture ECG',
    'report.body': 'Capture ECG is still under development and not every format is recognized yet. If your ECG doesn\'t display correctly, you can send it to us in one click: we\'ll use it to improve the algorithm and add support for your ECG type in a future release. The file is fully anonymized (all patient data removed) before any transmission.',
    'report.confirm': 'Anonymize & send',
    'report.cancel': 'Cancel',
    'report.sending': 'Anonymizing & sending...',
    'report.done': 'Thank you! Your ECG will help us improve the tool.',
    'report.error': 'Error sending file',
  },
} as const;

export type Lang = keyof typeof translations;
export type TranslationKey = keyof typeof translations['fr'];
export default translations;

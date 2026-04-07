# Components — Legacy

Ces composants ne sont **plus utilisés** dans l'interface mais sont conservés pour reprise éventuelle.

## `AnonymizeCard.tsx`

Composant qui affichait une carte "Anonymisation PDF/XML" dans l'interface principale, permettant à l'utilisateur d'anonymiser localement (dans son navigateur) un PDF ECG avant de le télécharger.

### Fonctionnement

- Deux modes d'anonymisation :
  - **smart** : retire uniquement les données patient (nom, ID, date de naissance, sexe). Conserve mesures, diagnostics, paramètres ECG.
  - **full** : retire TOUT le texte sauf les labels de dérivation (I, II, V1...).
- Pour les PDF : utilise `anonymizePdf()` de `lib/pdf-anonymize.ts`. Affiche un aperçu texte avant/après pour montrer ce qui a été supprimé.
- Pour les XML : utilise `anonymizeXml()` de `lib/_legacy/xml-anonymize.ts`.
- Le résultat est téléchargé localement — **jamais envoyé au serveur**.

### Pourquoi désactivé

L'utilisateur a souhaité simplifier l'interface — la carte d'anonymisation ne fait pas partie du flux principal (extraction → conversion HL7 → image rendue). L'anonymisation reste disponible **indirectement** via le bouton "Signaler" (`ReportModal.tsx`) qui anonymise toujours en mode `full` avant d'envoyer le PDF au backend pour signalement de bug.

### Dépendances qui restent actives

⚠️ **Ne pas déplacer ces fichiers en legacy** — ils sont encore utilisés par `ReportModal.tsx` :

- `src/lib/pdf-anonymize.ts` — appelé par `ReportModal` pour anonymiser le PDF avant envoi
- Le bouton "Signaler" dépend de ce module

### Pour réactiver `AnonymizeCard`

1. Déplacer `AnonymizeCard.tsx` vers `src/components/`
2. Restaurer les imports relatifs (`../i18n` au lieu de `../../i18n`, etc.)
3. Réimporter dans `App.tsx` : `import AnonymizeCard from './components/AnonymizeCard'`
4. Ajouter `<AnonymizeCard pdfFile={pdfFile} xmlContent={xmlContent} disabled={status.loading} />` dans le rendu
5. Restaurer l'état `xmlContent` dans `App.tsx` si supprimé entre-temps

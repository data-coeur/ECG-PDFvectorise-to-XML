# Legacy — Disabled

These writers are **not used** in the current application.

The frontend only exposes HL7 aECG conversion. The other formats (EDF+, WFDB, DICOM, HDF5, WebP) are kept here for reference in case they need to be re-enabled later.

To re-enable a format:
1. Move the writer back to `src/backend/src/writers/`
2. Re-add the import and the case branch in `src/backend/src/routes/ecg.ts`
3. Add the format definition back in `src/frontend/src/components/FormatCards.tsx`

# Archived backend scripts

Code kept for reference only — **not** wired into the running backend.

## `parse_xml_ecg.py`
Home-made XML ECG parser based on the `ecgdatakit` Python library
(`FileParser`). It parsed proprietary XML (Philips/Sierra, GE MUSE, HL7 aECG,
Mortara, Mindray…) straight into `ECGData` JSON.

**Why archived:** superseded by the `ecg-converter` microservice
(github.com/LIRYC-IHU/ecg_converter, wrapping the C# ECG Toolkit), which is a
more complete and maintained conversion tool. The XML ingestion path now goes
through that service instead of this in-house parser.

#!/usr/bin/env python3
"""
Parse an XML ECG file using ecg-datakit and output ECGData JSON to stdout.
Called by the Node.js backend via child_process.

Usage: python3 parse_xml_ecg.py <input_file> [original_filename]
"""

import sys
import json
import os
import tempfile


def ensure_utf8(input_file):
    """Convert UTF-16 encoded XML to UTF-8 temp file if needed."""
    with open(input_file, "rb") as f:
        raw = f.read()

    if raw[:2] == b"\xff\xfe" or raw[:2] == b"\xfe\xff":
        enc = "utf-16-le" if raw[:2] == b"\xff\xfe" else "utf-16-be"
        text = raw.decode(enc)
        text = text.replace('encoding="utf-16"', 'encoding="utf-8"')
        tmp = tempfile.NamedTemporaryFile(suffix=".xml", delete=False, mode="w", encoding="utf-8")
        tmp.write(text)
        tmp.close()
        return tmp.name, True
    return input_file, False


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: parse_xml_ecg.py <input_file> [filename]"}))
        sys.exit(1)

    input_file = sys.argv[1]
    filename = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(input_file)
    tmp_file = None

    try:
        parse_file, is_tmp = ensure_utf8(input_file)
        if is_tmp:
            tmp_file = parse_file

        from ecgdatakit import FileParser
        record = FileParser().parse(parse_file)
    except Exception as e:
        if tmp_file:
            os.unlink(tmp_file)
        print(json.dumps({"error": f"Parse error: {str(e)}"}))
        sys.exit(1)
    finally:
        if tmp_file and os.path.exists(tmp_file):
            os.unlink(tmp_file)

    channels = []
    for lead in record.leads:
        samples = lead.samples.tolist() if hasattr(lead.samples, "tolist") else list(lead.samples)
        sr = getattr(lead, "sampling_rate", None) or 500
        units = getattr(lead, "units", "mV") or "mV"

        # Convert to mV if in µV
        if units.lower() in ("uv", "µv", "microvolt", "microvolts"):
            samples = [s / 1000.0 for s in samples]

        channels.append({
            "name": lead.label or f"Lead{len(channels)+1}",
            "samples": samples,
            "duration_s": round(len(samples) / sr, 4) if sr > 0 else 0,
            "sample_rate_hz": sr,
            "voltage_unit": "mV",
            "time_unit": "s",
        })

    if not channels:
        print(json.dumps({"error": "No lead data found in XML"}))
        sys.exit(1)

    # Detect manufacturer from source format
    fmt = getattr(record, "source_format", "") or ""
    fmt_map = {
        "sierra": "Philips", "philips": "Philips",
        "muse": "GE MUSE", "ge_muse": "GE MUSE",
        "hl7": "HL7 aECG", "aecg": "HL7 aECG",
        "mortara": "Mortara", "el250": "Mortara",
        "mindray": "Mindray", "beneheart": "Mindray",
        "mac": "GE MAC",
    }
    manufacturer = "Unknown"
    for key, val in fmt_map.items():
        if key in fmt.lower():
            manufacturer = val
            break

    # Also check device info
    if manufacturer == "Unknown" and hasattr(record, "recording") and hasattr(record.recording, "device"):
        dev = record.recording.device
        if dev:
            mfr = getattr(dev, "manufacturer", "") or getattr(dev, "model", "") or ""
            if mfr:
                manufacturer = mfr

    n = len(channels)
    layout = "grid_4x3" if n >= 12 else ("sequential_6x2" if n >= 6 else "stacked_12x1")

    result = {
        "manufacturer": manufacturer,
        "layout": layout,
        "filename": filename,
        "page_size": {"width": 842, "height": 595},
        "scale": {"mm_per_s": 25, "mm_per_mV": 10, "pts_per_mm": 1},
        "channels": channels,
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()

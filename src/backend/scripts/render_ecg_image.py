#!/usr/bin/env python3
"""
Render an ECG XML file to a standardized ECG paper image.
Wrapper around ecgmind_raw2paper.pipeline.generate_ecg_image.

Usage: render_ecg_image.py <xml_path> <output_path> [format]

Optional format argument (e.g. '3x4', '6x2+1', '12x1') overrides
the auto-detection from signal duration.
"""

import sys
import os

# Vendored Python packages live in /app/python (set via PYTHONPATH in Dockerfile)
# Fallback for local development:
_here = os.path.dirname(os.path.abspath(__file__))
_python_dir = os.path.abspath(os.path.join(_here, "..", "python"))
if os.path.isdir(_python_dir) and _python_dir not in sys.path:
    sys.path.insert(0, _python_dir)


def main():
    if len(sys.argv) < 3:
        print("Usage: render_ecg_image.py <xml_path> <output_path> [format]", file=sys.stderr)
        sys.exit(1)

    xml_path = sys.argv[1]
    out_path = sys.argv[2]
    fmt = sys.argv[3] if len(sys.argv) >= 4 else None

    if not os.path.isfile(xml_path):
        print(f"ERROR: input file not found: {xml_path}", file=sys.stderr)
        sys.exit(1)

    try:
        from ecgmind_raw2paper.pipeline import generate_ecg_image
        generate_ecg_image(xml_path, out_path, output_format="webp", format_override=fmt)
    except Exception as e:
        import traceback
        print(f"ERROR: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()

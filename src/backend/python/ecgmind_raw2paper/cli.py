"""Command-line interface for ECGMind Raw2Paper."""

import argparse
import os

from ecgmind_raw2paper.pipeline import generate_ecg_image
from ecgmind_raw2paper.config import THEMES, LOGOS, DEFAULT_LOGO

SUPPORTED_EXTENSIONS = {'.xml', '.hea', '.dat', '.hdf5', '.h5', '.csv', '.npy', '.npz'}


def main():
    parser = argparse.ArgumentParser(
        description="Generate a standardized ECG image from a raw ECG file "
                    "(XML, WFDB .hea/.dat, HDF5, CSV, NumPy)."
    )
    parser.add_argument(
        "input",
        help="Path to the input ECG file (.xml, .hea, .dat, .hdf5, .csv, .npy, .npz).",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Output file path. Defaults to same directory as input with appropriate extension.",
    )
    parser.add_argument(
        "-f", "--format",
        choices=["webp", "png"],
        default="webp",
        help="Output image format (default: webp).",
    )
    parser.add_argument(
        "-t", "--theme",
        choices=sorted(THEMES.keys()),
        default="turquoise",
        help="Color theme (default: turquoise).",
    )
    parser.add_argument(
        "-l", "--logo",
        choices=sorted(LOGOS.keys()) + ["none"],
        default=DEFAULT_LOGO,
        help=f"Logo printed in the bottom-right corner (default: {DEFAULT_LOGO}). "
             f"Use 'none' to disable.",
    )

    args = parser.parse_args()
    logo = None if args.logo == "none" else args.logo

    if not os.path.isfile(args.input):
        parser.error(f"Input file not found: {args.input}")

    ext = os.path.splitext(args.input)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        parser.error(
            f"Unsupported file format: {ext}. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    output_path = args.output
    if output_path is None:
        stem = os.path.splitext(args.input)[0]
        output_path = f"{stem}.{args.format}"

    generate_ecg_image(
        args.input, output_path,
        output_format=args.format, theme=args.theme, logo=logo,
    )


if __name__ == "__main__":
    main()

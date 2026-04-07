#!/usr/bin/env python3
"""
ECG Generator - Main execution script
Complete ECG dataset generation with all ECG files (XML, HDF5)
Each ECG generates multiple images with random configurations

  - --input PATH - Input directory or file (.xml, .hdf5, .h5) (default: data/input)
  - --output PATH - Output directory (default: data/output_impression)
  - --mode {random,single} - Execution mode (default: random)
  - --repeats N - Number of renders per file (default: 10)
  - --single-source PATH - Specific file (.xml, .hdf5, .h5) for single mode
  - --single-index K - File/ECG index for single mode (default: 0)
  - --seed INT - Reproducible RNG seed
  - --no-seed - Disable default seed for maximum randomness
  - --dry-run - Show execution plan without processing
  - --config PATH - Path to JSON config file to render specific configuration
  - --no-masks - Skip mask generation (only generate ECG images and JSON configs)
  - --mask-test MASK_NAME - Generate overlay test images for specified mask (e.g., 'aVF', 'all_signals', 'grid_line')
  - --verify-scaling - Enable verification mode (generates ECG with measurement overlays)
  - --csv-only - CSV simulation mode (generate configs and CSV metadata only, skip image/mask/JSON generation)
  - --show-pipeline - Show detailed pipeline execution messages (disables progress bar)
"""

import os
import sys
import glob
import random
import argparse
import json
import time
import matplotlib
matplotlib.use('Agg')  # Force non-interactive backend before any pyplot import (#57)
import numpy as np
from PIL import Image

# Add parent directory to path to allow imports when running as script
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ecg_generator.in_out.data_source import get_input_sources, create_data_source, SUPPORTED_EXTENSIONS
from ecg_generator.in_out.xml_parser import load_ecg_from_xml
from ecg_generator.config.manager import random_config, load_config_from_json, save_config_to_json
from ecg_generator.config.constants import LAYOUT_TEMPLATES
from ecg_generator.layout.page_utils import get_page_count, get_page_layout
from ecg_generator.config.randomization import generate_patient_info, generate_cardiac_measurements, generate_medical_comment
from ecg_generator.pipeline import main_generate_random_image_with_noise
from ecg_generator.rendering.noise import add_noise_to_leads
from ecg_generator.in_out.csv_writer import DatasetCSVWriter
from ecg_generator.in_out.performance_logger import PerformanceLogger, TimingContext
from ecg_generator.verification.integration import generate_verification_outputs


def get_valid_mask_names():
    """
    Return list of all valid mask names (27 total)

    Returns:
        list: List of all valid mask names including standard leads, extra leads, and special masks
    """
    standard_leads = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
    extra_leads = [f'{lead}_extra' for lead in standard_leads]
    special_masks = ['all_signals', 'grid_only', 'grid_line']
    return standard_leads + extra_leads + special_masks


def create_mask_overlay(ecg_image_path, mask_image_path, output_path, overlay_color=(255, 0, 0)):
    """
    Create an overlay test image by applying colored mask on top of ECG image

    Args:
        ecg_image_path (str): Path to the ECG PNG image
        mask_image_path (str): Path to the mask PNG image
        output_path (str): Path to save the overlay test image
        overlay_color (tuple): RGB color for the mask overlay (default: red)

    Returns:
        str: Path to the created overlay image
    """
    # Load ECG image and mask image
    ecg_img = Image.open(ecg_image_path).convert('RGB')
    mask_img = Image.open(mask_image_path).convert('L')  # Convert to grayscale

    # Create a new image for the overlay with the mask color
    overlay = Image.new('RGB', ecg_img.size, (0, 0, 0))
    overlay_pixels = overlay.load()
    mask_pixels = mask_img.load()

    # Apply red color to white pixels in the mask
    for y in range(mask_img.height):
        for x in range(mask_img.width):
            if mask_pixels[x, y] == 255:  # White pixel in mask
                overlay_pixels[x, y] = overlay_color

    # Composite: where mask is white (255), show red; elsewhere show original ECG
    result = Image.composite(overlay, ecg_img, mask_img)

    # Save the result
    result.save(output_path, dpi=(300, 300))

    return output_path


def _mp_worker_init():
    """Initializer for multiprocessing worker: force matplotlib Agg backend."""
    import matplotlib
    matplotlib.use('Agg')


def _mp_generate_image(job):
    """Worker function for multiprocessing image generation.

    Args:
        job: tuple of (leads_data, source_path, png_path, page_config, mask_folder, mask_options)

    Returns:
        tuple of (final_png_path, mask_paths, error_str_or_None)
    """
    leads_data, source_path, png_path, page_config, mask_folder, mask_options = job
    try:
        from ecg_generator.pipeline import main_generate_random_image_with_noise
        final_path, mask_paths = main_generate_random_image_with_noise(
            leads_data, source_path, png_path, page_config, mask_folder,
            verbose=False, mask_options=mask_options
        )
        return (final_path, mask_paths, None)
    except Exception as e:
        import traceback
        return (png_path, [], f"{type(e).__name__}: {e}\n{traceback.format_exc()}")


def _format_time(seconds):
    """Format seconds into human-readable string (e.g., '1m 23s')."""
    if seconds < 60:
        return f"{seconds:.0f}s"
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    if minutes < 60:
        return f"{minutes}m {secs:02d}s"
    hours = int(minutes // 60)
    mins = minutes % 60
    return f"{hours}h {mins:02d}m"


def print_progress_bar(current, total, current_file="", bar_length=40, start_time=None):
    """
    Print a progress bar on the same line

    Args:
        current: Current progress count
        total: Total count
        current_file: Name of current file being processed
        bar_length: Length of the progress bar in characters
        start_time: time.time() when processing started (enables speed/ETA display)
    """
    percent = 100.0 * current / total if total > 0 else 0
    filled_length = int(bar_length * current / total) if total > 0 else 0
    bar = '#' * filled_length + '-' * (bar_length - filled_length)

    # Build timing info if start_time provided
    timing = ""
    if start_time is not None and current > 0:
        elapsed = time.time() - start_time
        speed = current / elapsed if elapsed > 0 else 0
        remaining = (total - current) / speed if speed > 0 else 0
        timing = f" | {speed:.1f} img/s | ETA: {_format_time(remaining)}"

    # Use \r to return to start of line without newline
    print(f'\rProgress: [{bar}] {current}/{total} ({percent:.1f}%){timing}', end='', flush=True)


def parse_arguments():
    """
    Parse command line arguments for dataset generation

    Returns:
        argparse.Namespace: Parsed arguments with all configuration options
    """
    parser = argparse.ArgumentParser(
        description="ECG Dataset Generator with random configurations",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    
    parser.add_argument(
        "--input",
        default="data/input",
        help="Path to directory of ECG files (.xml, .hdf5, .h5) or single file"
    )

    parser.add_argument(
        "--output",
        default="data/output_impression",
        help="Output directory for generated files"
    )

    parser.add_argument(
        "--mode",
        choices=["random", "single"],
        default="random",
        help="Execution mode: random (process all files) or single (process one ECG)"
    )
    
    parser.add_argument(
        "--repeats",
        type=int,
        default=10,
        help="Number of different random configurations to generate per file"
    )
    
    parser.add_argument(
        "--single-source",
        help="When mode=single, path to specific ECG file (.xml, .hdf5, .h5) to render"
    )
    
    parser.add_argument(
        "--single-index",
        type=int,
        default=0,
        help="When mode=single: for directory pick K-th file, for HDF5 pick K-th ECG"
    )
    
    parser.add_argument(
        "--seed",
        type=int,
        help="Seed for reproducible random generation"
    )

    parser.add_argument(
        "--no-seed",
        action="store_true",
        help="Disable default seed for maximum randomness"
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show planned renders without doing heavy processing"
    )

    parser.add_argument(
        "--config",
        default=None,
        help="Path to JSON config file to render a specific configuration (overrides --repeats and uses first XML from input)"
    )

    parser.add_argument(
        "--no-masks",
        action="store_true",
        help="Skip mask generation (only generate ECG images and JSON config files)"
    )

    parser.add_argument(
        '--mask-test', type=str, nargs='?', const='all_signals', default=None, metavar='MASK_NAME',
        help="Generate overlay test images for specified mask (e.g., 'aVF', 'all_signals', 'grid_only', 'grid_line'). Valid masks: I, II, III, aVR, aVL, aVF, V1-V6, I_extra-V6_extra, all_signals, grid_only, grid_line"
    )

    parser.add_argument(
        "--verify-scaling",
        action="store_true",
        help="Enable signal scaling verification mode. Generates ECG with measurement overlays showing XML voltage values and their rendered dimensions to verify 1mV=10mm and 1s=25mm scaling"
    )

    parser.add_argument(
        "--csv-only",
        action="store_true",
        help="CSV simulation mode: generate configs and CSV metadata only (skip image/mask/JSON generation)"
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable detailed console output during generation (progress bars, info messages)"
    )

    parser.add_argument(
        "--show-pipeline",
        action="store_true",
        help="Show detailed pipeline execution messages and status updates (disables progress bar)"
    )

    parser.add_argument(
        '--generation-workers', type=int, default=1,
        help='Number of parallel workers for image generation (0=auto, 1=sequential, default: 1)'
    )
    parser.add_argument(
        '--mask-point-radius', type=float, default=0,
        help='Blur radius for grid intersection + label center point masks (0=1px exact)'
    )
    parser.add_argument(
        '--mask-signal-radius-x', type=float, default=0,
        help='Blur radius X for signal sample point masks (0=1px exact)'
    )
    parser.add_argument(
        '--mask-signal-radius-y', type=float, default=0,
        help='Blur radius Y for signal sample point masks (0=1px exact)'
    )

    parser.add_argument(
        '--resume', action='store_true',
        help='Skip images that already exist in the output directory (resume interrupted run)'
    )

    return parser.parse_args()


def simulate_csv_generation(data_sources, images_per_ecg, csv_writer, args):
    """
    Simulate ECG generation for CSV-only mode

    Generates random configs without rendering images, masks, or JSON files.
    Writes CSV rows with all metadata.

    Args:
        data_sources: List of ECGDataSource instances
        images_per_ecg: Number of config variations per ECG
        csv_writer: DatasetCSVWriter instance
        args: Command line arguments

    Returns:
        int: Exit code (0 for success)
    """
    dataset_folder = args.output
    png_folder = os.path.join(dataset_folder, "images")
    json_folder = os.path.join(dataset_folder, "json")
    mask_folder = os.path.join(dataset_folder, "masks")

    total_ecgs = sum(len(source) for source in data_sources)
    total_configs = total_ecgs * images_per_ecg
    config_counter = 0

    print("ECG DATASET CSV-ONLY SIMULATION...")
    print(f"Found {total_ecgs} ECGs from {len(data_sources)} source(s)")
    print(f"Generating {total_configs} configs: ({total_ecgs} ECGs × {images_per_ecg} configs each)")
    print("")

    import time
    start_time = time.time()

    for source in data_sources:
        for ecg_id, leads_data in source:
            for config_idx in range(1, images_per_ecg + 1):
                # Generate random config (same logic as real generation)
                config = random_config()

                # Detect multi-page format
                format_key = config["format_choice"]
                layout_template = LAYOUT_TEMPLATES[format_key]
                page_count = get_page_count(layout_template)

                # JSON filename
                json_name = f"{ecg_id}_{config_idx:02d}.json"
                json_path = os.path.join(json_folder, json_name)

                # Loop over pages
                for page_idx in range(page_count):
                    # Construct simulated paths
                    png_name = f"{ecg_id}_{config_idx:02d}_p{page_idx}.png"
                    png_path = os.path.join(png_folder, png_name)

                    # Mask folder path
                    image_mask_folder = os.path.join(mask_folder, f"{ecg_id}_{config_idx:02d}_p{page_idx}")

                    # Write CSV row with simulated paths and config metadata
                    csv_writer.add_row(
                        source_path=source.source_path,
                        png_path=png_path,
                        json_path=json_path,
                        mask_folder=image_mask_folder,
                        config=config,
                        num_masks=27,  # Simulate 27 masks (12 standard + 12 extra + 3 special)
                        page_index=page_idx,
                        page_count=page_count
                    )

                    config_counter += 1

                    # Progress update every 100 configs
                    if config_counter % 100 == 0 or config_counter == total_configs:
                        percent = 100.0 * config_counter / total_configs
                        print(f'\rProgress: {config_counter}/{total_configs} configs ({percent:.1f}%)', end='', flush=True)

    elapsed_time = time.time() - start_time

    print()
    print("")
    print("CSV-ONLY SIMULATION COMPLETED!")
    print("=" * 50)
    print(f"Final statistics:")
    print(f"   • Total configs generated: {config_counter}")
    print(f"   • ECGs processed: {total_ecgs}")
    print(f"   • Configs per ECG: {images_per_ecg}")
    print(f"   • Time elapsed: {elapsed_time:.2f}s")
    print(f"   • Speed: {config_counter/elapsed_time:.1f} configs/sec")
    print("")
    print(f"CSV file created:")
    print(f"   • Dataset CSV: {csv_writer.csv_path}")
    print("")
    print("Note: No images, masks, or JSON files were generated (CSV-only mode)")

    return 0


def main():
    """
    Main execution function for ECG dataset generation

    Supports two modes:
    - CONFIG MODE: Generate single image from existing JSON configuration
    - BATCH MODE: Generate multiple random configurations per XML file

    Note: Images may be renamed with SIZE_ERROR prefix if rendering dimensions
    don't match expected A4 size (3507x2480 pixels at 300 DPI).
    """
    args = parse_arguments()

    # Validate mask test argument if provided
    if args.mask_test:
        valid_masks = get_valid_mask_names()
        if args.mask_test not in valid_masks:
            print(f"Error: Invalid mask name '{args.mask_test}'")
            print(f"Valid mask names: {', '.join(valid_masks)}")
            return 1

        # Check if --no-masks was also specified
        if args.no_masks:
            print("Error: --mask-test cannot be used with --no-masks")
            return 1

    # Validate CSV-only mode and incompatible flags
    if args.csv_only:
        incompatible_flags = []
        if args.config:
            incompatible_flags.append("--config")
        if args.mask_test:
            incompatible_flags.append("--mask-test")
        if args.verify_scaling:
            incompatible_flags.append("--verify-scaling")

        if incompatible_flags:
            print(f"Error: --csv-only cannot be used with {', '.join(incompatible_flags)}")
            print("CSV-only mode only generates configuration metadata without rendering")
            return 1

    # Build mask options from CLI args (None if all defaults → backward compatible)
    mask_options = None
    if args.mask_point_radius > 0 or args.mask_signal_radius_x > 0 or args.mask_signal_radius_y > 0:
        mask_options = {
            'mask_point_radius': args.mask_point_radius,
            'mask_signal_radius_x': args.mask_signal_radius_x,
            'mask_signal_radius_y': args.mask_signal_radius_y,
        }

    # ========== CSV-ONLY MODE: Generate only CSV metadata without rendering ==========
    if args.csv_only:
        # Setup RNG with seed for reproducibility
        if args.seed is not None:
            random.seed(args.seed)
            np.random.seed(args.seed)
        elif not args.no_seed:
            random.seed(42)
            np.random.seed(42)

        try:
            data_sources = get_input_sources(args.input, args.mode, args.single_source, args.single_index)
        except (FileNotFoundError, ValueError, IndexError) as e:
            print(f"Error: {e}")
            return 1

        # Create output directory and CSV file
        dataset_folder = args.output
        os.makedirs(dataset_folder, exist_ok=True)

        csv_path = os.path.join(dataset_folder, "dataset_characteristics.csv")
        csv_writer = DatasetCSVWriter(csv_path)
        csv_writer.initialize()

        # Run simulation
        return simulate_csv_generation(data_sources, args.repeats, csv_writer, args)

    # ========== CONFIG MODE: Generate single image from JSON config ==========
    if args.config:
        if not os.path.exists(args.config):
            print(f"Error: Config file not found: {args.config}")
            return 1

        try:
            config = load_config_from_json(args.config)
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON in config file: {e}")
            return 1

        try:
            # First, try to get data_source or xml_source from config (backward compat)
            source_filename = config.get('data_source') or config.get('xml_source')

            if source_filename:
                # Config specifies which file to use
                if os.path.isdir(args.input):
                    ecg_file = os.path.join(args.input, source_filename)
                    if not os.path.exists(ecg_file):
                        raise FileNotFoundError(
                            f"ECG file specified in config not found: {ecg_file}\n"
                            f"Config specifies: {source_filename}"
                        )
                else:
                    # args.input is a file, use it but warn if different from config
                    ecg_file = args.input
                    if os.path.basename(ecg_file) != source_filename:
                        print(f"Warning: Config specifies '{source_filename}' "
                              f"but using provided file '{os.path.basename(ecg_file)}'")
            else:
                # No data_source/xml_source in config, use first file found
                try:
                    sources = get_input_sources(args.input, "single", None, 0)
                    # For config mode, we need the file path, get it from the source
                    ecg_file = sources[0].source_path
                except (FileNotFoundError, ValueError) as e:
                    raise ValueError(f"Cannot find ECG file: {e}")
        except (FileNotFoundError, ValueError) as e:
            print(f"Error: {e}")
            return 1

        dataset_folder = args.output
        png_folder = os.path.join(dataset_folder, "images")
        json_folder = os.path.join(dataset_folder, "json")
        mask_folder = os.path.join(dataset_folder, "masks")
        mask_test_folder = os.path.join(dataset_folder, "mask_test")

        os.makedirs(png_folder, exist_ok=True)
        os.makedirs(json_folder, exist_ok=True)
        if not args.no_masks:
            os.makedirs(mask_folder, exist_ok=True)
        if args.mask_test:
            os.makedirs(mask_test_folder, exist_ok=True)

        csv_path = os.path.join(dataset_folder, "dataset_characteristics.csv")
        csv_writer = DatasetCSVWriter(csv_path)
        csv_writer.initialize()

        perf_log_path = os.path.join(dataset_folder, "performance_log.txt")
        perf_logger = PerformanceLogger(perf_log_path)
        perf_logger.start_session()

        size_error_files = []

        signal_name = os.path.basename(ecg_file)
        base_name = os.path.splitext(signal_name)[0]

        if args.verbose:
            print("ECG DATASET GENERATION (CONFIG MODE)...")
            print(f"Using config: {args.config}")
            print(f"Using source: {signal_name}")
            print("")

        try:
            # Use create_data_source to handle both XML and HDF5 config sources
            source = create_data_source(ecg_file)
            # For config mode, we expect a single ECG from the source
            for ecg_id_from_source, leads_data in source:
                break  # Get first (and only for XML) ECG
            added_noise = config.get("added_noise", None)

            # NEW: Detect multi-page format
            layout_template = LAYOUT_TEMPLATES[config["format_choice"]]
            page_count = get_page_count(layout_template)

            # Apply noise ONCE for all pages (shared across pages)
            _noise_type_map = {
                "low_frequency": "low frequency",
                "high_frequency": "high frequency",
                "powerline": "powerline",
            }
            if added_noise in _noise_type_map:
                noise_type = _noise_type_map[added_noise]
                noise_seed = config.get("noise_seed", None)
                leads_data_final, used_seed = add_noise_to_leads(leads_data, noise_type, noise_seed)

                config["applied_noise_type"] = noise_type
                config["applied_noise_seed"] = used_seed
            else:
                leads_data_final = leads_data
                config["applied_noise_type"] = "none"
                config["applied_noise_seed"] = None

            # Optional signal decimation (30% chance: 500Hz → 72/100/200Hz)
            from ecg_generator.rendering.noise import decimate_leads
            dec_seed = config.get("noise_seed") or np.random.randint(0, 2**31)
            leads_data_final, sampling_rate = decimate_leads(leads_data_final, seed=dec_seed + 7777)
            config["sampling_rate_hz"] = sampling_rate

            # Generate medical data ONCE for all pages (consistency across pages)
            if config.get("show_medical_text"):
                _patient_info = generate_patient_info()
                config["_shared_medical_data"] = {
                    "patient_info": _patient_info,
                    "cardiac_measurements": generate_cardiac_measurements(),
                    "medical_comment": generate_medical_comment(lang=_patient_info.get('lang'))
                }

            # Loop over pages (1 iteration for single-page)
            page_results = []  # Store results for each page

            for page_idx in range(page_count):
                # Use config_01 as default naming with page index
                png_name = f"{base_name}_config_01_p{page_idx}.png"
                png_path = os.path.join(png_folder, png_name)

                # Create page-specific config
                page_config = config.copy()
                page_config["_internal_page_layout"] = get_page_layout(layout_template, page_idx)
                page_config["_internal_page_index"] = page_idx
                page_config["_internal_page_count"] = page_count

                # Remove internal noise keys before passing to renderer
                page_config.pop("added_noise", None)
                page_config.pop("noise_seed", None)

                image_mask_folder = None if args.no_masks else os.path.join(
                    mask_folder, f"{base_name}_config_01_p{page_idx}"
                )

                with TimingContext() as timer:
                    final_png_path, mask_paths = main_generate_random_image_with_noise(
                        leads_data_final, ecg_file, png_path, page_config, image_mask_folder,
                        verbose=args.verbose, mask_options=mask_options
                    )

                perf_logger.log_generation(os.path.basename(final_png_path), timer.get_duration())

                # Store page results
                page_results.append({
                    'png_path': final_png_path,
                    'png_name': os.path.basename(final_png_path),
                    'mask_folder': image_mask_folder,
                    'mask_count': len(mask_paths),
                    'page_idx': page_idx
                })

            # Save single JSON for all pages
            json_path = os.path.join(json_folder, f"{base_name}_config_01.json")

            # For multi-page, add pages metadata to JSON
            if page_count > 1:
                config["pages"] = []
                for page_result in page_results:
                    page_layout = get_page_layout(layout_template, page_result['page_idx'])
                    lead_names = []
                    for row in page_layout:
                        for cell in row:
                            if cell:
                                lead_names.append(cell)
                    config["pages"].append({
                        "page_index": page_result['page_idx'],
                        "png_file": page_result['png_name'],
                        "lead_names": lead_names
                    })

            # Clean up auto-generated JSONs from pipeline and save single JSON
            for page_result in page_results:
                auto_json = os.path.splitext(page_result['png_path'])[0] + ".json"
                if os.path.exists(auto_json):
                    os.remove(auto_json)

            save_config_to_json(config, ecg_file, json_path)

            # Add CSV rows for each page
            for page_result in page_results:
                csv_writer.add_row(
                    source_path=ecg_file,
                    png_path=page_result['png_path'],
                    json_path=json_path,
                    mask_folder=page_result['mask_folder'] if page_result['mask_folder'] is not None else "N/A",
                    config=config,
                    num_masks=page_result['mask_count'],
                    page_index=page_result['page_idx'],
                    page_count=page_count
                )

            # Track size errors if any
            for page_result in page_results:
                if "SIZE_ERROR" in page_result['png_name']:
                    size_error_files.append(page_result['png_name'])

            # Print summary for all pages (only in verbose mode)
            if args.verbose:
                noise_info = config.get("applied_noise_type", "none")
                if page_count > 1:
                    print(f"Generated {page_count} pages (noise: {noise_info})")
                    for page_result in page_results:
                        print(f"  - {page_result['png_name']}")
                        if not args.no_masks:
                            print(f"    Masks: {page_result['mask_count']} generated")
                else:
                    png_name = page_results[0]['png_name']
                    print(f"Generated: {png_name} (noise: {noise_info})")
                    if not args.no_masks:
                        print(f"Masks: {page_results[0]['mask_count']} generated")

            # Generate mask overlay test image if requested
            if args.mask_test:
                for page_result in page_results:
                    mask_file_name = f"mask_{args.mask_test}.png"
                    mask_path = os.path.join(page_result['mask_folder'], mask_file_name)

                    if os.path.exists(mask_path):
                        png_name = page_result['png_name']
                        test_image_name = f"{os.path.splitext(png_name)[0]}_test_{args.mask_test}.png"
                        test_image_path = os.path.join(mask_test_folder, test_image_name)
                        create_mask_overlay(page_result['png_path'], mask_path, test_image_path)
                        if args.verbose:
                            print(f"Mask test: {test_image_name}")
                    else:
                        print(f"Warning: Mask file not found: {mask_path}")

            # Generate verification outputs if requested
            verification_folder = None
            if args.verify_scaling:
                verification_folder = os.path.join(dataset_folder, "verification")
                os.makedirs(verification_folder, exist_ok=True)

                if args.verbose:
                    print("Generating verification outputs...")
                # Verify only the first page for multi-page formats
                first_page_result = page_results[0]
                try:
                    # Use page-specific config for verification
                    verify_config = config.copy()
                    verify_config["_internal_page_layout"] = get_page_layout(layout_template, 0)

                    json_report, verified_img, text_report = generate_verification_outputs(
                        ecg_file, first_page_result['png_path'], leads_data_final, verify_config,
                        verification_folder, base_name + "_config_01_p0"
                    )
                    if args.verbose:
                        print(f"Verification: {os.path.basename(verified_img)}")
                        print(f"  • JSON report: {os.path.basename(json_report)}")
                        print(f"  • Text report: {os.path.basename(text_report)}")
                except Exception as e:
                    print(f"Warning: Verification failed: {e}")
                    if args.verbose:
                        import traceback
                        traceback.print_exc()

            if args.verbose:
                print("")

            perf_logger.save_log(verbose=args.verbose)

            print("=" * 50)
            print("GENERATION COMPLETED!")
            print("=" * 50)
            if page_count > 1:
                print(f"   • Images: {page_count} pages generated")
                for page_result in page_results:
                    print(f"     - {page_result['png_name']}")
            else:
                print(f"   • Image: {page_results[0]['png_path']}")
            print(f"   • Config: {json_path}")
            if not args.no_masks:
                if page_count > 1:
                    print(f"   • Masks: {page_count} folders")
                    for page_result in page_results:
                        print(f"     - {os.path.basename(page_result['mask_folder'])}/")
                else:
                    print(f"   • Masks: {page_results[0]['mask_folder']}/")
            if args.mask_test:
                print(f"   • Mask test images: {mask_test_folder}/")
            if args.verify_scaling:
                print(f"   • Verification outputs: {verification_folder}/")
            print(f"   • CSV: {csv_path}")
            print(f"   • Performance log: {perf_log_path}")

            if size_error_files:
                print("")
                print(f"WARNING: {len(size_error_files)} file(s) with size errors:")
                for error_file in size_error_files:
                    print(f"   - {error_file}")

            return 0

        except Exception as e:
            print(f"Error generating image: {e}")
            return 1

    # ========== BATCH MODE: Generate multiple images per XML with random configs ==========

    # Setup RNG with seed for reproducibility (default seed=42)
    if args.seed is not None:
        random.seed(args.seed)
        np.random.seed(args.seed)
    elif not args.no_seed:
        random.seed(42)
        np.random.seed(42)

    try:
        data_sources = get_input_sources(args.input, args.mode, args.single_source, args.single_index)
    except (FileNotFoundError, ValueError, IndexError) as e:
        print(f"Error: {e}")
        return 1

    if args.verbose or args.show_pipeline:
        print("ECG DATASET GENERATION...")

    dataset_folder = args.output
    png_folder = os.path.join(dataset_folder, "images")
    json_folder = os.path.join(dataset_folder, "json")
    mask_folder = os.path.join(dataset_folder, "masks")
    mask_test_folder = os.path.join(dataset_folder, "mask_test")
    images_per_ecg = args.repeats

    if not args.dry_run:
        os.makedirs(png_folder, exist_ok=True)
        os.makedirs(json_folder, exist_ok=True)
        if not args.no_masks:
            os.makedirs(mask_folder, exist_ok=True)
        if args.mask_test:
            os.makedirs(mask_test_folder, exist_ok=True)

        csv_path = os.path.join(dataset_folder, "dataset_characteristics.csv")
        csv_writer = DatasetCSVWriter(csv_path)
        csv_writer.initialize()

        perf_log_path = os.path.join(dataset_folder, "performance_log.txt")
        perf_logger = PerformanceLogger(perf_log_path)
        perf_logger.start_session()

    # Count total ECGs across all sources
    total_ecgs = sum(len(source) for source in data_sources)
    total_images = total_ecgs * images_per_ecg

    if args.verbose:
        # Count sources by type
        xml_count = sum(1 for s in data_sources if s.source_path.endswith('.xml'))
        hdf5_count = sum(1 for s in data_sources if s.source_path.endswith(('.hdf5', '.h5')))
        print(f"Found {total_ecgs} ECGs from {len(data_sources)} source(s) ({xml_count} XML, {hdf5_count} HDF5)")
        print(f"Mode: {args.mode}, Repeats: {args.repeats}")
        print("")
        print(f"Planning {total_images} images: ({total_ecgs} ECGs × {images_per_ecg} configs each)")

    if args.dry_run:
        print("\nDRY RUN - Planned execution:")
        print("-" * 80)
        ecg_counter = 0
        for source in data_sources:
            source_name = os.path.basename(source.source_path)
            source_type = os.path.splitext(source_name)[1].upper()[1:]
            if len(source) == 1:
                ecg_counter += 1
                print(f"{ecg_counter:3d}. {source_type}={source_name}, configs={images_per_ecg}")
            else:
                print(f"     {source_type}={source_name} ({len(source)} ECGs)")
                for ecg_id, _ in source:
                    ecg_counter += 1
                    print(f"{ecg_counter:3d}.   ECG ID={ecg_id}, configs={images_per_ecg}")
        print("-" * 80)
        print(f"Total planned images: {total_images}")
        print("Note: Noise types will be determined randomly per configuration")
        return 0


    # ── Phase 1: Prepare all generation jobs (deterministic RNG in main thread) ──
    print("")
    jobs = []  # list of (leads_data, source_path, png_path, page_config, mask_folder, mask_options, ecg_id, config_idx, page_idx, config, layout_template)

    for source in data_sources:
        for ecg_id, leads_data in source:
            try:
                for config_idx in range(1, images_per_ecg + 1):
                    config = random_config()
                    added_noise = config.get("added_noise", None)

                    # Detect multi-page format
                    format_key = config["format_choice"]
                    if format_key == "3x4_paramedic":
                        format_key = "3x4"
                    layout_template = LAYOUT_TEMPLATES[format_key]
                    page_count = get_page_count(layout_template)

                    # Apply noise ONCE for all pages (shared across pages)
                    _noise_type_map = {
                        "low_frequency": "low frequency",
                        "high_frequency": "high frequency",
                        "powerline": "powerline",
                    }
                    if added_noise in _noise_type_map:
                        noise_type = _noise_type_map[added_noise]
                        noise_seed = config.get("noise_seed", None)
                        leads_data_final, used_seed = add_noise_to_leads(leads_data, noise_type, noise_seed)
                        config["applied_noise_type"] = noise_type
                        config["applied_noise_seed"] = used_seed
                    else:
                        leads_data_final = leads_data
                        config["applied_noise_type"] = "none"
                        config["applied_noise_seed"] = None

                    # Optional signal decimation (30% chance: 500Hz → 72/100/200Hz)
                    from ecg_generator.rendering.noise import decimate_leads
                    dec_seed = config.get("noise_seed") or np.random.randint(0, 2**31)
                    leads_data_final, sampling_rate = decimate_leads(leads_data_final, seed=dec_seed + 7777)
                    config["sampling_rate_hz"] = sampling_rate

                    # Generate medical data ONCE for all pages
                    if config.get("show_medical_text"):
                        _patient_info = generate_patient_info()
                        config["_shared_medical_data"] = {
                            "patient_info": _patient_info,
                            "cardiac_measurements": generate_cardiac_measurements(),
                            "medical_comment": generate_medical_comment(lang=_patient_info.get('lang'))
                        }

                    for page_idx in range(page_count):
                        png_name = f"{ecg_id}_{config_idx:02d}_p{page_idx}.png"
                        png_path = os.path.join(png_folder, png_name)

                        page_config = config.copy()
                        page_config["_internal_page_layout"] = get_page_layout(layout_template, page_idx)
                        page_config["_internal_page_index"] = page_idx
                        page_config["_internal_page_count"] = page_count
                        page_config.pop("added_noise", None)
                        page_config.pop("noise_seed", None)

                        image_mask_folder = None if args.no_masks else os.path.join(
                            mask_folder, f"{ecg_id}_{config_idx:02d}_p{page_idx}"
                        )

                        jobs.append((
                            leads_data_final, source.source_path, png_path, page_config,
                            image_mask_folder, mask_options,
                            ecg_id, config_idx, page_idx, config, layout_template
                        ))

            except Exception as e:
                if args.verbose:
                    print(f"Error preparing {ecg_id}: {e}")
                else:
                    print(f"  Error with {ecg_id}: {e}")

    # ── Resume: filter out jobs whose output already exists ──
    if args.resume:
        total_before = len(jobs)
        filtered_jobs = []
        for job in jobs:
            png_path = job[2]  # index 2 = png_path
            # Output is saved as .webp (converted from .png path)
            webp_path = os.path.splitext(png_path)[0] + '.webp'
            if not os.path.exists(webp_path):
                filtered_jobs.append(job)
        skipped = total_before - len(filtered_jobs)
        if skipped > 0:
            print(f"--resume: {skipped}/{total_before} images already exist, {len(filtered_jobs)} remaining")
        jobs = filtered_jobs

    total_images = len(jobs)

    # ── Phase 2: Execute generation jobs (sequential or parallel) ──
    n_workers = args.generation_workers
    if n_workers == 0:
        import multiprocessing
        n_workers = max(1, multiprocessing.cpu_count() - 1)

    image_counter = 1
    size_error_files = []
    _batch_start_time = time.time()

    if not args.show_pipeline:
        print_progress_bar(0, total_images, "Starting...", start_time=_batch_start_time)

    if n_workers > 1:
        # Parallel mode
        import multiprocessing
        if args.verbose or args.show_pipeline:
            print(f"Using {n_workers} generation workers")

        # Build lightweight jobs for the Pool (just the rendering args)
        render_jobs = [(j[0], j[1], j[2], j[3], j[4], j[5]) for j in jobs]

        with multiprocessing.Pool(n_workers, initializer=_mp_worker_init) as pool:
            for idx, (final_png_path, mp_mask_paths, error) in enumerate(
                pool.imap(_mp_generate_image, render_jobs)):

                job = jobs[idx]
                _, source_path, png_path, page_config, image_mask_folder, _, ecg_id, config_idx, page_idx, config, layout_template = job

                if error:
                    if args.verbose:
                        print(f"\nError processing {ecg_id}: {error}")
                    else:
                        print(f"  Error with {ecg_id}: {error.split(chr(10))[0]}")
                    image_counter += 1
                    continue

                perf_logger.log_generation(os.path.basename(final_png_path), 0.0)

                png_path = final_png_path
                png_name = os.path.basename(final_png_path)
                if "SIZE_ERROR" in png_name:
                    size_error_files.append(png_name)

                auto_json = os.path.splitext(png_path)[0] + ".json"
                if os.path.exists(auto_json):
                    os.remove(auto_json)

                page_count = get_page_count(layout_template)
                if page_idx == 0:
                    json_name = f"{ecg_id}_{config_idx:02d}.json"
                    json_path = os.path.join(json_folder, json_name)
                    json_config = config.copy()
                    json_config["page_count"] = page_count
                    json_config["is_multipage"] = page_count > 1
                    if page_count > 1:
                        json_config["pages"] = []
                        for p_idx in range(page_count):
                            p_layout = get_page_layout(layout_template, p_idx)
                            leads_on_page = [cell for row in p_layout for cell in row if cell and not cell.startswith("rhythm")]
                            json_config["pages"].append({
                                "page_index": p_idx,
                                "png_filename": f"{ecg_id}_{config_idx:02d}_p{p_idx}.webp",
                                "lead_distribution": leads_on_page
                            })
                    for key in list(json_config.keys()):
                        if key.startswith("_internal_") or key.startswith("_shared_"):
                            json_config.pop(key)
                    save_config_to_json(json_config, source_path, json_path, verbose=False)
                else:
                    json_name = f"{ecg_id}_{config_idx:02d}.json"
                    json_path = os.path.join(json_folder, json_name)

                csv_writer.add_row(
                    source_path=source_path, png_path=png_path, json_path=json_path,
                    mask_folder=image_mask_folder if image_mask_folder is not None else "N/A",
                    config=config, num_masks=len(mp_mask_paths),
                    page_index=page_idx, page_count=page_count
                )

                if args.show_pipeline:
                    print(f"  [{image_counter}/{total_images}] Generated: {png_name}")
                else:
                    print_progress_bar(image_counter, total_images, png_name, start_time=_batch_start_time)
                image_counter += 1

    else:
        # Sequential mode (default, preserves original behavior)
        for job in jobs:
            leads_data_final, source_path, png_path, page_config, image_mask_folder, _, ecg_id, config_idx, page_idx, config, layout_template = job

            try:
                with TimingContext() as timer:
                    final_png_path, mask_paths = main_generate_random_image_with_noise(
                        leads_data_final, source_path, png_path, page_config, image_mask_folder,
                        verbose=args.verbose, mask_options=mask_options
                    )

                perf_logger.log_generation(os.path.basename(final_png_path), timer.get_duration())

                png_path = final_png_path
                png_name = os.path.basename(final_png_path)
                if "SIZE_ERROR" in png_name:
                    size_error_files.append(png_name)

                auto_json = os.path.splitext(png_path)[0] + ".json"
                if os.path.exists(auto_json):
                    os.remove(auto_json)

                page_count = get_page_count(layout_template)
                if page_idx == 0:
                    json_name = f"{ecg_id}_{config_idx:02d}.json"
                    json_path = os.path.join(json_folder, json_name)
                    json_config = config.copy()
                    json_config["page_count"] = page_count
                    json_config["is_multipage"] = page_count > 1
                    if page_count > 1:
                        json_config["pages"] = []
                        for p_idx in range(page_count):
                            p_layout = get_page_layout(layout_template, p_idx)
                            leads_on_page = [cell for row in p_layout for cell in row if cell and not cell.startswith("rhythm")]
                            json_config["pages"].append({
                                "page_index": p_idx,
                                "png_filename": f"{ecg_id}_{config_idx:02d}_p{p_idx}.webp",
                                "lead_distribution": leads_on_page
                            })
                    for key in list(json_config.keys()):
                        if key.startswith("_internal_") or key.startswith("_shared_"):
                            json_config.pop(key)
                    save_config_to_json(json_config, source_path, json_path, verbose=False)
                else:
                    json_name = f"{ecg_id}_{config_idx:02d}.json"
                    json_path = os.path.join(json_folder, json_name)

                csv_writer.add_row(
                    source_path=source_path, png_path=png_path, json_path=json_path,
                    mask_folder=image_mask_folder if image_mask_folder is not None else "N/A",
                    config=config, num_masks=len(mask_paths),
                    page_index=page_idx, page_count=page_count
                )

                # Generate mask overlay test image if requested
                if args.mask_test:
                    mask_file_name = f"mask_{args.mask_test}.png"
                    mask_path_test = os.path.join(image_mask_folder, mask_file_name)
                    if os.path.exists(mask_path_test):
                        test_image_name = f"{os.path.splitext(png_name)[0]}_test_{args.mask_test}.png"
                        test_image_path = os.path.join(mask_test_folder, test_image_name)
                        create_mask_overlay(png_path, mask_path_test, test_image_path)

                # Generate verification outputs if requested
                if args.verify_scaling:
                    verification_folder = os.path.join(dataset_folder, "verification")
                    os.makedirs(verification_folder, exist_ok=True)
                    try:
                        generate_verification_outputs(
                            source_path, png_path, leads_data_final, page_config,
                            verification_folder, f"{ecg_id}_{config_idx:02d}_p{page_idx}"
                        )
                    except Exception:
                        pass

                if args.show_pipeline:
                    print(f"  [{image_counter}/{total_images}] Generated: {png_name}")
                else:
                    print_progress_bar(image_counter, total_images, png_name, start_time=_batch_start_time)
                image_counter += 1

            except Exception as e:
                if args.show_pipeline or args.verbose:
                    print(f"\n{'='*60}")
                    print(f"ERROR: Failed to process {ecg_id}")
                    print(f"Error: {e}")
                    import traceback
                    traceback.print_exc()
                    print(f"{'='*60}\n")
                else:
                    print(f"  Error with {ecg_id}: {e}")
                image_counter += 1

    if not args.show_pipeline:
        print()  # Final newline after progress bar

    png_count = len(glob.glob(os.path.join(png_folder, "*.webp"))) + len(glob.glob(os.path.join(png_folder, "*.png")))
    json_count = len(glob.glob(os.path.join(json_folder, "*.json")))

    if not args.no_masks:
        mask_folders = glob.glob(os.path.join(mask_folder, "*"))
        mask_folder_count = len([d for d in mask_folders if os.path.isdir(d)])
        total_mask_count = sum([len(glob.glob(os.path.join(d, "*.png"))) for d in mask_folders if os.path.isdir(d)])

    perf_logger.save_log(verbose=args.verbose)

    print("=" * 50)
    print("GENERATION COMPLETED!")
    print("=" * 50)
    print(f"Final statistics:")
    print(f"   • ECG images generated: {png_count}")
    print(f"   • JSON files generated: {json_count}")
    if not args.no_masks:
        print(f"   • Mask folders created: {mask_folder_count}")
        print(f"   • Total PNG masks generated: {total_mask_count}")
    if args.mask_test:
        test_images_count = len(glob.glob(os.path.join(mask_test_folder, "*.png")))
        print(f"   • Mask test images generated: {test_images_count}")
    if args.verify_scaling:
        verification_folder = os.path.join(dataset_folder, "verification")
        if os.path.exists(verification_folder):
            verification_count = len([f for f in glob.glob(os.path.join(verification_folder, "*_verified.png"))])
            print(f"   • Verification images generated: {verification_count}")
    print(f"   • ECG files processed: {total_ecgs}")
    print(f"   • Images per ECG run: {images_per_ecg}")

    if size_error_files:
        print(f"   • Files with size errors: {len(size_error_files)}")

    print(f"Results in:")
    print(f"   • Images: {png_folder}/")
    print(f"   • Configs: {json_folder}/")
    if not args.no_masks:
        print(f"   • Masks: {mask_folder}/<image_name>/")
    if args.mask_test:
        print(f"   • Mask test images: {mask_test_folder}/")
    if args.verify_scaling:
        verification_folder = os.path.join(dataset_folder, "verification")
        print(f"   • Verification outputs: {verification_folder}/")
    print(f"   • Dataset CSV: {csv_path}")
    print(f"   • Performance log: {perf_log_path}")

    if args.no_masks:
        if png_count == total_images and json_count == total_images:
            print("Complete dataset generated successfully!")
        else:
            print(f"Warning: {total_images} images expected ({png_count} generated)")
    else:
        # Each image should have 27 masks: 12 standard leads + 12 extra leads + all_signals + grid_only + grid_line
        expected_masks = total_images * 27
        if png_count == total_images and json_count == total_images and total_mask_count == expected_masks:
            print("Complete dataset generated successfully!")
        else:
            print(f"Warning: {total_images} images expected ({png_count} generated), {expected_masks} masks expected ({total_mask_count} generated)")

    if size_error_files:
        print("")
        print(f"WARNING: {len(size_error_files)} file(s) with size errors (renamed with SIZE_ERROR prefix):")
        for error_file in size_error_files:
            print(f"   - {error_file}")

    return 0


if __name__ == "__main__":
    exit_code = main()
    exit(exit_code)
"""
CSV Writer for Dataset Characteristics
Exports comprehensive metadata for all generated ECG images including
file paths, rendering configurations, and mask information
"""

import csv
import json
import os
from pathlib import Path


class DatasetCSVWriter:
    """
    Manages CSV file creation and row appending for dataset characteristics

    Each row represents one generated ECG image with its complete configuration.
    Nested config structures (reference_pulse, text_formatting, etc.) are flattened
    into individual columns for easier analysis.
    """

    HEADERS = [
        # File paths
        'image_id',
        'source_path',
        'source_type',
        'image_path',
        'json_path',
        'masks_folder_path',

        # Page information (multi-page support)
        'page_index',
        'page_count',
        'is_multipage',

        # Main configuration
        'format_choice',
        'rythm_leads',
        'signal_color',
        'lead_order',

        # Page & rendering
        'page_size',
        'speed_mm_per_s',
        'gain_mm_per_mV',
        'signal_line_width',
        'signal_antialiased',

        # Spacing
        'horizontal_spacing_mm',
        'vertical_spacing_mm',
        'vertical_offset_max_mm',
        'special_spacing_type',
        'special_spacing_params',

        # Separation
        'separation_style',
        'separation_color',

        # Grid
        'grid_layout_style',
        'grid_style_major',
        'grid_style_minor',
        'grid_color',

        # Reference pulse
        'reference_pulse_number',
        'reference_pulse_h_pos',
        'reference_pulse_v_pos',
        'pulse_and_signal_space',
        'signal_and_pulse_shift_mm',

        # Text formatting
        'lead_text_color',
        'lead_text_shift',
        'spacing_lead_text',
        'lead_text_size',

        # Lead nomenclatures
        'lead_nomenclature_peripheriques',
        'lead_nomenclature_precordiales',

        # Noise
        'added_noise',
        'applied_noise_type',
        'applied_noise_seed',

        # Display options
        'show_medical_text',

        # Computed metadata
        'num_masks',
        'has_extra_leads'
    ]

    def __init__(self, csv_path, project_root=None):
        """
        Initialize CSV writer for dataset tracking

        Args:
            csv_path (str): Path where CSV file will be created/written
            project_root (str): Project root directory for relative paths (default: auto-detect)
        """
        self.csv_path = csv_path
        self.file_exists = os.path.exists(csv_path)

        # Auto-detect project root if not provided
        if project_root is None:
            # Find project root by looking for the directory containing 'data' folder
            current_dir = os.path.abspath(os.path.dirname(csv_path))
            while current_dir != os.path.dirname(current_dir):  # Stop at filesystem root
                if os.path.exists(os.path.join(current_dir, 'data')):
                    project_root = current_dir
                    break
                current_dir = os.path.dirname(current_dir)

            # Fallback: use parent of CSV directory if data folder not found
            if project_root is None:
                project_root = os.path.dirname(os.path.dirname(csv_path))

        self.project_root = os.path.abspath(project_root)

    def initialize(self):
        """
        Create CSV file with headers, clearing any previous data

        Note: This overwrites any existing file at csv_path
        """
        with open(self.csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=self.HEADERS)
            writer.writeheader()

        if self.file_exists:
            print(f"[INFO] Cleared and recreated CSV file: {self.csv_path}")
        else:
            print(f"[INFO] Created CSV file: {self.csv_path}")

    def add_row(self, source_path, png_path, json_path, mask_folder, config, num_masks, page_index=0, page_count=1):
        """
        Add a row to the CSV for a generated image

        Flattens nested configuration structures and converts all paths to relative paths
        for portability.

        Args:
            source_path (str): Path to source ECG file (.xml, .npy, .npz)
            png_path (str): Path to generated ECG image (PNG)
            json_path (str): Path to JSON configuration file
            mask_folder (str): Path to folder containing mask images
            config (dict): Complete configuration dictionary with all rendering parameters
            num_masks (int): Number of mask PNG files generated
            page_index (int): Page index for multi-page formats (0-based, default: 0)
            page_count (int): Total number of pages for this configuration (default: 1)
        """
        image_id = os.path.splitext(os.path.basename(png_path))[0]

        # Detect source file type
        source_ext = os.path.splitext(source_path)[1].lower()
        if source_ext == '.xml':
            source_type = 'xml'
        elif source_ext in ['.hdf5', '.h5']:
            source_type = 'hdf5'
        else:
            source_type = 'unknown'

        # Detect if format includes rhythm strips (extra leads)
        format_choice = config.get('format_choice', '')
        has_extra_leads = format_choice in ['3x4+1', '3x4+2', '3x4+3', '6x2+1']

        # Extract and flatten special_spacing configuration
        special_spacing = config.get('special_spacing')
        special_spacing_type = None
        special_spacing_params = None
        if special_spacing:
            special_spacing_type = special_spacing.get('type')
            special_spacing_params = json.dumps(special_spacing)

        # Extract grid_style components (list: [major_style, minor_style])
        grid_style = config.get('grid_style', [None, None])
        grid_style_major = grid_style[0] if len(grid_style) > 0 else None
        grid_style_minor = grid_style[1] if len(grid_style) > 1 else None

        ref_pulse = config.get('reference_pulse', {})
        text_fmt = config.get('text_formatting', {})
        nomenclatures = config.get('lead_nomenclatures', {})

        # Convert rhythm leads list to comma-separated string
        rythm_leads = config.get('rythm_leads')
        if rythm_leads and isinstance(rythm_leads, list):
            rythm_leads = ','.join(rythm_leads)

        # Build row with all configuration fields (paths are relative to project root)
        row = {
            'image_id': image_id,
            'source_path': os.path.relpath(source_path, start=self.project_root),
            'source_type': source_type,
            'image_path': os.path.relpath(png_path, start=self.project_root),
            'json_path': os.path.relpath(json_path, start=self.project_root),
            'masks_folder_path': os.path.relpath(mask_folder, start=self.project_root),

            'page_index': page_index,
            'page_count': page_count,
            'is_multipage': page_count > 1,

            'format_choice': format_choice,
            'rythm_leads': rythm_leads,
            'signal_color': config.get('signal_color'),
            'lead_order': config.get('lead_order'),

            'page_size': config.get('page_size'),
            'speed_mm_per_s': config.get('speed_mm_per_s'),
            'gain_mm_per_mV': config.get('gain_mm_per_mV'),
            'signal_line_width': config.get('signal_line_width'),
            'signal_antialiased': config.get('signal_antialiased'),

            'horizontal_spacing_mm': config.get('horizontal_spacing_mm'),
            'vertical_spacing_mm': config.get('vertical_spacing_mm'),
            'vertical_offset_max_mm': config.get('vertical_offset_max_mm'),
            'special_spacing_type': special_spacing_type,
            'special_spacing_params': special_spacing_params,

            'separation_style': config.get('separation_style'),
            'separation_color': config.get('separation_color'),

            'grid_layout_style': config.get('grid_layout_style'),
            'grid_style_major': grid_style_major,
            'grid_style_minor': grid_style_minor,
            'grid_color': config.get('grid_color'),

            'reference_pulse_number': ref_pulse.get('number_of_ref_pulse'),
            'reference_pulse_h_pos': ref_pulse.get('horizontal_position_ref_pulse'),
            'reference_pulse_v_pos': ref_pulse.get('vertical_position_ref_pulse'),
            'pulse_and_signal_space': ref_pulse.get('pulse_and_signal_space'),
            'signal_and_pulse_shift_mm': ref_pulse.get('signal_and_pulse_shift_mm'),

            'lead_text_color': text_fmt.get('lead_text_color'),
            'lead_text_shift': text_fmt.get('lead_text_shift'),
            'spacing_lead_text': text_fmt.get('spacing_lead_text'),
            'lead_text_size': text_fmt.get('lead_text_size'),

            'lead_nomenclature_peripheriques': nomenclatures.get('peripheriques'),
            'lead_nomenclature_precordiales': nomenclatures.get('precordiales'),

            'added_noise': config.get('added_noise'),
            'applied_noise_type': config.get('applied_noise_type'),
            'applied_noise_seed': config.get('applied_noise_seed'),

            'show_medical_text': config.get('show_medical_text'),

            'num_masks': num_masks,
            'has_extra_leads': has_extra_leads
        }

        with open(self.csv_path, 'a', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=self.HEADERS)
            writer.writerow(row)

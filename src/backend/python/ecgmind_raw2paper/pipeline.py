"""ECG image generation pipeline."""

import os
import xml.etree.ElementTree as ET
import matplotlib.pyplot as plt

from ecg_generator.in_out.data_source import create_data_source
from ecg_generator.config.manager import validate_and_fix_config
from ecg_generator.config.constants import (
    DPI, IMG_WIDTH_PX, IMG_HEIGHT_PX, LAYOUT_TEMPLATES
)
from ecg_generator.layout.manager import (
    apply_lead_order, apply_lead_nomenclatures, create_inverse_mapping
)
from ecg_generator.layout.renderer import render_ecg_layout
from ecg_generator.layout.figure_utils import save_figure_standard
from ecg_generator.pipeline import calculate_layout_dimensions

from ecgmind_raw2paper.config import build_standard_config


def _read_source_duration_seconds(input_path, n_samples):
    """
    Read the actual signal duration from the input file's <SampleBase> tag.

    The default `ecg_generator` renderer hardcodes a 10-second assumption
    (renderer.py:1155). For our use case (signals of 5-10 seconds extracted
    from various PDFs), we need to provide the real duration.

    Returns:
        float: duration in seconds, or None if not extractable.
    """
    if not input_path.lower().endswith(".xml"):
        return None
    try:
        tree = ET.parse(input_path)
        sb_el = tree.find(".//SampleBase")
        if sb_el is not None and sb_el.text:
            sample_rate = float(sb_el.text)
            if sample_rate > 0 and n_samples > 0:
                return n_samples / sample_rate
    except Exception:
        pass
    return None


def generate_ecg_image(input_path, output_path, output_format="webp"):
    """
    Generate a standardized ECG image from an ECG data file.

    Supports XML, WFDB (.hea/.dat), HDF5, CSV, and NumPy formats.

    Args:
        input_path: Path to the input ECG file.
        output_path: Path for the output image file.
        output_format: 'webp' (default) or 'png'.

    Returns:
        str: Path to the saved image.
    """
    # 1. Load ECG data (auto-detects format)
    source = create_data_source(input_path)
    ecg_id, leads_data = next(iter(source))

    # 2. Build and validate config
    config = build_standard_config()
    config = validate_and_fix_config(config)

    # Inject the real source duration so the renderer doesn't assume 10s
    # (see renderer.py:1155 — uses config.get("_source_duration_s", 10))
    duration = None
    if leads_data:
        n_samples = len(next(iter(leads_data.values())))
        duration = _read_source_duration_seconds(input_path, n_samples)
        if duration is not None:
            config["_source_duration_s"] = duration

    # Each cell of our layout contains a DIFFERENT lead with simultaneous data,
    # not a different time slice of the same lead. Tell the renderer not to slice
    # the signal between columns — each cell should show its lead's full duration.
    config["_independent_cells"] = True

    # Choose layout based on signal duration so each cell fits its data well:
    #   - short signals (≤ 4s): 3x4+1 (4 narrow cols, typical of MUSE/Mortara 12-lead PDFs)
    #   - medium signals (4-8s): 6x2+1 (2 wider cols)
    #   - long signals (> 8s): 12x1 (each lead full width)
    if duration is not None:
        if duration <= 4:
            config["format_choice"] = "3x4+1"
        elif duration <= 8:
            config["format_choice"] = "6x2+1"
        else:
            config["format_choice"] = "12x1"

    # 3. Compute layout
    layout_template = LAYOUT_TEMPLATES[config["format_choice"]]
    layout = apply_lead_order(
        layout_template, config["lead_order"], config.get("rythm_leads")
    )
    inverse_mapping = create_inverse_mapping(config["lead_nomenclatures"])
    layout = apply_lead_nomenclatures(layout, config["lead_nomenclatures"])

    page_width_px = config.get("page_width_px", IMG_WIDTH_PX)
    page_height_px = config.get("page_height_px", IMG_HEIGHT_PX)
    dimensions = calculate_layout_dimensions(config, len(layout), page_width_px, page_height_px)

    # 4. Render
    fig, ax, coord_data = render_ecg_layout(
        leads_data, layout, config, dimensions, inverse_mapping,
        page_width_px=page_width_px, page_height_px=page_height_px
    )

    # Apply background color (matplotlib defaults to white, which makes
    # the gold grid almost invisible)
    bg = config.get("background_color", "#FDFAF5")
    fig.patch.set_facecolor(bg)
    ax.set_facecolor(bg)

    # 5. Save via save_figure_standard — this triggers the PIL post-processing
    # that renders deferred lead labels (I, II, V1...). A direct fig.savefig()
    # would skip this and produce an image without labels.
    save_figure_standard(
        fig, output_path,
        transparent=False,
        expected_width_px=page_width_px,
        expected_height_px=page_height_px,
        coord_data=coord_data,
    )

    print(f"[OK] ECG image saved to {output_path}")
    return output_path

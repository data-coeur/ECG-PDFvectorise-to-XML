"""ECG image generation pipeline."""

import os
import base64
import xml.etree.ElementTree as ET
import numpy as np
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


def _read_rhythm_strip_signal(input_path):
    """
    Read the rhythm strip channel ("II_rhythm") from a MUSE-style XML if present.

    The standard ecg_generator XML parser only extracts the 12 standard leads
    and drops everything else, but we use the channel name "II_rhythm" to
    smuggle a longer rhythm signal that should be displayed on the bottom row.

    Returns:
        numpy.ndarray: rhythm strip signal in mV, or None if not present.
    """
    if not input_path.lower().endswith(".xml"):
        return None
    try:
        tree = ET.parse(input_path)
        root = tree.getroot()
        for waveform in root.findall(".//Waveform"):
            wt = waveform.find("WaveformType")
            if wt is None or wt.text is None or wt.text.strip().upper() != "RHYTHM":
                continue
            for lead in waveform.findall("LeadData"):
                lid = lead.find("LeadID")
                if lid is None or lid.text is None:
                    continue
                if not lid.text.strip().lower().endswith("_rhythm"):
                    continue
                gain_el = lead.find("LeadAmplitudeUnitsPerBit")
                wfd_el = lead.find("WaveFormData")
                if gain_el is None or wfd_el is None or wfd_el.text is None:
                    continue
                gain = float(gain_el.text.strip())
                b64 = wfd_el.text.replace('\n', '').replace('\r', '')
                decoded = base64.b64decode(b64)
                signal = np.frombuffer(decoded, dtype='<i2') * gain / 1000.0
                return signal
    except Exception:
        pass
    return None


def generate_ecg_image(input_path, output_path, output_format="webp", format_override=None):
    """
    Generate a standardized ECG image from an ECG data file.

    Supports XML, WFDB (.hea/.dat), HDF5, CSV, and NumPy formats.

    Args:
        input_path: Path to the input ECG file.
        output_path: Path for the output image file.
        output_format: 'webp' (default) or 'png'.
        format_override: If set (e.g. '3x4', '6x2+1'), overrides auto-detection
                         from signal duration.

    Returns:
        str: Path to the saved image.
    """
    # 1. Load ECG data (auto-detects format)
    source = create_data_source(input_path)
    ecg_id, leads_data = next(iter(source))

    # If the XML carries a dedicated rhythm strip channel ("II_rhythm"),
    # substitute lead II with this longer signal. The renderer handles this:
    #  - Grid cell for lead II: shows signal[0:slice_samples] (first 2.5s)
    #    via _col_slice_idx with _independent_cells=True
    #  - Rhythm row (is_extra_line): draws signal[:extra_samples] across
    #    the full page width in one pass, ignoring _independent_cells
    rhythm_signal = _read_rhythm_strip_signal(input_path)
    if rhythm_signal is not None and "II" in leads_data:
        if len(rhythm_signal) > len(leads_data["II"]):
            leads_data["II"] = rhythm_signal

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

    # Choose layout: explicit override from the frontend, or auto-detect from duration
    if format_override and format_override in LAYOUT_TEMPLATES:
        config["format_choice"] = format_override
    elif duration is not None:
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

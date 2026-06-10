"""ECG image generation pipeline."""

import base64
import os
import xml.etree.ElementTree as ET

import numpy as np
import matplotlib
import matplotlib.pyplot as plt
from PIL import Image as PILImage, ImageDraw, ImageFont

from ecg_generator.in_out.data_source import create_data_source
from ecg_generator.config.manager import validate_and_fix_config
from ecg_generator.config.constants import LAYOUT_TEMPLATES, MM_TO_PX, DPI
from ecg_generator.layout.manager import (
    apply_lead_order, apply_lead_nomenclatures, create_inverse_mapping
)
from ecg_generator.layout.renderer import render_ecg_layout
from ecg_generator.layout.figure_utils import _render_deferred_texts, _render_deferred_texts_mpl

from ecgmind_raw2paper.config import build_standard_config, resolve_logo_path, DEFAULT_LOGO
from ecgmind_raw2paper.sizing import compute_canvas_layout


def _read_source_duration_seconds(input_path, n_samples):
    """Real per-cell signal duration from the MUSE XML <SampleBase> (sample rate).

    Upstream raw2paper assumes a 10 s recording, but our traces are per-cell
    signals of varying real duration (5 s, 2.5 s…). Returns n_samples / rate, or
    None when not extractable (renderer then falls back to its 10 s default).
    """
    if not str(input_path).lower().endswith(".xml"):
        return None
    try:
        sb = ET.parse(input_path).find(".//SampleBase")
        if sb is not None and sb.text:
            rate = float(sb.text)
            if rate > 0 and n_samples > 0:
                return n_samples / rate
    except Exception:
        pass
    return None


def _read_rhythm_strip_signal(input_path):
    """Read the long rhythm-strip channel ("*_rhythm" LeadID) from the MUSE XML.

    The data-source parser only keeps the 12 standard leads; we smuggle a longer
    rhythm signal under a LeadID ending in "_rhythm" so the bottom rhythm row can
    show the full recording instead of a stretched copy of the 5 s standard lead.
    Returns the signal in mV (ndarray), or None when absent.
    """
    if not str(input_path).lower().endswith(".xml"):
        return None
    try:
        root = ET.parse(input_path).getroot()
        for waveform in root.findall(".//Waveform"):
            wt = waveform.find("WaveformType")
            if wt is None or wt.text is None or wt.text.strip().upper() != "RHYTHM":
                continue
            for lead in waveform.findall("LeadData"):
                lid = lead.find("LeadID")
                if lid is None or lid.text is None or not lid.text.strip().lower().endswith("_rhythm"):
                    continue
                gain_el = lead.find("LeadAmplitudeUnitsPerBit")
                wfd_el = lead.find("WaveFormData")
                if gain_el is None or wfd_el is None or wfd_el.text is None:
                    continue
                gain = float(gain_el.text.strip())
                b64 = wfd_el.text.replace("\n", "").replace("\r", "")
                decoded = base64.b64decode(b64)
                return np.frombuffer(decoded, dtype="<i2") * gain / 1000.0
    except Exception:
        pass
    return None


LOGO_TARGET_HEIGHT_PX = 90                    # ~7.5 mm — drives the bottom strip height
STRIP_BOTTOM_INSET_PX = int(1 * MM_TO_PX)     # 12 px — gap from image bottom to strip bottom
STRIP_HORIZONTAL_INSET_PX = int(5 * MM_TO_PX) # 60 px — left inset for text, right inset for logo


# ============================================================
# EDIT HERE to change the bottom-left annotation text.
# Set to "" or None to hide the strip entirely.
BOTTOM_LEFT_TEXT = "Paper speed: 25 mm/s, Voltage gain: 10 mm/mV"
# ============================================================

# ============================================================
# EDIT HERE to change the bottom-right citation text.
# Set to "" or None to hide it.
BOTTOM_RIGHT_TEXT = "Source: MIMIC-IV-ECG, PhysioNet (CHDL v1.5.0)"
# ============================================================

BOTTOM_LEFT_FONT_SIZE_PX = 36     # ~3 mm tall glyphs
BOTTOM_TEXT_PAD_Y_PX = 12
RIGHT_TEXT_TO_LOGO_GAP_PX = int(15 * MM_TO_PX)

_FONT_PATH = os.path.join(
    matplotlib.get_data_path(), "fonts", "ttf", "DejaVuSans.ttf"   #DejaVuSans-Bold.ttf
)


def _draw_bottom_left_text(pil_img, text, text_color):
    """Paint `text` directly onto the canvas in the bottom-left corner.

    Text is bottom-aligned with the logo via STRIP_BOTTOM_INSET_PX so both
    sit on the same baseline within the LOGO_TARGET_HEIGHT_PX-tall strip area.
    """
    if not text:
        return
    draw = ImageDraw.Draw(pil_img)
    font = ImageFont.truetype(_FONT_PATH, BOTTOM_LEFT_FONT_SIZE_PX)

    bbox = draw.textbbox((0, 0), text, font=font)
    text_h = bbox[3] - bbox[1]
    text_block_h = text_h + 2 * BOTTOM_TEXT_PAD_Y_PX

    x0 = STRIP_HORIZONTAL_INSET_PX
    y0 = pil_img.height - STRIP_BOTTOM_INSET_PX - text_block_h
    draw.text(
        (x0 - bbox[0],
         y0 + BOTTOM_TEXT_PAD_Y_PX - bbox[1]),
        text, fill=text_color, font=font,
    )


def _draw_bottom_right_text(pil_img, text, text_color, right_edge_px):
    """Paint `text` so its right edge sits at `right_edge_px`, bottom-aligned with the logo."""
    if not text:
        return
    draw = ImageDraw.Draw(pil_img)
    font = ImageFont.truetype(_FONT_PATH, BOTTOM_LEFT_FONT_SIZE_PX)

    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    text_block_h = text_h + 2 * BOTTOM_TEXT_PAD_Y_PX

    y0 = pil_img.height - STRIP_BOTTOM_INSET_PX - text_block_h
    draw.text(
        (right_edge_px - text_w - bbox[0],
         y0 + BOTTOM_TEXT_PAD_Y_PX - bbox[1]),
        text, fill=text_color, font=font,
    )


def _resize_logo(logo_path):
    logo = PILImage.open(logo_path).convert("RGBA")
    w, h = logo.size
    new_h = LOGO_TARGET_HEIGHT_PX
    new_w = round(w * new_h / h)
    return logo.resize((new_w, new_h), PILImage.LANCZOS)


def _paste_logo(pil_img, logo):
    x = pil_img.width - logo.width - STRIP_HORIZONTAL_INSET_PX
    y = pil_img.height - logo.height - STRIP_BOTTOM_INSET_PX
    pil_img.alpha_composite(logo, (x, y))


def _mpl_color(c):
    """Normalize a color to a matplotlib value (0-255 tuple -> 0-1; else passthrough)."""
    if isinstance(c, (tuple, list)):
        return tuple(v / 255 if v > 1 else v for v in c[:3])
    return c


def _save_vector_pdf(fig, ax, coord_data, canvas, config, logo_path, output_path,
                     has_text, has_logo):
    """Render the ECG to a TRUE vector PDF (grid + traces + labels all vector).

    The figure already holds the grid and signal traces as vector matplotlib
    artists. Here we add the deferred lead labels, the bottom annotation strip and
    the logo IN matplotlib (instead of the PIL raster post-pass), then savefig to
    PDF. Data space == pixel space (origin bottom-left). The logo is embedded as a
    small raster image — fine inside an otherwise-vector page.
    """
    W = canvas.canvas_width_px

    # Lead labels — vector text.
    if coord_data.deferred_texts:
        _render_deferred_texts_mpl(ax, coord_data.deferred_texts, DPI)

    txt_color = _mpl_color(config.get("bottom_text_color", (0, 0, 0)))
    fontsize_pt = BOTTOM_LEFT_FONT_SIZE_PX * 72.0 / DPI
    baseline_y = STRIP_BOTTOM_INSET_PX + BOTTOM_TEXT_PAD_Y_PX  # from page bottom

    # Logo — embedded raster, bottom-right. imshow can rescale the axes, so snapshot
    # and restore the limits around it.
    logo_left_x = W - STRIP_HORIZONTAL_INSET_PX
    if has_logo:
        try:
            xlim, ylim = ax.get_xlim(), ax.get_ylim()
            logo = _resize_logo(logo_path)
            x1 = W - STRIP_HORIZONTAL_INSET_PX
            x0 = x1 - logo.width
            y0 = STRIP_BOTTOM_INSET_PX
            ax.imshow(np.asarray(logo), extent=[x0, x1, y0, y0 + logo.height],
                      origin='upper', aspect='auto', zorder=10,
                      interpolation='antialiased')
            ax.set_xlim(xlim); ax.set_ylim(ylim)
            logo_left_x = x0 - RIGHT_TEXT_TO_LOGO_GAP_PX
        except Exception:
            pass

    if has_text and BOTTOM_LEFT_TEXT:
        ax.text(STRIP_HORIZONTAL_INSET_PX, baseline_y, BOTTOM_LEFT_TEXT,
                fontsize=fontsize_pt, color=txt_color, ha='left', va='bottom',
                clip_on=False, zorder=5)
    if BOTTOM_RIGHT_TEXT:
        ax.text(logo_left_x, baseline_y, BOTTOM_RIGHT_TEXT,
                fontsize=fontsize_pt, color=txt_color, ha='right', va='bottom',
                clip_on=False, zorder=5)

    fig.savefig(output_path, dpi=DPI, pad_inches=0)
    plt.close(fig)


def generate_ecg_image(input_path, output_path, output_format="webp", theme="turquoise",
                       logo=DEFAULT_LOGO, format_override=None):
    """
    Generate a standardized ECG image from an XML ECG file.

    Args:
        input_path: Path to the input XML ECG file.
        output_path: Path for the output image file.
        output_format: 'webp' (default) or 'png'.
        theme: Color theme name (default "turquoise").
        logo: Logo name (key in LOGOS), filesystem path, or None to disable.
            Defaults to "full_transparent".

    Returns:
        str: Path to the saved image.
    """
    logo_path = resolve_logo_path(logo)
    # 1. Load ECG data.
    source = create_data_source(input_path)
    _ecg_id, leads_data = next(iter(source))

    # Length of a standard (non-rhythm) lead — captured before the II substitution
    # below, used to derive the real per-cell duration.
    standard_n_samples = len(leads_data["II"]) if "II" in leads_data else (
        len(next(iter(leads_data.values()))) if leads_data else 0)

    # Substitute lead II with the long rhythm strip (smuggled as "*_rhythm") so the
    # bottom rhythm row shows the full recording. The standard II cell still shows
    # only its first window (signal[:slice_samples]) — see signal.py.
    rhythm_signal = _read_rhythm_strip_signal(input_path)
    if rhythm_signal is not None and "II" in leads_data and len(rhythm_signal) > len(leads_data["II"]):
        leads_data["II"] = rhythm_signal

    # 2. Build and validate config.
    config = build_standard_config(theme=theme)
    config = validate_and_fix_config(config)

    # Honour the layout chosen in the UI (e.g. 12x1, 6x2, 3x4+1). The frontend
    # sends it as a query param, where Express decodes '+' to a space, so
    # normalise ' ' -> '+' before matching LAYOUT_TEMPLATES. Without this the
    # render ignores the button and always uses the config default (6x2+1).
    if format_override:
        fmt = str(format_override).replace(" ", "+")
        if fmt in LAYOUT_TEMPLATES:
            config["format_choice"] = fmt

    # Each layout cell holds a DIFFERENT lead's complete per-cell signal (our
    # extractor produces per-cell traces, not one full-duration recording to
    # window across columns). Tell the renderer to (a) use the real signal
    # duration instead of a hardcoded 10 s, and (b) show each cell's whole signal
    # rather than slicing it by column. Without this, leads are stretched (wrong
    # duration) or chopped to 1/n_cols of their beats.
    config["_independent_cells"] = True
    if standard_n_samples:
        duration = _read_source_duration_seconds(input_path, standard_n_samples)
        if duration:
            config["_source_duration_s"] = duration

    # 3. Compute layout.
    layout_template = LAYOUT_TEMPLATES[config["format_choice"]]
    layout = apply_lead_order(
        layout_template, config["lead_order"], config.get("rythm_leads")
    )
    inverse_mapping = create_inverse_mapping(config["lead_nomenclatures"])
    layout = apply_lead_nomenclatures(layout, config["lead_nomenclatures"])

    # 4. Size the canvas to the actual signal extents (5 mm top, 5 mm left, 2 mm right,
    #    2 mm + strip + 1 mm bottom).
    has_text = bool(BOTTOM_LEFT_TEXT)
    has_logo = bool(logo_path)
    canvas = compute_canvas_layout(
        leads_data, layout, config, inverse_mapping,
        has_text=has_text, has_logo=has_logo,
        logo_target_height_px=LOGO_TARGET_HEIGHT_PX,
        source_duration_s=config.get("_source_duration_s", 10.0),
    )

    # 5. Render with the dynamic canvas dimensions and signal anchors.
    fig, _ax, coord_data = render_ecg_layout(
        leads_data, layout, config, inverse_mapping,
        page_width_px=canvas.canvas_width_px,
        page_height_px=canvas.canvas_height_px,
        signal_area_x_start_override=canvas.signal_area_x_start_px,
        signal_area_y_start_override=canvas.signal_area_y_start_px,
        signal_area_width_override=canvas.signal_area_width_px,
        signal_area_height_override=canvas.signal_area_height_px,
    )

    # 6. Save.
    if output_format == "pdf":
        # True vector PDF: draw labels/strip/logo in matplotlib (no PIL post-pass).
        _save_vector_pdf(fig, _ax, coord_data, canvas, config, logo_path, output_path,
                         has_text=has_text, has_logo=has_logo)
        print(f"[OK] ECG vector PDF saved to {output_path}")
        return output_path

    save_kwargs = dict(dpi=DPI, pad_inches=0)
    if output_format == "webp":
        save_kwargs["pil_kwargs"] = {"lossless": True}

    fig.savefig(output_path, **save_kwargs)
    plt.close(fig)

    # PIL post-pass: deferred lead labels, bottom-left annotation strip, logo.
    has_right_text = bool(BOTTOM_RIGHT_TEXT)
    if coord_data.deferred_texts or has_logo or has_text or has_right_text:
        pil_img = PILImage.open(output_path).convert("RGBA")
        if coord_data.deferred_texts:
            _render_deferred_texts(
                pil_img, coord_data.deferred_texts,
                canvas.canvas_width_px, canvas.canvas_height_px,
            )
        if has_text:
            _draw_bottom_left_text(pil_img, BOTTOM_LEFT_TEXT, config["bottom_text_color"])
        logo_img = _resize_logo(logo_path) if has_logo else None
        if has_right_text:
            if has_logo:
                logo_left_x = pil_img.width - logo_img.width - STRIP_HORIZONTAL_INSET_PX
                right_edge_px = logo_left_x - RIGHT_TEXT_TO_LOGO_GAP_PX
            else:
                right_edge_px = pil_img.width - STRIP_HORIZONTAL_INSET_PX
            _draw_bottom_right_text(pil_img, BOTTOM_RIGHT_TEXT, config["bottom_text_color"], right_edge_px)
        if has_logo:
            _paste_logo(pil_img, logo_img)
        if output_format == "webp":
            pil_img.save(output_path, "WEBP", lossless=True)
        else:
            pil_img.save(output_path)

    print(f"[OK] ECG image saved to {output_path}")
    return output_path

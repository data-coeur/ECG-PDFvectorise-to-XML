"""ECG image generation pipeline."""

import os

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
from ecg_generator.layout.figure_utils import _render_deferred_texts

from ecgmind_raw2paper.config import build_standard_config, resolve_logo_path, DEFAULT_LOGO
from ecgmind_raw2paper.sizing import compute_canvas_layout


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


def generate_ecg_image(input_path, output_path, output_format="webp", theme="turquoise", logo=DEFAULT_LOGO):
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

    # 2. Build and validate config.
    config = build_standard_config(theme=theme)
    config = validate_and_fix_config(config)

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

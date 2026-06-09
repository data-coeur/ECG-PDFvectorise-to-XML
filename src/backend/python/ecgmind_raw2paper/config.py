"""Standard configuration for ECG image generation."""

import os


# Theme palettes: (background, minor_grid, major_grid, label/accent, bottom_text)
THEMES = {
    "blue":         ("#F7FBFF", "#CFE3F5", "#7FB3D5", "#2F4F9C", "#1E3A73"),
    "red":          ("#FFF7F7", "#F5C6C6", "#E89A9A", "#A93232", "#7A1F1F"),
    "yellow":       ("#FDFAF5", "#E8C060", "#C8A020", "#B85E00", "#7A4300"),
    "turquoise":    ("#F5FCFB", "#A9D9D3", "#5FBFB3", "#1F6F78", "#0F5963"),
}

# Logo registry. Files live in <project root>/logo/.
_LOGO_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "logo"))
LOGOS = {
    "app":              "Logo_app.png",
    "app_transparent":  "Logo_app_transparent.png",
    "full":             "Logo_full.png",
    "full_transparent": "Logo_full_transparent.png",
    "no_outline":       "Logo_full_transparent_no_outline.png"
}
DEFAULT_LOGO = "no_outline"


def resolve_logo_path(logo):
    """Resolve a logo name (key in LOGOS) or filesystem path; return None to disable."""
    if not logo:
        return None
    if logo in LOGOS:
        path = os.path.join(_LOGO_DIR, LOGOS[logo])
    else:
        path = logo
    if not os.path.isfile(path):
        raise ValueError(
            f"Logo not found for '{logo}'. Available names: {sorted(LOGOS)}"
        )
    return path

def build_standard_config(theme="turquoise"):
    """
    Build the fixed configuration for standardized ECG rendering.

    Uses the 6x2+1 layout on A4 paper. The color theme is configurable.

    Args:
        theme: One of THEMES keys (default "turquoise").

    Returns:
        dict: Complete configuration ready for ecg_generator rendering pipeline.
    """
    if theme not in THEMES:
        raise ValueError(f"Unknown theme '{theme}'. Available: {sorted(THEMES)}")
    background, minor_grid, major_grid, accent, bottom_text = THEMES[theme]

    return {
        "format_choice": "6x2+1",
        "page_size": "a4",
        "page_width_mm": 297,
        "page_height_mm": 210,
        "page_width_px": 3564,
        "page_height_px": 2520,
        "speed_mm_per_s": 25,
        "gain_mm_per_mV": 10,
        "rythm_leads": ["II"],
        "lead_order": "normal",
        "lead_nomenclatures": {
            "peripheriques": "standard",
            "precordiales": "standard",
        },
        "horizontal_spacing_mm": 0,
        "vertical_spacing_mm": 24,
        "special_spacing": None,
        "vertical_offset_max_mm": 0.0,
        "grid_layout_style": "full_grid",
        "show_medical_text": False,
        "signal_antialiased": False,
        "signal_color": "black",
        "signal_line_width": 2,

        # Theme colors
        "background_color": background,
        "minor_grid_color": minor_grid,
        "major_grid_color": major_grid,
        "grid_color": major_grid,
        "separation_color": accent,
        "bottom_text_color": bottom_text,

        "text_formatting": {
            "lead_text_color": accent,
            "lead_text_shift": 14,
            "spacing_lead_text": 0,
            "lead_text_size": 4,
        },
        "reference_pulse": {
            "number_of_ref_pulse": "one",
            "horizontal_position_ref_pulse": "right",
            "vertical_position_ref_pulse": 7,
            "pulse_and_signal_space": True,
            "pulse_gap_mm": 3,
            "signal_and_pulse_shift_mm": 0,
            "pulse_color": accent,
            "pulse_line_width": 6,
        },
        "separation_style": "line_10mm",
        "grid_style": ["solid", "solid"],
        "sampling_rate_hz": 500,
    }

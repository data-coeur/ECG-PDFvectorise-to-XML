"""
Font manager for ECG text rendering using PIL/Pillow

Provides font loading, caching, and random selection for lead labels
and speed/gain text. Uses bundled open-source TTF fonts for cross-platform
compatibility.

Fonts are rendered with PIL (ImageDraw.text) after matplotlib saves the
figure, which is ~2.4x faster than matplotlib's text engine.
"""

import os
import random
from functools import lru_cache
from PIL import ImageFont
import matplotlib.font_manager as fm

# Directory containing bundled TTF fonts
_FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fonts")

# Available font families with their file stems
# Maps display name -> (filename_stem, type)
# type: "sans" = sans-serif, "serif" = serif, "mono" = monospace
FONT_FAMILIES = {
    "Arimo":        ("Arimo",        "sans"),   # Arial equivalent
    "Carlito":      ("Carlito",      "sans"),   # Calibri equivalent
    "Caladea":      ("Caladea",      "serif"),  # Cambria equivalent
    "Cousine":      ("Cousine",      "mono"),   # Courier New equivalent
    "Inconsolata":  ("Inconsolata",  "mono"),   # Consolas equivalent
    "Tinos":        ("Tinos",        "serif"),  # Times New Roman equivalent
    "PTSans":       ("PTSans",       "sans"),   # Verdana-like
    "DejaVuSans":   ("DejaVu Sans",  "sans"),   # Always available (matplotlib built-in)
}

# Variant suffixes for TTF filenames
_VARIANT_MAP = {
    (False, False): "-Regular",
    (True,  False): "-Bold",
    (False, True):  "-Italic",
    (True,  True):  "-BoldItalic",
}


def _find_font_path(family_name, bold=False, italic=False):
    """Find TTF file path for a font family + variant.

    Falls back through: exact variant -> regular -> DejaVu Sans.
    """
    stem, _ = FONT_FAMILIES.get(family_name, (family_name, "sans"))
    suffix = _VARIANT_MAP[(bold, italic)]
    candidates = [
        os.path.join(_FONTS_DIR, f"{stem}{suffix}.ttf"),
        os.path.join(_FONTS_DIR, f"{stem}-Regular.ttf"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    # Fallback to system DejaVu Sans (always available via matplotlib)
    try:
        props = fm.FontProperties(family="DejaVu Sans",
                                  weight="bold" if bold else "normal",
                                  style="italic" if italic else "normal")
        return fm.findfont(props)
    except Exception:
        return None


@lru_cache(maxsize=128)
def get_pil_font(family_name, size_px, bold=False, italic=False, lang=None):
    """Get a PIL ImageFont for the given family, size, and style.

    Args:
        family_name: Key from FONT_FAMILIES (e.g. "Arimo", "Carlito")
        size_px: Font size in pixels (not points)
        bold: Use bold variant
        italic: Use italic variant
        lang: Optional language code — if non-Latin, uses a Unicode font

    Returns:
        PIL.ImageFont.FreeTypeFont
    """
    # For non-Latin languages, use the multilingual font resolver
    if lang is not None:
        _NON_LATIN_LANGS = {'zh', 'ja', 'ko', 'ar', 'ru', 'el', 'hi'}
        if lang in _NON_LATIN_LANGS:
            try:
                from DataAugmentation.resources.multilingual_medical import (
                    get_script_for_lang, resolve_font_for_script
                )
                script = get_script_for_lang(lang)
                return resolve_font_for_script(script, int(size_px))
            except Exception:
                pass

    path = _find_font_path(family_name, bold, italic)
    if path:
        try:
            return ImageFont.truetype(path, size=int(size_px))
        except (OSError, IOError):
            pass
    return ImageFont.load_default()


def get_available_families():
    """Return list of font family names that have at least a Regular TTF file."""
    available = []
    for name in FONT_FAMILIES:
        path = _find_font_path(name, bold=False, italic=False)
        if path and os.path.isfile(path):
            available.append(name)
    # Always include DejaVuSans as fallback
    if "DejaVuSans" not in available:
        available.append("DejaVuSans")
    return available


def choose_random_font_config(rng=None):
    """Generate random font configuration for lead labels and speed/gain text.

    Returns:
        dict with keys:
            font_family: str - family name from FONT_FAMILIES
            font_bold: bool - use bold variant
            font_italic: bool - use italic variant
            font_size_factor: float - multiplier on base size (0.7 to 1.4)
    """
    r = rng or random
    families = get_available_families()
    return {
        "font_family": r.choice(families),
        "font_bold": r.random() < 0.60,     # 60% bold
        "font_italic": r.random() < 0.15,   # 15% italic
        "font_size_factor": r.uniform(0.85, 1.20),  # -15% to +20%
    }

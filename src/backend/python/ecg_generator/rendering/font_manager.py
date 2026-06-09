"""
Font manager for ECG text rendering using PIL/Pillow.

Resolves a bundled TTF font by family + variant and returns a cached
``PIL.ImageFont.FreeTypeFont``. The upstream package also exposed a random
font chooser and a multilingual (non-Latin) fallback path — both are removed
here since this repo renders Latin lead labels with a fixed font config.
"""

import os
from functools import lru_cache

from PIL import ImageFont
import matplotlib.font_manager as fm


_FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fonts")

# Display name -> (filename stem, category). Category is informational.
FONT_FAMILIES = {
    "Arimo":        ("Arimo",        "sans"),
    "Carlito":      ("Carlito",      "sans"),
    "Caladea":      ("Caladea",      "serif"),
    "Cousine":      ("Cousine",      "mono"),
    "Inconsolata":  ("Inconsolata",  "mono"),
    "Tinos":        ("Tinos",        "serif"),
    "PTSans":       ("PTSans",       "sans"),
    "DejaVuSans":   ("DejaVu Sans",  "sans"),
}

_VARIANT_MAP = {
    (False, False): "-Regular",
    (True,  False): "-Bold",
    (False, True):  "-Italic",
    (True,  True):  "-BoldItalic",
}


def _find_font_path(family_name, bold=False, italic=False):
    """Resolve TTF path for a family + variant, falling back to DejaVu Sans."""
    stem, _ = FONT_FAMILIES.get(family_name, (family_name, "sans"))
    suffix = _VARIANT_MAP[(bold, italic)]
    candidates = [
        os.path.join(_FONTS_DIR, f"{stem}{suffix}.ttf"),
        os.path.join(_FONTS_DIR, f"{stem}-Regular.ttf"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    try:
        props = fm.FontProperties(family="DejaVu Sans",
                                  weight="bold" if bold else "normal",
                                  style="italic" if italic else "normal")
        return fm.findfont(props)
    except Exception:
        return None


@lru_cache(maxsize=128)
def get_pil_font(family_name, size_px, bold=False, italic=False, lang=None):
    """Return a PIL ImageFont for the given family/size/style.

    ``lang`` is accepted for signature compatibility but ignored — the
    multilingual path was removed with the rest of the medical-text feature.
    """
    path = _find_font_path(family_name, bold, italic)
    if path:
        try:
            return ImageFont.truetype(path, size=int(size_px))
        except (OSError, IOError):
            pass
    return ImageFont.load_default()

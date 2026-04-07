"""
Randomization functions for ECG generation

Provides weighted random selection for all visual and configuration parameters:
formats, colors, layouts, grids, text positioning, medical data generation, etc.
"""

import random
import sys
import os
from faker import Faker

# Add project root for multilingual imports
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from DataAugmentation.resources.multilingual_medical import pick_language, get_random_date, PHRASES


def choose_random_page_size():
    """
    Choose random page size (60% A4, 40% US Letter)

    Returns:
        str: "a4" or "us_letter"
    """
    sizes = ["a4", "us_letter"]
    weights = [60, 40]
    return random.choices(sizes, weights=weights)[0]


def choose_random_format():
    """
    Choose random ECG layout format

    Returns:
        str: Format choice (e.g., "3x4", "3x4_paramedic", "6x2+1", "12x1")
    """
    formats = ["3x4", "3x4_paramedic", "3x4+1", "3x4+2", "3x4+3", "6x2", "6x2+1", "4x2", "4x2+1", "12x1", "6x1;6x1", "3x4_cardiofax", "3x4+1_cardiofax"]
    weights = [13, 3, 12, 2, 7, 14, 14, 7, 6, 10, 4, 4, 4]
    return random.choices(formats, weights=weights)[0]


def choose_random_rythm_lead(format_choice):
    """
    Choose random rhythm strip leads for formats with extra leads

    Args:
        format_choice (str): ECG format (e.g., "3x4+1", "6x2+1")

    Returns:
        list or None: List of lead names for rhythm strips, or None if no rhythm strips
    """
    if format_choice in ["3x4+1", "3x4+2", "3x4+3", "6x2+1", "4x2+1"]:
        rythms = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
        weights = [2.5, 50, 5, 2.5, 2.5, 2.5, 20, 2.5, 2.5, 2.5, 5, 2.5]
        final_rythms = []
        for _ in range(int(format_choice[-1])):
            r = random.choices(rythms, weights=weights)[0]
            final_rythms.append(r)
            i = rythms.index(r)
            rythms.pop(i)
            weights.pop(i)
        return final_rythms
    else:
        return None


def choose_random_signal_color():
    """
    Choose random signal color.

    93% black-ish (pure black 78%, dark gray via delta 15%), 7% blue.
    When the base is black, an RGB delta (max ±80) simulates
    faded ink or slightly warm/cool tones.

    Returns:
        str: Color name or hex code
    """
    # 0% blue observed in 107 JoCovid ECGs, reduced from 7% to 2%
    roll = random.random()
    if roll < 0.80:
        return "#000000"                         # pure black
    elif roll < 0.98:
        return _apply_color_delta("#000000", max_delta=80)  # dark gray shade
    else:
        return "blue"                            # rare, some European machines


def choose_random_lead_order():
    """
    Choose random lead ordering scheme

    Returns:
        str: Order type - "normal" (80%), "cabrera" (10%), "territoire" (6%), or "shuffle" (4%)
    """
    orders = ["normal", "cabrera", "territoire", "shuffle"]
    weights = [80, 10, 6, 4]
    return random.choices(orders, weights=weights)[0]


def choose_random_separation_color():
    """
    Choose random color for lead separation lines

    Returns:
        str: Color name (95% black, 5% blue)
    """
    colors = ["black", "blue"]
    weights = [95, 5]
    return random.choices(colors, weights=weights)[0]


def choose_random_horizontal_spacing(format_choice=None):
    """
    Choose random horizontal spacing between signals

    Args:
        format_choice (str, optional): ECG format to apply spacing limits

    Returns:
        int: Spacing in millimeters (0-20mm depending on format)
    """
    if format_choice in ["3x4", "3x4+1", "3x4+2", "3x4+3", "3x4_paramedic", "3x4_cardiofax", "3x4+1_cardiofax"]:
        # Limit to 15mm maximum
        spacings_mm = [0, random.randint(1,5), random.randint(6,10), random.randint(11,15)]
        weights = [45, 30, 15, 10]
        return random.choices(spacings_mm, weights=weights)[0]
    elif format_choice in ["6x2", "6x2+1", "4x2", "4x2+1"]:
        spacings_mm = [0, random.randint(1,5), random.randint(6,10), random.randint(11,15), random.randint(16,20)]
        weights = [40, 30, 10, 10, 10]
        return random.choices(spacings_mm, weights=weights)[0]
    # elif format_choice == "3x4_paramedic":
    #     spacings_mm = [0, random.randint(1,5)]
    #     weights = [50, 50]
    #     return random.choices(spacings_mm, weights=weights)[0]
    else:
        return 0


def choose_random_separation_style():
    """
    Choose random separation style between leads

    Returns:
        str or None: Separation style (50% None, various line styles otherwise)
    """
    
    styles = [
        None,
        "double_line_3mm",
        "quad_line_3mm",
        "thick_line_3mm",
        "line_5mm",
        "line_10mm",
        "dashes_10mm",
        "line_20mm",
        "dashes_25mm",
        "dashed",
        "dotted",
        "solid",
        "solid_thick",   # Vectracor style — thick solid line between columns (#59)
    ]
    weights = [50, 10, 2.5, 2.5, 10, 2.5, 2.5, 2.5, 2.5, 10, 2.5, 2.5, 3]
    return random.choices(styles, weights=weights)[0]


def choose_random_layout_style(format_choice=None):
    """
    Choose random grid layout style (50% full_grid, 50% with_text_zones)

    Args:
        format_choice (str, optional): ECG format to apply style constraints

    Returns:
        str: "full_grid" or "with_text_zones"
    """
    # Paramedic and Cardiofax formats always use full_grid
    if format_choice and (format_choice == "3x4_paramedic" or format_choice.endswith("_cardiofax")):
        return "full_grid"

    styles = ["full_grid", "with_text_zones"]
    weights = [50, 50]
    return random.choices(styles, weights=weights)[0]


def choose_random_grid_squares(page_size, format_choice, n_rows):
    """
    Choose random grid dimensions in 5mm squares (#4).

    Real ECGs have variable grid coverage — the grid rarely fills the entire page
    edge-to-edge. This randomizes width/height in complete 5mm squares,
    horizontal alignment, and vertical alignment.

    Args:
        page_size: "a4" or "us_letter"
        format_choice: ECG format string
        n_rows: Number of lead rows in the layout

    Returns:
        dict or None: {"squares_x", "squares_y", "align_x", "margin_left_mm",
                        "align_y", "margin_top_mm"}
                      or None for default (fill available area)
    """
    # 40% chance of default behavior (grid fills available area as before)
    if random.random() < 0.40:
        return None

    if page_size == "us_letter":
        max_x, max_y = 55, 39
    else:  # a4
        max_x, max_y = 59, 37

    # Width: 80% integer squares, 10% full width, 10% half-square multiple
    roll = random.random()
    if roll < 0.10:
        # Full width — fill page
        squares_x = max_x
    elif roll < 0.20:
        # Half-square multiple
        squares_x = random.randint(52, max_x)
        if random.random() < 0.5:
            squares_x -= 0.5  # not used as int, but kept for the concept
            squares_x = int(squares_x)  # floor to integer for simplicity
    else:
        # Integer number of squares
        squares_x = random.randint(52, max_x)

    # Height: minimum depends on format (enough for all lead rows + pulse headroom)
    # Use 15mm per row (realistic minimum with pulse space) instead of 10mm
    min_y = max(24, int((10 + n_rows * 15 + 10) / 5))
    min_y = min(min_y, max_y)  # Clamp to page height
    squares_y = random.randint(min_y, max_y)

    # Horizontal alignment: 80% centered, 20% left-aligned with random margin
    if random.random() < 0.80:
        align_x = "centered"
        margin_left_mm = 0  # computed from centering
    else:
        align_x = "left"
        margin_left_mm = random.choice([5, 10, 15, 20])

    # Vertical alignment: 60% centered, 20% top-aligned, 20% bottom-aligned
    roll_y = random.random()
    if roll_y < 0.60:
        align_y = "centered"
        margin_top_mm = 0
    elif roll_y < 0.80:
        align_y = "top"
        margin_top_mm = random.choice([5, 10, 15, 20])
    else:
        align_y = "bottom"
        margin_top_mm = 0  # margin_top_mm unused for bottom alignment

    return {
        "squares_x": int(squares_x),
        "squares_y": int(squares_y),
        "align_x": align_x,
        "margin_left_mm": margin_left_mm,
        "align_y": align_y,
        "margin_top_mm": margin_top_mm,
    }


def choose_random_grid_style():
    """
    Choose random grid style for major/minor lines

    Returns:
        tuple: (major_line_style, minor_line_style) - "solid"/"dashed"/"dotted"/"points"
    """
    # Calibrated: 107 JoCovid ECGs — solid lines dominant, 7% dot grid (GE MAC style)
    styles = [
        ("solid", "solid"),       # Solid major + solid minor (dominant)
        ("solid", "dashed"),      # Solid major + dashed minor (rare)
        ("dashed", "solid"),      # Dashed major + solid minor (rare)
        ("dashed", "dashed"),     # Dashed both (very rare)
        ("dots", "dots"),         # Dot grid — GE MAC style (#42)
    ]
    weights = [78, 5, 5, 5, 7]
    return random.choices(styles, weights=weights)[0]


def choose_random_grid_line_params():
    """
    Choose random grid line widths, alpha values, and antialiasing (#55, #58, #91).

    Anti-aliasing is determined by pixel thickness:
    - Even thickness (2px, 4px): AA applied (50% edge pixels each side)
    - Odd thickness (1px, 3px): no AA (crisp pixel-perfect lines)
    At 304.8 DPI, 1pt = 4.233px, so 1px ≈ 0.236pt, 3px ≈ 0.709pt.

    Returns:
        dict: {"minor_linewidth": float, "minor_alpha": float,
               "major_linewidth": float, "major_alpha": float,
               "antialiased": bool}
    """
    px_per_pt = 304.8 / 72.0

    # 15% chance of PTB-XL style (very faint grid)
    if random.random() < 0.15:
        params = {
            "minor_linewidth": random.uniform(0.10, 0.18),
            "minor_alpha": random.uniform(0.15, 0.30),
            "major_linewidth": random.uniform(0.30, 0.50),
            "major_alpha": random.uniform(0.40, 0.65),
        }
    else:
        # 85% standard — randomize within normal range
        params = {
            "minor_linewidth": random.uniform(0.15, 0.30),
            "minor_alpha": random.uniform(0.30, 0.50),
            "major_linewidth": random.uniform(0.45, 0.80),
            "major_alpha": random.uniform(0.70, 1.00),
        }

    # Snap to integer pixel widths (1, 2, 3...)
    # Minor lines: always odd (1px or 3px) for crisp rendering
    for key in ("minor_linewidth",):
        px = params[key] * px_per_pt
        odd_px = max(1, int(round((px - 1) / 2)) * 2 + 1)
        params[key] = odd_px / px_per_pt

    # Major lines: round to nearest integer pixel (odd = crisp, even = AA)
    major_px = max(1, int(round(params["major_linewidth"] * px_per_pt)))
    params["major_linewidth"] = major_px / px_per_pt

    # AA is enabled when any line has even pixel thickness
    params["antialiased"] = (major_px % 2 == 0)
    return params


def choose_random_double_grid():
    """
    Choose whether to render a double grid (super-major lines overlaid).

    Some real ECG machines print a three-level grid hierarchy:
      1. Minor lines every 1 mm (thin, faint)
      2. Major lines every 5 mm (medium)
      3. Super-major lines every N-th major line (thick, bold)

    The super-major lines appear at every 2nd (10 mm) or 3rd (15 mm) major
    grid line, creating the characteristic heavy ruling visible on many
    hospital ECG printouts (see SCAD5-stres.jpg reference).

    15% probability. When enabled:
    - ``every_n``: super-major every 2nd (10 mm), 3rd (15 mm), 4th (20 mm) or 5th (25 mm) major line
    - Slightly darker/shifted color
    - Heavier linewidth (1.0-1.8 vs standard 0.6)
    - Optional alpha

    Returns:
        dict or None: None if single grid, else {"every_n": int,
            "color_shift": int, "major_linewidth": float, "major_alpha": float}
    """
    if random.random() >= 0.15:
        return None

    # Every 2nd (10mm), 3rd (15mm), or 4th (20mm) major line
    every_n = random.choices([2, 3, 4, 5], weights=[45, 20, 15, 20])[0]
    # Color shift: positive = darker overlay, negative = lighter
    color_shift = random.choice([-40, -30, -20, 20, 30, 40, 50, 60])
    major_linewidth = random.choice([1.0, 1.2, 1.4, 1.6, 1.8])
    major_alpha = random.choice([0.5, 0.6, 0.7, 0.8, 0.9, 1.0])

    return {
        "every_n": every_n,
        "color_shift": color_shift,
        "major_linewidth": major_linewidth,
        "major_alpha": major_alpha,
    }


def choose_random_subscript_style():
    """
    Choose whether lead names use Unicode subscript indices (#60).

    Some ECG machines (and typeset reports) render lead names like V₁, V₂
    instead of V1, V2. When enabled, digit characters in lead labels are
    replaced with their Unicode subscript equivalents.

    Returns:
        bool: True ~15% of the time
    """
    return random.random() < 0.15


def choose_random_bi_paper():
    """
    Choose whether to render a bi-paper composite format (#45).

    ~4% of real hospital ECGs show two physically different printouts
    composited into one scan: top portion on white/plain thermal paper
    (no grid), bottom portion on colored grid paper. Observed in
    JoCovid dataset (ECG_00089, ECG_00228, ECG_00576, etc.).

    When enabled, the grid is drawn only on the bottom portion of the page,
    with a visible seam/shadow line at the split point and a subtle paper
    tint on the grid section.

    Returns:
        dict or None: None if normal, else config dict with split parameters
    """
    if random.random() >= 0.04:
        return None

    # Split position: how far down (from top) the split occurs
    # Typically ~35-50% from top (limb leads on top, precordials on bottom)
    split_fraction = random.uniform(0.30, 0.50)

    # Paper tint for the grid section (bottom) — light warm tones
    tints = [
        (255, 240, 235),  # Light pink/salmon
        (255, 245, 238),  # Seashell
        (252, 235, 225),  # Warm cream
        (248, 232, 228),  # Rose tint
        (255, 243, 240),  # Pale pink
    ]
    paper_tint = random.choice(tints)

    # Seam characteristics
    seam_width_px = random.uniform(2, 6)  # Shadow/overlap line thickness
    seam_overlap_px = random.uniform(0, 15)  # Slight overlap between papers

    return {
        "split_fraction": split_fraction,
        "paper_tint": paper_tint,
        "seam_width_px": seam_width_px,
        "seam_overlap_px": seam_overlap_px,
    }


def _apply_color_delta(hex_color, max_delta=25):
    """
    Apply a random RGB delta to a hex color for subtle shade variation.

    Each channel is independently shifted by a uniform random value
    in [-max_delta, +max_delta], clamped to [0, 255].

    Args:
        hex_color (str): Base color as "#RRGGBB"
        max_delta (int): Maximum per-channel shift (default 25)

    Returns:
        str: Shifted hex color "#RRGGBB"
    """
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    r = max(0, min(255, r + random.randint(-max_delta, max_delta)))
    g = max(0, min(255, g + random.randint(-max_delta, max_delta)))
    b = max(0, min(255, b + random.randint(-max_delta, max_delta)))
    return f"#{r:02x}{g:02x}{b:02x}"


def choose_random_grid_color():
    """
    Choose random grid color with a subtle random shade delta.

    First picks a base color, then applies a per-channel RGB shift
    (±25) so that no two images share the exact same grid tint.

    Returns:
        str: Hex color code
    """
    # Calibrated against 107 JoCovid hospital ECGs (domain gap analysis 2026-03-20)
    # Red/pink dominant (~65%), cream/beige (~10%), gray (~4%), black (~13%), orange (~5%)
    # Green/blue: rare but exist on some international machines → kept at low weight
    colors = ["#cc0000",       # Red (dominant real color)
              "#d44040",       # Light red / salmon
              "#ffc0cb",       # Pink
              "#ff6600",       # Orange (rare, some older machines)
              "#c8a882",       # Cream / beige (faint warm grid)
              "#b0a090",       # Beige / aged paper grid
              "#808080",       # Gray
              "#000000",       # Black (digital printouts)
              "#009900",       # Green (rare, some Asian/SA machines)
              "#0000cc",       # Blue (very rare)
              ]
    weights = [33, 14, 9, 5, 10, 5, 5, 14, 3, 2]
    base = random.choices(colors, weights=weights)[0]
    # Smaller delta for muted colors to avoid unrealistic tints
    delta = 15 if base in ("#c8a882", "#b0a090", "#808080") else 25
    return _apply_color_delta(base, max_delta=delta)


def choose_random_number_pulse(format_choice):
    """
    Choose number and arrangement of reference pulse marks

    Args:
        format_choice (str): ECG format

    Returns:
        str or None: Pulse configuration - None, "one", "one_column", "two_columns"
    """
    if format_choice in ["6x2", "4x2"]:
        pulse = [None, "one", "one_column", "two_columns"]
        weights = [20, 14, 56, 10]
        return random.choices(pulse, weights=weights)[0]
    else:
        pulse = [None, "one", "one_column"]
        weights = [20, 16, 64]
        return random.choices(pulse, weights=weights)[0]


def choose_random_pulse_hor_pos(format_choice, num_pulse, horizontal_spacing_mm=0):
    """
    Choose horizontal position of pulse marks

    When horizontal spacing is present (>0), middle position is available for all
    formats (#8), not just 6x2.

    Args:
        format_choice (str): ECG format
        num_pulse (str or None): Pulse configuration
        horizontal_spacing_mm (float): Horizontal spacing between columns in mm

    Returns:
        str or None: Horizontal position - "left", "middle", "right", or None
    """
    if format_choice in ["6x2", "4x2"]:
        if num_pulse in ["one", "one_column"]:
            pulse = ["left", "middle", "right"]
            weights = [50, 25, 25]
            return random.choices(pulse, weights=weights)[0]
        elif not num_pulse:
            return None
        else:
            pulse = ["left", "right"]
            weights = [50, 50]
            return random.choices(pulse, weights=weights)[0]
    else:
        if not num_pulse:
            return None
        # When horizontal spacing exists, allow middle position (#8)
        if horizontal_spacing_mm > 0 and num_pulse in ["one", "one_column"]:
            pulse = ["left", "middle", "right"]
            weights = [45, 15, 40]
            return random.choices(pulse, weights=weights)[0]
        else:
            pulse = ["left", "right"]
            weights = [50, 50]
            return random.choices(pulse, weights=weights)[0]


def choose_random_pulse_vert_position(format_choice, num_pulse):
    """
    Choose vertical position of pulse mark relative to leads

    Args:
        format_choice (str): ECG format
        num_pulse (str or None): Pulse configuration

    Returns:
        int or None: Row index for pulse position (1-12 depending on format)
    """
    
    if num_pulse == "one":
        if format_choice == "3x4":
            pulse = [1, 2, 3]
            weights = [1, 1, 1]
        elif format_choice == "3x4+1":
            pulse = [1, 2, 3, 4]
            weights = [5, 5, 40, 50]
        elif format_choice == "3x4+2":
            pulse = [1, 2, 3, 4, 5]
            weights = [1, 1, 1, 1, 1]
        elif format_choice in ["3x4+3", "6x2"]:
            pulse = [1, 2, 3, 4, 5, 6]
            weights = [1, 1, 1, 1, 1, 2]
        elif format_choice == "4x2":
            pulse = [1, 2, 3, 4]
            weights = [1, 1, 1, 2]
        elif format_choice == "4x2+1":
            pulse = [1, 2, 3, 4, 5]
            weights = [5, 5, 5, 15, 70]
        elif format_choice == "6x2+1":
            pulse = [1, 2, 3, 4, 5, 6, 7]
            weights = [5, 5, 5, 5, 5, 15, 60]
        else:
            pulse = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
            weights = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2]
        return random.choices(pulse, weights=weights)[0]
    else:
        return None
    

def is_there_pulse_and_signal_space(num_pulse):
    """
    Determine if there should be spacing between pulse mark and signal

    Args:
        num_pulse (str or None): Pulse configuration

    Returns:
        bool or None: True for spacing (20%), False for no spacing (80%), None if no pulse
    """
    if num_pulse:
        pulse = [True, False]
        weights = [20, 80]
        return random.choices(pulse, weights=weights)[0]
    else:
        return None


def choose_random_pulse_shift(num_pulse):
    """
    Choose random vertical shift for pulse mark

    Args:
        num_pulse (str or None): Pulse configuration

    Returns:
        int or None: Shift in millimeters (-22 to +13mm), or None if no pulse
    """
    if num_pulse:
        shift = [random.randint(-22,-10), random.randint(-9,-1), 0, random.randint(1,5), random.randint(6,13)]
        weights = [5, 40, 25, 25, 5]
        return random.choices(shift, weights=weights)[0]
    else:
        return None


def choose_random_pulse_shape(speed_mm_per_s=25):
    """
    Choose random calibration pulse shape.

    Each shape is defined as (rise_s, plateau_s, fall_s) where duration is in seconds.
    Based on real ECG machine calibration pulse variations.

    Args:
        speed_mm_per_s: Paper speed (affects shape 0 at 12.5mm/s)

    Returns:
        tuple: (rise_s, plateau_s, fall_s) pulse shape definition
    """
    # Standard shapes (rise, plateau, fall) in seconds
    # Based on proportions in units of 0.2s as specified in issue #5
    unit = 0.2  # Base unit
    shapes = [
        (1*unit, 1*unit, 1*unit),       # 0.2-0.2-0.2 standard
        (0.1*unit, 1*unit, 0.1*unit),   # 0.02-0.2-0.02 sharp
        (0.2*unit, 0.6*unit, 0.2*unit), # 0.04-0.12-0.04
        (0.2*unit, 0.6*unit, 1*unit),   # 0.04-0.12-0.2 asymmetric
        (0*unit, 1*unit, 0*unit),       # 0-0.2-0 instant (no rise/fall)
        (0.2*unit, 0.6*unit, 0.1*unit), # 0.04-0.12-0.02
        (0.2*unit, 1*unit, 0.2*unit),   # 0.04-0.2-0.04
        (0.1*unit, 0.8*unit, 0.1*unit), # 0.02-0.16-0.02
        (0.5*unit, 1*unit, 0.5*unit),   # 0.1-0.2-0.1
        (0.2*unit, 1*unit, 0.2*unit),   # 0.04-0.2-0.04 (same as 6, variant)
    ]

    # Exception: shape 0 at speed 12.5mm/s uses longer proportions
    if speed_mm_per_s == 12.5:
        shapes[0] = (0.5*unit, 2*unit, 0.5*unit)

    return random.choice(shapes)


def choose_random_pulse_color():
    """
    Choose pulse color: 85% same as signal, 15% different dark color.

    Returns:
        str or None: Color string, or None meaning "use signal color"
    """
    if random.random() < 0.85:
        return None  # Same as signal color
    dark_colors = ['black', '#333333', '#1a1a1a', '#000080', '#800000',
                   '#004400', '#2f2f2f', '#1b1b1b']
    return random.choice(dark_colors)


def should_apply_pulse_lowpass():
    """
    Determine if pulse should have IIR lowpass applied (10% chance).

    Returns:
        bool: True to apply 40Hz order-1 IIR lowpass (no forward-backward)
    """
    return random.random() < 0.10


def choose_random_text_color():
    """
    Choose random color for lead label text (90% black)

    Returns:
        str: Color name
    """
    colors = ["black", "blue", "red", "green"]
    weights = [90, 5, 2.5, 2.5]
    return random.choices(colors, weights=weights)[0]


def choose_random_vert_pos_text():
    """
    Choose vertical position of lead label text relative to signal (#61)

    Returns:
        int: Vertical offset in millimeters (-15 to +20mm)
    """
    height_mm = [random.randint(-10,-5), random.randint(-4,0), random.randint(1,6), random.randint(7,12), random.randint(13,20)]
    weights = [5, 15, 50, 22, 8]
    return random.choices(height_mm, weights=weights)[0]


def choose_random_text_spacing():
    """
    Choose horizontal spacing of lead label text relative to signal

    Returns:
        int or str: Spacing in millimeters or "centered" (80% at 0mm)
    """
    spacing_mm = [-10, -5, 0, 10, "centered"]
    weights = [5, 5, 80, 5, 5]
    return random.choices(spacing_mm, weights=weights)[0]


def choose_random_text_size():
    """
    Choose lead label text size (#64 — increased to match real ECGs)

    Returns:
        float: Text size in millimeters
    """
    size_mm = [1.5, 2, 2.5, 3, 3.5, 4, 5]
    weights = [2, 15, 30, 30, 12, 8, 3]
    return random.choices(size_mm, weights=weights)[0]


def choose_random_lead_nomenclatures():
    """
    Choose random lead nomenclature combination

    Returns:
        dict: Nomenclature for peripheral and precordial leads (92.5% both standard)
    """
    combinations = [
        {"peripheriques": "standard", "precordiales": "standard"},     
        {"peripheriques": "standard", "precordiales": "alternative"},  
        {"peripheriques": "alternative", "precordiales": "standard"},  
        {"peripheriques": "alternative", "precordiales": "alternative"} 
    ]
    weights = [92.5, 2.5, 2.5, 2.5]
    return random.choices(combinations, weights=weights)[0]


def should_add_medical_text_on_full_grid():
    """
    Determine if medical text should be added for full_grid ECGs (90% probability)

    Returns:
        bool: True to add medical text (top + bottom zones)
    """
    return random.random() < 0.9


def should_add_black_square():
    """
    Determine if black square should be added (85% probability)

    Returns:
        bool: True to add black calibration square in bottom-left
    """
    return random.random() < 0.85


def choose_random_black_squares(page_width_mm, page_height_mm):
    """
    Generate black anonymization/timing squares (#53).

    36% of real hospital ECGs have black squares — used for calibration marks,
    anonymization blocks, or timing references. Real ECGs show variable count,
    size, and position.

    Types:
    - calibration: small 2x2 grid-square mark at bottom-left (classic)
    - anonymization: larger rectangle covering text/header areas
    - timing: small squares at page edges or between leads

    Returns:
        list of dict: each with {type, x_mm, y_mm, w_mm, h_mm}, or empty list
    """
    # 20% chance of no black squares at all (was 40%, reduced after merging legacy calibration)
    if random.random() < 0.20:
        return []

    squares = []

    # Decide how many (weighted: 1=60%, 2=25%, 3=15%)
    n = random.choices([1, 2, 3], weights=[60, 25, 15])[0]

    for _ in range(n):
        sq_type = random.choices(
            ["calibration", "anonymization", "timing"],
            weights=[50, 30, 20]
        )[0]

        if sq_type == "calibration":
            # Classic 2x2 grid-square calibration mark — bottom area
            size = random.choice([5, 10, 10, 10, 15])  # mm, mostly 10mm
            x = random.uniform(5, 30)  # left side, 5-30mm from edge
            y = random.uniform(0, 10)  # near bottom
            squares.append({
                "type": "calibration",
                "x_mm": x, "y_mm": y,
                "w_mm": float(size), "h_mm": float(size),
            })

        elif sq_type == "anonymization":
            # Larger rectangle covering text — top or bottom area
            w = random.uniform(20, 80)
            h = random.uniform(8, 25)
            if random.random() < 0.6:
                # Top area (covering patient name/ID)
                x = random.uniform(0, page_width_mm - w)
                y = page_height_mm - h - random.uniform(0, 15)
            else:
                # Bottom area (covering footer text)
                x = random.uniform(0, page_width_mm - w)
                y = random.uniform(0, 15)
            squares.append({
                "type": "anonymization",
                "x_mm": x, "y_mm": y,
                "w_mm": w, "h_mm": h,
            })

        else:  # timing
            # Small square at various positions
            size = random.choice([3, 5, 5, 8])
            x = random.uniform(0, page_width_mm - size)
            y = random.uniform(0, page_height_mm - size)
            squares.append({
                "type": "timing",
                "x_mm": x, "y_mm": y,
                "w_mm": float(size), "h_mm": float(size),
            })

    return squares


def choose_random_top_black_line():
    """
    Choose parameters for an optional black horizontal line above the grid (CFA1 style).

    Only relevant for with_text_zones layout (bordered grid with margins).
    20% probability of adding the line. When present:
    - Thickness: 2, 3, 4, or 5 pixels (equal probability)
    - Offset above grid: 1 to 20 mm (uniform) — minimum 1 mm to stay off the grid

    Returns:
        dict or None: {"thickness_px": int, "offset_mm": float} or None
    """
    if random.random() >= 0.20:
        return None
    return {
        "thickness_px": random.choice([2, 3, 4, 5]),
        "offset_mm": random.uniform(1, 20),
    }


def choose_random_signal_line_width():
    """
    Choose random signal line width in pixels (at 304.8 DPI, 12 px/mm).

    Three levels calibrated against real ECG printouts (~0.3-0.5 mm):
      - 2 px = 0.17 mm — thin (fine pen / high-res digital)
      - 4 px = 0.33 mm — normal (matches typical thermal printer)
      - 6 px = 0.50 mm — thick (worn pen / bold printout)

    Returns:
        int: Line width (2, 4, or 6 px) with weights [20, 60, 20]
    """
    return random.choices([2, 4, 6], weights=[20, 60, 20])[0]


def choose_random_signal_antialiased():
    """
    Choose whether signal rendering uses anti-aliasing.

    Returns:
        bool: True (20%) for anti-aliased, False (80%) for crisp pixel-aligned
    """
    return random.random() < 0.20


def choose_random_speed(format_choice):
    """
    Choose random paper speed in mm/s with format-dependent constraints

    12.5 mm/s is only allowed for 6x2 and 3x4 layouts (at 12.5 mm/s,
    a 2.5s column is only 31.25mm wide — insufficient for layouts with
    extra rhythm strips or many columns).

    Args:
        format_choice (str): ECG format

    Returns:
        float: Paper speed in mm/s
    """
    if format_choice in ["6x2", "3x4", "4x2"]:
        speeds = [12.5, 25, 50, 100, 200]
        weights = [5, 80, 5, 3, 2]
    else:
        # 12.5 mm/s not allowed — its 5% is redistributed to 25 mm/s
        speeds = [25, 50, 100, 200]
        weights = [85, 5, 3, 2]
    return random.choices(speeds, weights=weights)[0]


def choose_random_gain():
    """
    Choose random amplitude gain in mm/mV

    Higher gain (20 mm/mV) doubles vertical amplitude, increasing
    inter-row signal crossings. Lower gain (5 mm/mV) halves it.

    Returns:
        int: Amplitude gain in mm/mV
    """
    gains = [5, 10, 20]
    weights = [5, 75, 20]
    return random.choices(gains, weights=weights)[0]


def is_there_added_noise():
    """
    Determine if noise should be added to signals (20% total probability)

    Returns:
        str or None: "low_frequency" (8%), "powerline" (7%),
                     "high_frequency" (5%), or None (80%)
    """
    noise = [None, "low_frequency", "powerline", "high_frequency"]
    weights = [80, 8, 7, 5]
    return random.choices(noise, weights=weights)[0]


def choose_random_vertical_spacing(format_choice=None):
    """
    Choose random vertical spacing between signals

    Args:
        format_choice (str, optional): ECG format to apply spacing limits

    Returns:
        int: Spacing in millimeters (10-35mm, limited by format)
    """
    spacings_mm = [10, 15, 20, 25, 30, 35]
    weights = [7, 4, 6, 71, 5, 7]

    # Apply limits based on format
    if format_choice == "3x4_paramedic":
        # Fixed 20mm for paramedic (fits in 64.6mm signal area)
        return 20
    elif format_choice and format_choice.endswith("_cardiofax"):
        # Thermal 63mm: tight spacing (3 rows in ~55mm usable)
        return random.choices([15, 18], weights=[60, 40])[0]
    elif format_choice == "12x1":
        # Limit to 15mm maximum
        spacings_mm = [10, 15]
        weights = [7, 4]
    elif format_choice == "6x2+1":
        # Limit to 25mm maximum
        spacings_mm = [10, 15, 20, 25]
        weights = [7, 4, 6, 71]
    return random.choices(spacings_mm, weights=weights)[0]


def choose_random_variable_channel_spacing(format_choice, n_channel_rows,
                                            grid_height_mm):
    """
    Choose variable per-row vertical spacing between ECG channels (#12).

    Uses a square-root uniform distribution: spacing ~ U(sqrt(min), sqrt(max))^2.
    This makes small spacings (e.g. 1 cm) roughly 2-3x more probable than large ones
    (e.g. 4-8 cm), encouraging signal crossings and reducing position bias.

    50% of the time the spacing is rounded to the nearest 0.5 cm (grid-aligned).
    If the rounded value fits with rounded margins, it is kept; otherwise raw.

    Args:
        format_choice (str): ECG format (e.g. "3x4", "12x1").
        n_channel_rows (int): Number of channel rows (excluding rhythm strips).
        grid_height_mm (float): Available grid height in mm.

    Returns:
        dict or None: None to use legacy fixed spacing (30% of the time), else
            {"spacing_mm": float, "margin_top_mm": float, "margin_bottom_mm": float,
             "grid_aligned": bool}
    """
    # Paramedic and Cardiofax: always use fixed spacing
    if format_choice and (format_choice == "3x4_paramedic" or format_choice.endswith("_cardiofax")):
        return None

    # 30% of the time, keep legacy fixed spacing behaviour
    if random.random() < 0.30:
        return None

    min_spacing_mm = 8.0   # 0.8 cm minimum
    max_spacing_mm = grid_height_mm / (n_channel_rows + 1)

    # Clamp to reasonable bounds
    max_spacing_mm = max(max_spacing_mm, min_spacing_mm + 1)

    # Square-root-uniform sampling: sample u ~ U(sqrt(min), sqrt(max)), spacing = u^2
    sqrt_min = min_spacing_mm ** 0.5
    sqrt_max = max_spacing_mm ** 0.5
    u = random.uniform(sqrt_min, sqrt_max)
    spacing_mm = u * u

    # Clamp
    spacing_mm = max(min_spacing_mm, min(spacing_mm, max_spacing_mm))

    # Minimum margins
    min_margin_mm = 8.0  # 0.8 cm

    # Random margins (also sqrt-uniform, favouring small)
    remaining_mm = grid_height_mm - n_channel_rows * spacing_mm
    if remaining_mm < 2 * min_margin_mm:
        # Not enough room — shrink spacing to fit
        spacing_mm = (grid_height_mm - 2 * min_margin_mm) / n_channel_rows
        spacing_mm = max(min_spacing_mm, spacing_mm)
        remaining_mm = grid_height_mm - n_channel_rows * spacing_mm

    # Split remaining space into top/bottom margins randomly
    if remaining_mm > 2 * min_margin_mm:
        top_frac = random.uniform(0.2, 0.8)
        margin_top_mm = max(min_margin_mm, remaining_mm * top_frac)
        margin_bottom_mm = max(min_margin_mm, remaining_mm - margin_top_mm)
    else:
        margin_top_mm = min_margin_mm
        margin_bottom_mm = min_margin_mm

    # 50% chance: try to round to 0.5 cm (grid-aligned)
    grid_aligned = False
    if random.random() < 0.50:
        rounded_spacing = round(spacing_mm * 2) / 2  # nearest 0.5 mm... actually 5mm
        # The spec says "round to 0.5cm" = round to 5mm
        rounded_spacing = round(spacing_mm / 5) * 5
        rounded_top = round(margin_top_mm / 5) * 5
        rounded_bottom = round(margin_bottom_mm / 5) * 5
        rounded_total = n_channel_rows * rounded_spacing + rounded_top + rounded_bottom
        if (rounded_spacing >= min_spacing_mm and
                rounded_top >= min_margin_mm and
                rounded_bottom >= min_margin_mm and
                rounded_total <= grid_height_mm):
            spacing_mm = rounded_spacing
            margin_top_mm = rounded_top
            margin_bottom_mm = rounded_bottom
            grid_aligned = True

    # For 12 channel rows: need >= 26 squares (130mm) for grid-aligned leads
    # If grid is smaller, never grid-align
    if n_channel_rows >= 12 and grid_height_mm < 130:
        grid_aligned = False

    return {
        "spacing_mm": round(spacing_mm, 2),
        "margin_top_mm": round(margin_top_mm, 2),
        "margin_bottom_mm": round(margin_bottom_mm, 2),
        "grid_aligned": grid_aligned,
    }


def choose_random_column_duration_mode(format_choice, horizontal_spacing_mm,
                                       pulse_width_mm=0, rp_num=None):
    """
    Choose how column durations and horizontal spacing interact (#8).

    Real ECG machines vary: some dedicate 10 s entirely to signals, some count
    the space between columns as part of the total, and some machines print
    columns of slightly different duration.

    Args:
        format_choice (str): ECG format (e.g. "3x4", "6x2").
        horizontal_spacing_mm (float): Current horizontal spacing in mm.
        pulse_width_mm (float): Calibration pulse width in mm.
        rp_num (str|None): Reference pulse number ("one", "one_column", etc.).

    Returns:
        dict: {"mode": str, "duration_fraction": float|None}
            mode is one of:
              - "standard"      : total signal duration = 10 s (default)
              - "with_calib"    : duration + calibration pulses = 10 s
              - "space_excluded": spacing does not count in total (signals = 10 s)
              - "space_included": spacing counts (signals < 10 s to fit)
              - "random_short"  : each column randomly 80-100% of normal duration
            duration_fraction is only set for "random_short" (0.80-1.00).
    """
    # Single-column or multi-page formats: always standard
    if format_choice in ["12x1", "6x1;6x1"]:
        return {"mode": "standard", "duration_fraction": None}

    # with_calib requires one_column pulse type and pulse <= 10mm
    allow_with_calib = (rp_num == "one_column" and pulse_width_mm <= 10.0)

    if horizontal_spacing_mm == 0:
        # No horizontal spacing
        if allow_with_calib:
            modes = ["standard", "with_calib"]
            weights = [90, 10]
        else:
            modes = ["standard"]
            weights = [100]
        mode = random.choices(modes, weights=weights)[0]
        return {"mode": mode, "duration_fraction": None}
    else:
        # With horizontal spacing
        modes = ["space_excluded", "space_included", "random_short"]
        weights = [60, 20, 20]
        mode = random.choices(modes, weights=weights)[0]
        frac = None
        if mode == "random_short":
            frac = random.uniform(0.80, 1.00)
        return {"mode": mode, "duration_fraction": frac}


def choose_random_vertical_offset_mm():
    """
    Choose random vertical offset range for lead rows (30% probability).

    When enabled, each row gets a uniform random offset in [-max_mm, +max_mm].
    Typical range is ±1 to ±2 mm (subtle but visible shift).
    Not compatible with min_max_spacing (disabled at render time).

    Returns:
        float: Maximum offset in mm (0 means disabled)
    """
    if random.random() < 0.70:
        return 0.0
    return random.choice([1.0, 1.5, 2.0])


def choose_random_per_lead_offsets():
    """
    Choose random per-lead vertical offsets (25% probability).

    When enabled, 1-6 individual leads are each shifted by an independent
    offset.  This models per-lead misalignment common in real ECG printouts
    (pen/thermal-head drift, paper feed jitter).

    Two regimes:
    - Subtle (96%): ±0.5-2 mm — barely noticeable misalignment
    - Dramatic (4%): one lead shifted 3-10 mm — simulates a recording
      artefact (replaces old ``one_lead_shift`` special spacing)

    Stacks with the existing per-row offset: total = row_offset + lead_offset.
    Not compatible with min_max_spacing (disabled at render time).

    Returns:
        dict or None: {lead_index: offset_mm, ...} or None if disabled.
            lead_index is 0-based among the 12 standard leads.
    """
    if random.random() >= 0.25:
        return None

    # Dramatic single-lead shift (≈4% of the 25% = ~1% overall, matches old one_lead_shift)
    if random.random() < 0.04:
        idx = random.randint(0, 11)
        shift = random.randint(3, 10) * random.choice([-1, 1])
        return {idx: float(shift)}

    # Subtle multi-lead shift
    n_leads = random.choices([1, 2, 3, 4, 5, 6], weights=[20, 30, 25, 15, 7, 3])[0]
    indices = random.sample(range(12), n_leads)
    max_mm = random.choice([0.5, 1.0, 1.5, 2.0])
    return {idx: random.uniform(-max_mm, max_mm) for idx in indices}


def choose_special_spacing(format_choice):
    """
    Determine if special spacing should be applied

    Special spacing types (mutually exclusive):
    - min_max_spacing: Aligns signal maxima across rows (5% for formats without extra leads)
    - column_shift: Shifts entire column vertically (1% for 3x4/6x2 only)
    - per_lead_offsets: Independent offset per lead (25%, 1-6 leads, replaces one_lead_shift)

    Args:
        format_choice (str): ECG format

    Returns:
        dict or None: Special spacing configuration with type and parameters, or None
    """
    # Disable for multi-page formats (detected by semicolon in format name)
    if ";" in format_choice:
        return None

    has_extra_leads = format_choice in ["3x4+1", "3x4+2", "3x4+3", "6x2+1", "4x2+1"]
    rand_value = random.random()

    if not has_extra_leads:
        if rand_value < 0.05:  # 5%
            spacing_mm = random.randint(0, 10)
            return {
                "type": "min_max_spacing",
                "spacing_mm": spacing_mm
            }
        elif rand_value < 0.06:  # 1%
            if format_choice in ["3x4", "6x2", "4x2"]:
                n_cols = 4 if format_choice == "3x4" else 2
                return {
                    "type": "column_shift",
                    "column_index": random.randint(0, n_cols - 1),
                    "shift_mm": random.randint(3, 10),
                    "direction": random.choice(["up", "down"])
                }

    # per_lead_offsets: 25% probability (all formats)
    offsets = choose_random_per_lead_offsets()
    if offsets is not None:
        return {
            "type": "per_lead_offsets",
            "offsets": offsets
        }

    return None














def choose_random_speed_gain_text_config():
    """
    Choose random configuration for speed/gain text display.

    Returns:
        dict with keys:
            show_speed_gain: bool - whether to show speed/gain text (90% yes)
            position: str - "bottom" (80%) or "top" (20%)
            x_offset_mm: float - random horizontal offset (0-30mm from default)
            text_format: str - format template key for text variation
    """
    # 10% chance of no text at all
    show = random.random() >= 0.10

    # Position: 80% bottom, 20% top
    position = "bottom" if random.random() < 0.80 else "top"

    # Random X offset (up to 30mm from default position)
    x_offset_mm = random.uniform(0, 30)

    # Text format: various styles seen on real ECG machines
    formats = [
        # Full format with Hz
        "full_with_hz",         # "25mm/s  10mm/mV  40Hz"
        "full_with_hz",         # duplicate for higher weight
        # Compact: just speed and gain
        "compact",              # "25 mm/s  10 mm/mV"
        "compact",              # duplicate for higher weight
        "compact_no_space",     # "25mm/s 10mm/mV"
        # Abbreviated French
        "french_abbreviated",   # "Vit. : 25 mm/s  Gain : 10 mm/mV"
        # Full French
        "french_full",          # "Vitesse : 25 mm/s  Gain : 10 mm/mV"
        # English labels
        "english_labeled",      # "Speed: 25 mm/s  Gain: 10 mm/mV"
        # Minimal (just values)
        "minimal_speed_only",   # "25 mm/s"
        "minimal_both",         # "25mm/s 10mm/mV"
        # German
        "german",               # "Geschw.: 25 mm/s  Verst.: 10 mm/mV"
        # Spanish
        "spanish",              # "Vel.: 25 mm/s  Gan.: 10 mm/mV"
        # Italian
        "italian",              # "Vel.: 25 mm/s  Guad.: 10 mm/mV"
        # Portuguese
        "portuguese",           # "Vel.: 25 mm/s  Ganho: 10 mm/mV"
    ]
    text_format = random.choice(formats)

    return {
        "show_speed_gain": show,
        "speed_gain_position": position,
        "speed_gain_x_offset_mm": x_offset_mm,
        "speed_gain_text_format": text_format,
    }


def _format_speed_gain_text(speed_mm_per_s, gain_mm_per_mV, text_format):
    """Format speed/gain text according to the given format template.

    Returns:
        str: Formatted speed/gain text
    """
    speed_val = int(speed_mm_per_s) if speed_mm_per_s == int(speed_mm_per_s) else speed_mm_per_s
    gain_val = int(gain_mm_per_mV)

    # Randomly include or exclude spacing around values
    sp = " " if random.random() < 0.5 else ""

    formats = {
        "full_with_hz": f"{speed_val}{sp}mm/s        {gain_val}{sp}mm/mV        40Hz",
        "compact": f"{speed_val} mm/s   {gain_val} mm/mV",
        "compact_no_space": f"{speed_val}mm/s {gain_val}mm/mV",
        "french_abbreviated": f"Vit. : {speed_val} mm/s   Gain : {gain_val} mm/mV",
        "french_full": f"Vitesse : {speed_val} mm/s   Gain : {gain_val} mm/mV",
        "english_labeled": f"Speed: {speed_val} mm/s   Gain: {gain_val} mm/mV",
        "minimal_speed_only": f"{speed_val} mm/s",
        "minimal_both": f"{speed_val}mm/s {gain_val}mm/mV",
        "german": f"Geschw.: {speed_val} mm/s   Verst.: {gain_val} mm/mV",
        "spanish": f"Vel.: {speed_val} mm/s   Gan.: {gain_val} mm/mV",
        "italian": f"Vel.: {speed_val} mm/s   Guad.: {gain_val} mm/mV",
        "portuguese": f"Vel.: {speed_val} mm/s   Ganho: {gain_val} mm/mV",
    }

    return formats.get(text_format, f"{speed_val}mm/s   {gain_val}mm/mV")


def generate_medical_info(speed_mm_per_s=25, gain_mm_per_mV=10, text_format="full_with_hz"):
    """
    Generate medical information for bottom/top text line

    Args:
        speed_mm_per_s (float): Paper speed in mm/s (default 25)
        gain_mm_per_mV (int): Amplitude gain in mm/mV (default 10)
        text_format (str): Format template key for text variation

    Returns:
        tuple: (scale_text, visit_text)
            - scale_text (str): ECG scale parameters
            - visit_text (str): Visit number and date
    """
    scale_text = _format_speed_gain_text(speed_mm_per_s, gain_mm_per_mV, text_format)

    # Random visit number (8 digits)
    visit_number = random.randint(10000000, 99999999)

    # Random date between 1990 and 2025
    start_year = 1990
    end_year = 2025
    year = random.randint(start_year, end_year)
    month = random.randint(1, 12)
    day = random.randint(1, 28)  # Max 28 to avoid February date issues

    date_str = f"{day:02d}/{month:02d}/{year}"
    visit_text = f"VISITE: {visit_number}   DATE: {date_str}"

    return scale_text, visit_text


def generate_patient_info():
    """
    Generate patient information for top-left text zone

    Uses Faker with 30+ locales (Latin + CJK + Arabic + Cyrillic + Greek + Hindi)
    for international name diversity. Weighted by SCRIPT_WEIGHTS from multilingual corpus.

    Returns:
        dict: Patient information with keys: nom, prenom, date_naissance, poids, taille, identifiant, lang
    """
    # Faker locales by script family (matches multilingual_medical.py weights)
    _FAKER_LOCALES = {
        'latin': [
            'fr_FR', 'es_ES', 'de_DE', 'it_IT', 'pt_PT', 'pt_BR',
            'pl_PL', 'nl_NL', 'sv_SE', 'no_NO', 'da_DK', 'fi_FI',
            'en_GB', 'en_US', 'ro_RO', 'cs_CZ', 'sk_SK', 'hu_HU',
            'hr_HR', 'sl_SI', 'et_EE', 'lv_LV', 'lt_LT',
        ],
        'latin_accented': ['tr_TR', 'fr_FR', 'de_DE', 'es_ES', 'pt_PT'],
        'cjk': ['zh_CN', 'ja_JP', 'ko_KR'],
        'arabic': ['ar_SA'],
        'cyrillic': ['ru_RU'],
        'greek': ['el_GR'],
        'hindi': ['hi_IN'],
    }

    # Pick script family using same weights as multilingual corpus
    lang, script = pick_language()

    # Get Faker locale for this script
    faker_locales = _FAKER_LOCALES.get(script, _FAKER_LOCALES['latin'])
    chosen_locale = random.choice(faker_locales)
    fake = Faker(chosen_locale)

    nom = fake.last_name().upper()
    prenom = fake.first_name()

    # Date format matches locale
    date_naissance_obj = fake.date_of_birth(minimum_age=18, maximum_age=90)
    date_fmt, _ = get_random_date(lang)  # consume RNG for consistency
    date_naissance = date_naissance_obj.strftime("%d/%m/%Y")

    # Weight (45 to 120 kg)
    poids = fake.random_int(min=45, max=120)

    # Height (150 to 195 cm)
    taille = fake.random_int(min=150, max=195)

    # Patient identifier (10 digits)
    identifiant = fake.random_int(min=1000000000, max=9999999999)

    return {
        "nom": nom,
        "prenom": prenom,
        "date_naissance": date_naissance,
        "poids": poids,
        "taille": taille,
        "identifiant": identifiant,
        "lang": lang,
    }


def generate_cardiac_measurements():
    """
    Generate cardiac measurements for middle text zone

    Returns:
        dict: Cardiac measurements with keys: freq_card, pr_interval, qrs_duration, qt_qtcb, axe_p, axe_r, axe_t
    """
    # Heart rate (50 to 120 bpm)
    freq_card = random.randint(50, 120)

    # PR interval (120 to 200 ms)
    pr_interval = random.randint(120, 200)

    # QRS duration (80 to 120 ms)
    qrs_duration = random.randint(80, 120)

    # QT/QTcB interval (350 to 450 ms)
    qt_qtcb = random.randint(350, 450)

    # P-R-T axes (degrees)
    axe_p = random.randint(-30, 90)
    axe_r = random.randint(-30, 110)
    axe_t = random.randint(0, 80)

    return {
        "freq_card": freq_card,
        "pr_interval": pr_interval,
        "qrs_duration": qrs_duration,
        "qt_qtcb": qt_qtcb,
        "axe_p": axe_p,
        "axe_r": axe_r,
        "axe_t": axe_t
    }


def generate_medical_comment(lang=None):
    """
    Generate random medical comment with high variability

    For French: rich structured comments (rhythm + qualifier + observations).
    For other languages: uses multilingual medical phrases from the corpus.

    Args:
        lang: Language code (if None, picks randomly from multilingual weights)

    Returns:
        str: Medical comment text
    """
    # Pick language if not specified
    if lang is None:
        lang, _ = pick_language()

    # For non-French languages, use multilingual phrase corpus
    if lang != 'fr':
        phrases = PHRASES.get(lang, PHRASES['en'])
        n = random.choices([1, 2, 3], weights=[40, 40, 20])[0]
        selected = random.sample(phrases, min(n, len(phrases)))
        return ". ".join(selected)
    # Components for creating varied comments
    rythmes = [
        "Rythme sinusal", "Rythme régulier", "Rythme cardiaque",
        "Activité sinusale", "Rythme auriculaire"
    ]

    qualificatifs_rythme = [
        "régulier", "stable", "normal", "bien établi", "harmonieux",
        "constant", "maintenu", "préservé"
    ]

    observations_normales = [
        "Tracé normal", "Tracé dans les normes", "Électrocardiogramme normal",
        "ECG normal", "Aspect normal", "Morphologie normale",
        "Configuration normale", "Tracé conforme", "Examen normal"
    ]

    observations_conduction = [
        "Conduction normale", "Conduction auriculo-ventriculaire normale",
        "Conduction intra-ventriculaire normale", "PR normal",
        "Intervalle PR dans les normes", "QRS fin", "Durée QRS normale"
    ]

    observations_repolarisation = [
        "Repolarisation normale", "Repolarisation homogène",
        "Onde T normale", "Segment ST isoélectrique",
        "ST normal", "Pas de trouble de repolarisation"
    ]

    anomalies_mineures = [
        "Légère bradycardie", "Légère tachycardie",
        "Bradycardie sinusale", "Tachycardie sinusale modérée",
        "Déviation axiale gauche minime", "Bloc incomplet de branche droit",
        "Aspect d'hypertrophie ventriculaire gauche limite",
        "Troubles minimes de repolarisation", "Ondes T aplaties en précordiales",
        "Sus-décalage de ST de type précoce", "Microvoltage en périphérique"
    ]

    observations_diverses = [
        "Fréquence cardiaque normale", "FC dans les normes",
        "Pas d'anomalie significative", "Aucune anomalie majeure détectée",
        "Axe électrique normal", "Morphologie QRS normale",
        "Pas d'onde Q pathologique", "Pas de signe d'ischémie",
        "Absence d'arythmie", "Pas de trouble conductif",
        "Intervalle QT normal", "QTc dans les limites normales"
    ]

    # Probabilities for different comment types
    # simple=40%, compose=30%, detailed=20%, avec_anomalie=10%
    comment_type = random.choices(
        ['simple', 'compose', 'detailed', 'avec_anomalie'],
        weights=[40, 30, 20, 10],
    )[0]

    if comment_type == 'simple':
        # Simple comment (1 element)
        return random.choice(
            observations_normales +
            [f"{r} {q}" for r in rythmes for q in qualificatifs_rythme]
        )

    elif comment_type == 'compose':
        # Compound comment (2 elements)
        elements = random.sample([
            random.choice([f"{r} {q}" for r in rythmes for q in qualificatifs_rythme]),
            random.choice(observations_conduction),
            random.choice(observations_repolarisation),
            random.choice(observations_diverses)
        ], 2)
        return ". ".join(elements)

    elif comment_type == 'detailed':
        # Detailed comment (3 elements)
        elements = [
            random.choice([f"{r} {q}" for r in rythmes for q in qualificatifs_rythme]),
            random.choice(observations_conduction + observations_repolarisation),
            random.choice(observations_diverses)
        ]
        return ". ".join(elements)

    else:  # avec_anomalie
        # Comment with minor anomaly
        base = random.choice([f"{r} {q}" for r in rythmes for q in qualificatifs_rythme])
        anomalie = random.choice(anomalies_mineures)

        # 50% chance to add a normal observation as well
        if random.random() < 0.5:
            return f"{anomalie}. {base}"
        else:
            normal = random.choice(observations_conduction + observations_repolarisation)
            return f"{anomalie}. {normal}"


def choose_random_machine_interpretation(lang=None):
    """
    Generate a machine interpretation text block (#54).

    13% of real hospital ECGs have multi-line automated interpretation blocks
    printed by the ECG machine below the signals.

    Args:
        lang: Language code (None = random)

    Returns:
        dict or None: None if no interpretation, else {lines, bordered, position}
    """
    if random.random() >= 0.13:
        return None

    if lang is None:
        lang, _ = pick_language()

    # Interpretation phrases by language
    interpretations = {
        'en': {
            'headers': ["INTERPRETATION", "ECG INTERPRETATION", "AUTOMATED ANALYSIS",
                        "MACHINE INTERPRETATION", "COMPUTER INTERPRETATION"],
            'normal': ["Normal sinus rhythm", "Normal ECG", "Within normal limits",
                       "No significant abnormality", "Sinus rhythm, rate normal"],
            'findings': [
                "Heart rate: normal", "PR interval: normal", "QRS duration: normal",
                "QT/QTc: normal", "P axis: normal", "QRS axis: normal",
                "T axis: normal", "No ST elevation", "No ST depression",
                "Normal ventricular conduction", "Normal atrial rhythm",
                "No chamber enlargement", "No acute ischemia",
                "Left axis deviation", "Right axis deviation",
                "Sinus bradycardia", "Sinus tachycardia",
                "Nonspecific ST-T changes", "Low voltage QRS",
                "Incomplete right bundle branch block",
                "Left ventricular hypertrophy by voltage",
                "Early repolarization pattern",
            ],
            'severity': ["--- Normal ECG ---", "*** Abnormal ECG ***",
                         "-- Borderline ECG --", "UNCONFIRMED REPORT"],
        },
        'fr': {
            'headers': ["INTERPRETATION", "INTERPRETATION ECG", "ANALYSE AUTOMATIQUE",
                        "INTERPRETATION MACHINE"],
            'normal': ["Rythme sinusal normal", "ECG normal", "Dans les limites normales",
                       "Pas d'anomalie significative", "Tracé normal"],
            'findings': [
                "Fréquence cardiaque : normale", "Intervalle PR : normal",
                "Durée QRS : normale", "QT/QTc : normal",
                "Axe P : normal", "Axe QRS : normal",
                "Conduction ventriculaire normale", "Rythme auriculaire normal",
                "Pas de sus-décalage ST", "Pas de sous-décalage ST",
                "Déviation axiale gauche", "Déviation axiale droite",
                "Bradycardie sinusale", "Tachycardie sinusale",
                "Modifications ST-T non spécifiques", "Microvoltage",
                "Bloc de branche droit incomplet",
                "Hypertrophie ventriculaire gauche",
                "Repolarisation précoce",
            ],
            'severity': ["--- ECG normal ---", "*** ECG anormal ***",
                         "-- ECG limite --", "RAPPORT NON CONFIRMÉ"],
        },
        'de': {
            'headers': ["INTERPRETATION", "EKG-INTERPRETATION", "AUTOMATISCHE ANALYSE"],
            'normal': ["Normaler Sinusrhythmus", "Normales EKG", "Im Normbereich"],
            'findings': [
                "Herzfrequenz: normal", "PR-Intervall: normal", "QRS-Dauer: normal",
                "Linksachsenabweichung", "Sinusbradykardie", "Sinustachykardie",
                "Inkompletter Rechtsschenkelblock", "Linksventrikuläre Hypertrophie",
            ],
            'severity': ["--- Normales EKG ---", "*** Abnormales EKG ***"],
        },
    }

    phrases = interpretations.get(lang, interpretations['en'])

    # Build lines
    lines = []

    # 60% chance of header line
    if random.random() < 0.60:
        lines.append(random.choice(phrases['headers']))

    # 2-5 finding lines
    n_findings = random.randint(2, 5)
    if random.random() < 0.5:
        # Normal ECG — main diagnosis + supporting findings
        lines.append(random.choice(phrases['normal']))
        supporting = random.sample(phrases['findings'][:12], min(n_findings - 1, 4))
        lines.extend(supporting)
    else:
        # Mixed findings
        selected = random.sample(phrases['findings'], min(n_findings, len(phrases['findings'])))
        lines.extend(selected)

    # 30% chance of severity footer
    if random.random() < 0.30:
        lines.append(random.choice(phrases['severity']))

    return {
        "lines": lines,
        "bordered": random.random() < 0.35,  # 35% chance of border/box
        "position": random.choices(["below_signals", "bottom_right"], weights=[70, 30])[0],
        "font_size_factor": random.uniform(0.85, 1.20),
    }


def choose_random_manufacturer_branding():
    """
    Generate manufacturer logo/branding text (#43).

    9% of real hospital ECGs show manufacturer text in header or footer.

    Returns:
        dict or None: None if no branding, else {text, position}
    """
    if random.random() >= 0.10:
        return None

    brands = [
        "Mortara ELI 250", "Mortara ELI 150", "Mortara ELI 380",
        "GE MAC 1200", "GE MAC 800", "GE MAC 5500",
        "GE Marquette", "GE Healthcare",
        "SCHILLER AT-102", "SCHILLER AT-10 plus", "SCHILLER CARDIOVIT",
        "Philips PageWriter TC30", "Philips PageWriter TC50",
        "Philips TC70", "Philips Trim III",
        "Mindray BeneHeart R12", "Mindray BeneHeart R3",
        "Nihon Kohden ECG-2550", "Nihon Kohden Cardiofax V",
        "Fukuda Denshi FX-8222", "Fukuda Denshi FCP-8100",
        "Welch Allyn CP 150", "Welch Allyn CP 50",
        "Edan SE-1200", "Edan SE-12 Express",
        "BIONET Cardio7", "Burdick ELI 280",
        "Spacelabs Cardio Express",
    ]

    positions = random.choices(
        ["top_right", "bottom_left", "bottom_right", "top_left"],
        weights=[40, 25, 25, 10]
    )[0]

    return {
        "text": random.choice(brands),
        "position": positions,
    }


def choose_random_timing_markers():
    """
    Generate vertical timing/caliper marker lines (#37).

    ~10% of real hospital ECGs have vertical dashed lines spanning the grid
    height, marking R-peak positions or measurement reference points.

    Returns:
        dict or None: None if no markers, else {count, style, color, alpha, positions_frac}
    """
    if random.random() >= 0.10:
        return None

    count = random.choices([1, 2, 3], weights=[30, 50, 20])[0]
    # Positions as fraction of signal width (0.0 = left edge, 1.0 = right edge)
    positions = sorted([random.uniform(0.1, 0.9) for _ in range(count)])

    style = random.choices(
        ["dashed", "dotted", "dashdot"],
        weights=[60, 25, 15]
    )[0]

    # Color: slightly darker than grid, lighter than signal
    gray = random.randint(80, 160)
    color = f"#{gray:02x}{gray:02x}{gray:02x}"

    return {
        "count": count,
        "style": style,
        "color": color,
        "alpha": random.uniform(0.4, 0.8),
        "positions_frac": positions,
        "linewidth_px": random.uniform(1.0, 2.5),
    }


def get_medical_text_visibility():
    """
    Determine which medical text lines to display (probability per line)

    Each field is independently randomized to create varied text layouts.

    Returns:
        dict: Display probabilities for each text line type
            - patient_info: dict with boolean values for each field (nom, prenom, etc.)
            - cardiac_measurements: dict with boolean values for each measurement
            - medical_comment: boolean value
    """
    return {
        'patient_info': {
            'nom': random.random() < 0.9,          # 90% probability
            'prenom': random.random() < 0.9,       # 90% probability
            'date_naissance': random.random() < 0.8, # 80% probability
            'poids': random.random() < 0.7,        # 70% probability
            'taille': random.random() < 0.7,       # 70% probability
            'identifiant': random.random() < 0.85   # 85% probability
        },
        'cardiac_measurements': {
            'freq_card': random.random() < 0.95,    # 95% probability
            'pr_interval': random.random() < 0.8,   # 80% probability
            'qrs_duration': random.random() < 0.8,  # 80% probability
            'qt_qtcb': random.random() < 0.75,      # 75% probability
            'axes': random.random() < 0.6           # 60% probability
        },
        'medical_comment': random.random() < 0.9    # 90% probability
    }
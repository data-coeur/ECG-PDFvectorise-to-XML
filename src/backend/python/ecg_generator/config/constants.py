"""
Image constants and layout template configuration
Defines A4 landscape dimensions, ECG scales, and lead arrangement patterns
"""

# A4 landscape page dimensions at 304.8 DPI
# DPI chosen so that 1mm = exactly 12px → 5mm grid square = 60px exactly
DPI = 304.8
A4_WIDTH_MM = 297
A4_HEIGHT_MM = 210
MM_TO_INCH = 1 / 25.4

IMG_WIDTH_PX = int(A4_WIDTH_MM * DPI * MM_TO_INCH)  # 297 * 12 = 3564 pixels
IMG_HEIGHT_PX = int(A4_HEIGHT_MM * DPI * MM_TO_INCH)  # 210 * 12 = 2520 pixels

MM_TO_PX = DPI * MM_TO_INCH  # Conversion factor: 12.0 pixels per mm (exact)

# US Letter landscape dimensions
US_LETTER_WIDTH_MM = 279.4   # 11 inches
US_LETTER_HEIGHT_MM = 215.9  # 8.5 inches

# Page size registry (landscape orientation)
# Physical dimensions: exact mm × 12 px/mm. Grid squares may be partial at edges.
PAGE_SIZES = {
    "a4": {
        "width_mm": A4_WIDTH_MM,    # 297
        "height_mm": A4_HEIGHT_MM,  # 210
        "width_px": IMG_WIDTH_PX,   # 3564
        "height_px": IMG_HEIGHT_PX  # 2520
    },
    "us_letter": {
        "width_mm": US_LETTER_WIDTH_MM,   # 279.4
        "height_mm": US_LETTER_HEIGHT_MM, # 215.9
        "width_px": int(US_LETTER_WIDTH_MM * MM_TO_PX),   # 3352
        "height_px": int(US_LETTER_HEIGHT_MM * MM_TO_PX)   # 2590
    },
    # Nihon Kohden Cardiofax thermal strip (#57)
    # 63mm thermal head width, paper scrolls continuously.
    # 3-channel recorder: prints 4 groups of 3 leads sequentially.
    # Landscape: width = scroll length (~250mm for full 12-lead), height = 63mm.
    "thermal_63mm": {
        "width_mm": 250,    # paper scroll length (fits 4 columns at 25mm/s)
        "height_mm": 63,    # thermal head width (fixed)
        "width_px": int(250 * MM_TO_PX),   # 3000
        "height_px": int(63 * MM_TO_PX)    # 756
    }
}

# ECG standard scales
TIME_SCALE_MM_PER_S = 25  # Standard paper speed: 25 mm/s
AMP_SCALE_MM_PER_MV = 10  # Standard amplitude: 10 mm/mV

TIME_SCALE_PX_PER_S = TIME_SCALE_MM_PER_S * MM_TO_PX
AMP_SCALE_PX_PER_MV = AMP_SCALE_MM_PER_MV * MM_TO_PX

# Margins for text zones when using "with_text_zones" layout (in mm)
TEXT_ZONE_MARGINS = {
    "top": 50,
    "bottom": 10,
    "left": 5,
    "right": 20
}

# Format-specific page dimensions (formats not listed use A4 defaults)
FORMAT_DIMENSIONS = {
    "3x4_paramedic": {
        "page_width_mm": 290,
        "page_height_mm": 100,
        "margins": {
            "physical_top_mm": 0.2,
            "physical_bottom_mm": 0.2,
            "physical_left_mm": 10,
            "physical_right_mm": 10,
            "text_zone_top_mm": 25,
            "text_zone_bottom_mm": 10
        }
    },
    # Nihon Kohden Cardiofax C (ECG-3150) — 63mm thermal strip (#57)
    # 3-channel recorder, 3 rows × 4 time-sequential groups
    "3x4_cardiofax": {
        "page_width_mm": 250,
        "page_height_mm": 63,
        "margins": {
            "physical_top_mm": 1,
            "physical_bottom_mm": 1,
            "physical_left_mm": 3,
            "physical_right_mm": 3,
            "text_zone_top_mm": 0,
            "text_zone_bottom_mm": 0
        }
    },
    # Cardiofax with 1 rhythm strip added
    "3x4+1_cardiofax": {
        "page_width_mm": 250,
        "page_height_mm": 63,
        "margins": {
            "physical_top_mm": 1,
            "physical_bottom_mm": 1,
            "physical_left_mm": 3,
            "physical_right_mm": 3,
            "text_zone_top_mm": 0,
            "text_zone_bottom_mm": 0
        }
    }
}


def get_format_dimensions(format_choice, page_size="a4"):
    """
    Get page dimensions for a specific format and page size

    Args:
        format_choice (str): ECG format name (e.g., "3x4", "3x4_paramedic", "6x2")
        page_size (str): Page size ("a4" or "us_letter")

    Returns:
        tuple: (width_mm, height_mm, width_px, height_px)
    """
    if format_choice in FORMAT_DIMENSIONS:
        dims = FORMAT_DIMENSIONS[format_choice]
        width_mm = dims["page_width_mm"]
        height_mm = dims["page_height_mm"]
        width_px = int(width_mm * MM_TO_PX)
        height_px = int(height_mm * MM_TO_PX)
        return width_mm, height_mm, width_px, height_px
    elif page_size in PAGE_SIZES:
        ps = PAGE_SIZES[page_size]
        return ps["width_mm"], ps["height_mm"], ps["width_px"], ps["height_px"]
    else:
        return A4_WIDTH_MM, A4_HEIGHT_MM, IMG_WIDTH_PX, IMG_HEIGHT_PX

# Lead ordering patterns for 12-lead ECG display
LEAD_ORDERS = {
    "normal": ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"],  # Standard order
    "cabrera": ["aVL", "I", "aVR", "II", "aVF", "III", "V1", "V2", "V3", "V4", "V5", "V6"],  # Cabrera sequence (anatomical order)
    "territoire": ["II", "III", "aVF", "I", "aVL", "V5", "V6", "V1", "V2", "V3", "V4", "aVR"],  # Grouped by myocardial territory
    "shuffle": "random_shuffle"  # Randomized order
}

# Lead nomenclature variants (modern vs. alternative naming conventions)
LEAD_NOMENCLATURES = {
    "peripheriques": {  # Limb/peripheral leads
        "standard": {"I": "I", "II": "II", "III": "III", "aVR": "aVR", "aVL": "aVL", "aVF": "aVF"},
        "alternative": {"I": "DI", "II": "DII", "III": "DIII", "aVR": "AVr", "aVL": "AVl", "aVF": "AVf"}  # D prefix (Derivation)
    },
    "precordiales": {  # Precordial/chest leads
        "standard": {"V1": "V1", "V2": "V2", "V3": "V3", "V4": "V4", "V5": "V5", "V6": "V6"},
        "alternative": {"V1": "C1", "V2": "C2", "V3": "C3", "V4": "C4", "V5": "C5", "V6": "C6"}  # C prefix (Chest)
    }
}

# Layout templates defining lead grid arrangements
# Format: rows x columns (+N rhythm strips)
# - lead[N]: 12-lead ECG signals (short segments)
# - rhythm[N]: Long rhythm strip (continuous waveform spanning multiple columns)
LAYOUT_TEMPLATES = {
    "3x4": [  # 3 rows × 4 columns
        ["lead[0]", "lead[3]", "lead[6]", "lead[9]"],
        ["lead[1]", "lead[4]", "lead[7]", "lead[10]"],
        ["lead[2]", "lead[5]", "lead[8]", "lead[11]"]
    ],
    "3x4_paramedic": [  # 3 rows × 4 columns
        ["lead[0]", "lead[3]", "lead[6]", "lead[9]"],
        ["lead[1]", "lead[4]", "lead[7]", "lead[10]"],
        ["lead[2]", "lead[5]", "lead[8]", "lead[11]"]
    ],
    "3x4+1": [  # 3×4 + 1 rhythm strip
        ["lead[0]", "lead[3]", "lead[6]", "lead[9]"],
        ["lead[1]", "lead[4]", "lead[7]", "lead[10]"],
        ["lead[2]", "lead[5]", "lead[8]", "lead[11]"],
        ["rhythm[0]", "rhythm[0]", "rhythm[0]", "rhythm[0]"]
    ],
    "3x4+2": [  # 3×4 + 2 rhythm strips
        ["lead[0]", "lead[3]", "lead[6]", "lead[9]"],
        ["lead[1]", "lead[4]", "lead[7]", "lead[10]"],
        ["lead[2]", "lead[5]", "lead[8]", "lead[11]"],
        ["rhythm[0]", "rhythm[0]", "rhythm[0]", "rhythm[0]"],
        ["rhythm[1]", "rhythm[1]", "rhythm[1]", "rhythm[1]"]
    ],
    "3x4+3": [  # 3×4 + 3 rhythm strips
        ["lead[0]", "lead[3]", "lead[6]", "lead[9]"],
        ["lead[1]", "lead[4]", "lead[7]", "lead[10]"],
        ["lead[2]", "lead[5]", "lead[8]", "lead[11]"],
        ["rhythm[0]", "rhythm[0]", "rhythm[0]", "rhythm[0]"],
        ["rhythm[1]", "rhythm[1]", "rhythm[1]", "rhythm[1]"],
        ["rhythm[2]", "rhythm[2]", "rhythm[2]", "rhythm[2]"]
    ],
    "6x2": [  # 6 rows × 2 columns
        ["lead[0]", "lead[6]"],
        ["lead[1]", "lead[7]"],
        ["lead[2]", "lead[8]"],
        ["lead[3]", "lead[9]"],
        ["lead[4]", "lead[10]"],
        ["lead[5]", "lead[11]"]
    ],
    "6x2+1": [  # 6×2 + 1 rhythm strip
        ["lead[0]", "lead[6]"],
        ["lead[1]", "lead[7]"],
        ["lead[2]", "lead[8]"],
        ["lead[3]", "lead[9]"],
        ["lead[4]", "lead[10]"],
        ["lead[5]", "lead[11]"],
        ["rhythm[0]", "rhythm[0]"]
    ],
    "4x2": [  # 4 rows × 2 columns (8-row stacked, L-R split)
        ["lead[0]", "lead[4]"],
        ["lead[1]", "lead[5]"],
        ["lead[2]", "lead[6]"],
        ["lead[3]", "lead[7]"]
    ],
    "4x2+1": [  # 4×2 + 1 rhythm strip
        ["lead[0]", "lead[4]"],
        ["lead[1]", "lead[5]"],
        ["lead[2]", "lead[6]"],
        ["lead[3]", "lead[7]"],
        ["rhythm[0]", "rhythm[0]"]
    ],
    "12x1": [  # 12 rows × 1 column (stacked vertically)
        ["lead[0]"],
        ["lead[1]"],
        ["lead[2]"],
        ["lead[3]"],
        ["lead[4]"],
        ["lead[5]"],
        ["lead[6]"],
        ["lead[7]"],
        ["lead[8]"],
        ["lead[9]"],
        ["lead[10]"],
        ["lead[11]"]
    ],
    # Nihon Kohden Cardiofax thermal strip formats (#57)
    "3x4_cardiofax": [  # Same layout as 3x4, on 63mm thermal strip
        ["lead[0]", "lead[3]", "lead[6]", "lead[9]"],
        ["lead[1]", "lead[4]", "lead[7]", "lead[10]"],
        ["lead[2]", "lead[5]", "lead[8]", "lead[11]"]
    ],
    "3x4+1_cardiofax": [  # 3x4 + 1 rhythm strip on thermal
        ["lead[0]", "lead[3]", "lead[6]", "lead[9]"],
        ["lead[1]", "lead[4]", "lead[7]", "lead[10]"],
        ["lead[2]", "lead[5]", "lead[8]", "lead[11]"],
        ["rhythm[0]", "rhythm[0]", "rhythm[0]", "rhythm[0]"]
    ],
    "6x1;6x1": [  # Multi-page format: 2 pages × (6 rows × 1 column)
        # Page 0: leads 0-5 (same distribution as 6x2 first column)
        [
            ["lead[0]"],
            ["lead[1]"],
            ["lead[2]"],
            ["lead[3]"],
            ["lead[4]"],
            ["lead[5]"]
        ],
        # Page 1: leads 6-11 (same distribution as 6x2 second column)
        [
            ["lead[6]"],
            ["lead[7]"],
            ["lead[8]"],
            ["lead[9]"],
            ["lead[10]"],
            ["lead[11]"]
        ]
    ]
}

# Grid Line Mask Configuration (static - not randomized)
GRID_LINE_MASK_CONFIG = {
    "enabled": True,  # Always generate grid line mask
    "line_density": "major_only",  # Options: "major_only" (5mm only), "all_lines" (1mm + 5mm)
    "line_style": "match_ecg_style",  # Options: "match_ecg_style" (realistic), "continuous_only" (force solid lines)
}
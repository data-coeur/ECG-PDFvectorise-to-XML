"""
Configuration management for ECG generation
Handles random configuration generation, validation, and JSON I/O
"""

import json
import os
import random

from ecg_generator.rendering.font_manager import choose_random_font_config
from ecg_generator.config.randomization import (
    choose_random_format, choose_random_page_size, choose_random_lead_order,
    choose_random_lead_nomenclatures,
    choose_random_grid_color, choose_random_grid_style, choose_random_text_color,
    choose_random_separation_style, choose_random_signal_color, choose_random_horizontal_spacing,
    choose_random_layout_style, should_add_medical_text_on_full_grid, should_add_black_square, choose_random_black_squares, choose_random_machine_interpretation, choose_random_timing_markers, choose_random_manufacturer_branding,
    choose_random_separation_color, choose_random_number_pulse, choose_random_pulse_vert_position,
    choose_random_vert_pos_text, choose_random_text_spacing, choose_random_text_size,
    choose_random_pulse_hor_pos, is_there_pulse_and_signal_space, choose_random_pulse_shift,
    is_there_added_noise, choose_random_vertical_spacing, choose_random_rythm_lead,
    choose_special_spacing, choose_random_signal_line_width,
    choose_random_signal_antialiased,
    choose_random_speed, choose_random_gain,
    choose_random_vertical_offset_mm,
    choose_random_top_black_line,
    choose_random_speed_gain_text_config,
    choose_random_pulse_shape, choose_random_pulse_color, should_apply_pulse_lowpass,
    choose_random_grid_squares,
    get_medical_text_visibility,
    choose_random_double_grid,
    choose_random_bi_paper,
    choose_random_variable_channel_spacing,
    choose_random_column_duration_mode,
    choose_random_grid_line_params,
    choose_random_subscript_style
)
from ecg_generator.config.constants import get_format_dimensions, LAYOUT_TEMPLATES


def validate_and_fix_config(config):
    """
    Validate and fix configuration constraints to prevent rendering conflicts

    Enforces several rules:
    - 6x2 format with middle pulse requires minimum horizontal spacing
    - Thick separations require non-zero horizontal spacing

    Args:
        config (dict): Configuration to validate and fix

    Returns:
        dict: Validated and fixed configuration
    """
    format_choice = config.get("format_choice")
    number_ref_pulse = config.get("reference_pulse", {}).get("number_of_ref_pulse")
    horizontal_position = config.get("reference_pulse", {}).get("horizontal_position_ref_pulse")

    # Ensure int or float data are not str
    if not isinstance(config.get("vertical_spacing_mm"), (int, float)):
        config["vertical_spacing_mm"] = float(config.get("vertical_spacing_mm"))

    if not isinstance(config.get("horizontal_spacing_mm"), (int, float)):
        config["horizontal_spacing_mm"] = float(config.get("horizontal_spacing_mm"))

    if not isinstance(config.get("text_formatting").get("lead_text_shift"), (int, float)):
        config["text_formatting"]["lead_text_shift"] = float(config.get("text_formatting").get("lead_text_shift"))

    if not isinstance(config.get("text_formatting").get("lead_text_size"), (int, float)):
        config["text_formatting"]["lead_text_size"] = float(config.get("text_formatting").get("lead_text_size"))

    # Ensure minimum horizontal space for 6x2 format with middle/two-column pulse
    min_space_mid_pulse_mm = 7
    if (format_choice in ["6x2", "4x2"] and
        (number_ref_pulse == "two_columns" or horizontal_position == "middle")):
        config["separation_style"] = None
        if config.get("horizontal_spacing_mm", 0) < min_space_mid_pulse_mm:
            config["horizontal_spacing_mm"] = min_space_mid_pulse_mm

    # At high speed (>= 50 mm/s), signals are wider and middle/two-column pulses
    # overlap the signal area. Force pulse to left-only position.
    speed = config.get("speed_mm_per_s", 25)
    if speed >= 50:
        ref_pulse = config.get("reference_pulse", {})
        if ref_pulse.get("horizontal_position_ref_pulse") == "middle":
            ref_pulse["horizontal_position_ref_pulse"] = "left"
        if ref_pulse.get("number_of_ref_pulse") == "two_columns":
            ref_pulse["number_of_ref_pulse"] = "one_column"
            ref_pulse["horizontal_position_ref_pulse"] = "left"

    # Disable thick separations when there's no horizontal spacing
    if config["separation_style"] in ["quad_line_3mm", "thick_line_3mm"] and config["horizontal_spacing_mm"] == 0:
        config["separation_style"] = None

    # Cap gain to prevent signal overflow beyond page boundaries
    # With gain=20 mm/mV, a 3mV QRS = 60mm height, which overflows most row spacings.
    # Restrict gain=20 to formats with few rows and sufficient vertical spacing.
    gain = config.get("gain_mm_per_mV", 10)
    vertical_spacing = config.get("vertical_spacing_mm", 25)
    if gain == 20:
        # Formats with many rows (>= 6 standard rows) can't accommodate gain=20
        many_row_formats = ["6x2", "6x2+1", "12x1", "6x1;6x1"]
        if format_choice in many_row_formats:
            config["gain_mm_per_mV"] = 10
        # Even for 3x4 formats, gain=20 with tight spacing overflows
        elif vertical_spacing < 20:
            config["gain_mm_per_mV"] = 10

    # Clamp pulse shift so it stays visually attached to its row
    ref_pulse = config.get("reference_pulse", {})
    shift_mm = ref_pulse.get("signal_and_pulse_shift_mm") or 0
    if abs(shift_mm) > 0:
        max_shift = vertical_spacing * 0.3
        if abs(shift_mm) > max_shift:
            ref_pulse["signal_and_pulse_shift_mm"] = max_shift if shift_mm > 0 else -max_shift

    return config


def load_config_from_json(json_path):
    """
    Load configuration from a JSON file

    Args:
        json_path (str): Path to the JSON configuration file

    Returns:
        dict: Loaded and validated configuration (includes xml_source if present)
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    # Keep xml_source field to ensure correct XML is used when rendering from config
    config = validate_and_fix_config(config)
    return config


def random_config():
    """
    Generate a complete random configuration for ECG rendering

    Returns:
        dict: Complete validated random configuration with all rendering parameters
    """
    format_choice = choose_random_format()
    page_size = choose_random_page_size()

    # Calculate page dimensions for this format and page size
    width_mm, height_mm, width_px, height_px = get_format_dimensions(format_choice, page_size)

    separation_style = choose_random_separation_style()
    number_ref_pulse = choose_random_number_pulse(format_choice)
    speed_mm_per_s = choose_random_speed(format_choice)

    config = {
        "format_choice": format_choice,
        "page_size": page_size,
        "page_width_mm": width_mm,
        "page_height_mm": height_mm,
        "page_width_px": width_px,
        "page_height_px": height_px,
        "speed_mm_per_s": speed_mm_per_s,
        "gain_mm_per_mV": choose_random_gain(),
        "rythm_leads": choose_random_rythm_lead(format_choice),
        "signal_color": choose_random_signal_color(),
        "lead_order": choose_random_lead_order(),

        "horizontal_spacing_mm": 0,
        "vertical_spacing_mm": choose_random_vertical_spacing(format_choice),
        "special_spacing": choose_special_spacing(format_choice),

        "separation_color": None,
        "separation_style": separation_style,

        "grid_layout_style": choose_random_layout_style(format_choice),
        "grid_style": choose_random_grid_style(),
        "grid_color": choose_random_grid_color(),
        "double_grid": choose_random_double_grid(),
        "grid_line_params": choose_random_grid_line_params(),
        "bi_paper": choose_random_bi_paper(),
        "reference_pulse": {
            "number_of_ref_pulse": number_ref_pulse,
            "horizontal_position_ref_pulse": choose_random_pulse_hor_pos(format_choice, number_ref_pulse),
            "vertical_position_ref_pulse": choose_random_pulse_vert_position(format_choice, number_ref_pulse),
            "pulse_and_signal_space": is_there_pulse_and_signal_space(number_ref_pulse),
            "signal_and_pulse_shift_mm": choose_random_pulse_shift(number_ref_pulse),
            "pulse_shape": choose_random_pulse_shape(speed_mm_per_s),
            "pulse_color": choose_random_pulse_color(),
            "pulse_lowpass": should_apply_pulse_lowpass()},

        "text_formatting": {
            "lead_text_color": choose_random_text_color(),
            "lead_text_shift": choose_random_vert_pos_text(),
            "spacing_lead_text": choose_random_text_spacing(),
            "lead_text_size": choose_random_text_size(),
            **choose_random_font_config()},
        "lead_nomenclatures": choose_random_lead_nomenclatures(),
        "use_subscript_indices": choose_random_subscript_style(),

        "added_noise": is_there_added_noise(),
        "signal_line_width": choose_random_signal_line_width(),
        "signal_antialiased": choose_random_signal_antialiased(),
        "signal_centering": random.choices(["median", "mean", "min_max"], weights=[60, 20, 20])[0],
        "vertical_offset_max_mm": choose_random_vertical_offset_mm(),
        "top_black_line": choose_random_top_black_line(),
        **choose_random_speed_gain_text_config()
    }

    # Add horizontal spacing only for non-12x1 formats
    if format_choice not in ["12x1", "6x1;6x1"]:
        config["horizontal_spacing_mm"] = choose_random_horizontal_spacing(format_choice)
    else:
        config["separation_style"] = None

    # Column duration mode (#8) — depends on horizontal_spacing_mm and pulse size
    pulse_shape = config["reference_pulse"].get("pulse_shape", (0.04, 0.20, 0.04))
    speed = config.get("speed_mm_per_s", 25)
    pulse_width_mm = sum(pulse_shape) * speed
    config["column_duration_mode"] = choose_random_column_duration_mode(
        format_choice, config["horizontal_spacing_mm"],
        pulse_width_mm=pulse_width_mm, rp_num=number_ref_pulse)

    # Re-evaluate pulse horizontal position now that horizontal_spacing_mm is final (#8)
    # When spacing exists, middle position becomes available for all formats
    config["reference_pulse"]["horizontal_position_ref_pulse"] = choose_random_pulse_hor_pos(
        format_choice, number_ref_pulse, config["horizontal_spacing_mm"])

    # Add separation color only when separation style is defined
    if separation_style:
        config["separation_color"] = choose_random_separation_color()

    # Paramedic format specific overrides
    if format_choice == "3x4_paramedic":
        config["grid_layout_style"] = "full_grid"  # Force full_grid

    # Cardiofax: force full_grid before the layout style block
    if format_choice.endswith("_cardiofax"):
        config["grid_layout_style"] = "full_grid"

    # Configure medical text and black square based on grid layout style
    if config["grid_layout_style"] == "full_grid":
        config["show_medical_text"] = should_add_medical_text_on_full_grid()  # 80% probability
        config["show_axis_circle"] = False  # No header zone for axis circle
    else:
        config["show_medical_text"] = True  # Always shown for with_text_zones layout
        config["show_axis_circle"] = random.random() < 0.10  # 10% chance (#41)

    # Black squares (#53, #77): unified system for calibration, anonymization, timing.
    # Legacy show_black_square removed — calibration type in black_squares replaces it.
    config["black_squares"] = choose_random_black_squares(width_mm, height_mm)
    config["show_black_square"] = False  # Deprecated, kept for backward compat

    # Machine interpretation block (#54) — 13% probability
    config["machine_interpretation"] = choose_random_machine_interpretation()

    # Vertical timing markers (#37) — 10% probability
    config["timing_markers"] = choose_random_timing_markers()

    # Manufacturer branding (#43) — 10% probability
    config["manufacturer_branding"] = choose_random_manufacturer_branding()

    # Dot grid (#42): force dark grid color, no double grid
    if config["grid_style"] == ("dots", "dots"):
        gray = random.randint(20, 80)
        config["grid_color"] = f"#{gray:02x}{gray:02x}{gray:02x}"
        config["double_grid"] = None  # No double grid overlay for dot grids

    # Force speed/gain annotation when values are non-standard (#49)
    # Real machines always print these to alert the reader
    is_non_standard = (config["speed_mm_per_s"] != 25 or config["gain_mm_per_mV"] != 10)
    if is_non_standard:
        config["show_speed_gain"] = True
    elif config.get("show_speed_gain"):
        # Standard values: reduce display probability (many machines omit it)
        config["show_speed_gain"] = random.random() < 0.60

    # Cardiofax thermal strip: override features that don't fit on 63mm strip (#57)
    if format_choice.endswith("_cardiofax"):
        config["show_medical_text"] = False
        config["show_black_square"] = False
        config["show_axis_circle"] = False
        config["machine_interpretation"] = None
        config["black_squares"] = None
        config["timing_markers"] = None
        # Force Nihon Kohden branding when present
        if config["manufacturer_branding"]:
            config["manufacturer_branding"]["text"] = random.choice([
                "NIHON KOHDEN", "Cardiofax C", "ECG-3150",
                "NIHON KOHDEN ECG-3150", "Cardiofax V ECG-1550",
                "Cardiofax S ECG-1250", "Cardiofax M ECG-1350"
            ])

    # Pre-generate text visibility so pipeline and renderer use the same values
    if config["show_medical_text"]:
        config["_text_visibility"] = get_medical_text_visibility()
    else:
        config["_text_visibility"] = None

    # Variable grid square count (#4) — only for with_text_zones layout
    # full_grid: grid always fills the entire page (no variable square count)
    if config["grid_layout_style"] == "with_text_zones":
        fmt_key = format_choice if format_choice != "3x4_paramedic" else "3x4"
        layout_template = LAYOUT_TEMPLATES.get(fmt_key, LAYOUT_TEMPLATES.get("3x4"))
        if isinstance(layout_template, list):
            n_rows = len(layout_template)
        else:
            n_rows = 4  # fallback
        config["grid_squares"] = choose_random_grid_squares(page_size, format_choice, n_rows)
    else:
        config["grid_squares"] = None

    # Variable channel spacing (#12) — compute after grid_squares so we know grid height
    fmt_key = format_choice if format_choice != "3x4_paramedic" else "3x4"
    layout_template = LAYOUT_TEMPLATES.get(fmt_key, LAYOUT_TEMPLATES.get("3x4"))
    n_rows_layout = len(layout_template) if isinstance(layout_template, list) else 4
    # Count channel rows (exclude rhythm strips which are full-width duplicates)
    n_channel_rows = n_rows_layout
    for row in (layout_template if isinstance(layout_template, list) else []):
        if isinstance(row, list) and len(row) > 1 and all(isinstance(r, str) for r in row) and len(set(row)) == 1:
            n_channel_rows -= 1
    # Estimate grid height in mm from page or grid_squares
    if config.get("grid_squares"):
        grid_h_mm = config["grid_squares"]["squares_y"] * 5
    else:
        grid_h_mm = height_mm  # full page height
    config["variable_channel_spacing"] = choose_random_variable_channel_spacing(
        format_choice, n_channel_rows, grid_h_mm)

    config = validate_and_fix_config(config)

    return config


def save_config_to_json(config, source_path, json_path, verbose=True):
    """
    Save configuration to a JSON file

    Args:
        config (dict): Configuration to save
        source_path (str): Path to the source data file (.xml, .npy, .npz)
        json_path (str): Path where JSON file will be saved
        verbose (bool): If True, print [INFO] message; if False, suppress it
    """

    source_file_name = os.path.basename(source_path)

    # Filter out private runtime keys (prefixed with _) from serialized output
    public_config = {k: v for k, v in config.items() if not k.startswith("_")}

    output = {
        "data_source": source_file_name,  # NEW: Unified field name
        "xml_source": source_file_name,   # KEEP: Backward compatibility
        **public_config
    }

    with open(json_path, "w", encoding="utf-8") as jf:
        json.dump(output, jf, ensure_ascii=False, indent=2)

    if verbose:
        print(f"[INFO] Configuration saved to {json_path}")




# Debug/testing code - uncomment to test random_config generation
# if __name__ == "__main__":
#     config = random_config()
#     for key, value in config.items():
#         print(f"{key}: {value}")
"""Configuration validation for ECG rendering.

Trimmed vendor copy: only ``validate_and_fix_config`` is kept. The upstream
module also defined ``random_config``, ``save_config_to_json``, and
``load_config_from_json``, which the fixed-config pipeline in this repo never
calls.
"""


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
        many_row_formats = ["6x2", "6x2+1", "12x1", "6x1;6x1"]
        if format_choice in many_row_formats:
            config["gain_mm_per_mV"] = 10
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

"""Standard configuration for ECG image generation."""


def build_standard_config():
    """
    Build the fixed configuration for standardized ECG rendering.

    Uses the softer_yellow_red color scheme with 6x2+1 layout on A4 paper.

    Returns:
        dict: Complete configuration ready for ecg_generator rendering pipeline.
    """
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
        "vertical_spacing_mm": 28,
        "special_spacing": None,
        "vertical_offset_max_mm": 0.0,
        "grid_layout_style": "full_grid",
        "signal_x_offset_mm": 5,
        "show_medical_text": False,
        "show_black_square": False,
        "added_noise": None,
        "signal_antialiased": False,
        "signal_color": "black",
        "signal_line_width": 2,

        # Theme colors
        "background_color": "#FDFAF5",
        "minor_grid_color": "#E8C060",
        "major_grid_color": "#C8A020",
        "grid_color": "#C8A020",
        "separation_color": "#CC2200",
        "reference_pulse_color": "#CC2200",

        "text_formatting": {
            "lead_text_color": "#CC2200",
            "lead_text_shift": 3,
            "spacing_lead_text": 0,
            "lead_text_size": 3,
        },
        "reference_pulse": {
            "number_of_ref_pulse": "one_column",
            "horizontal_position_ref_pulse": "right",
            "vertical_position_ref_pulse": None,
            "pulse_and_signal_space": True,
            "pulse_gap_mm": 5,
            "signal_and_pulse_shift_mm": 0,
        },
        "separation_style": "ligne_10mm",
        "grid_style": ["solid", "solid"],
        "reference_pulse_line_width_bonus_pt": 0.5,
        "sampling_rate_hz": 500,
        "applied_noise_type": "none",
        "applied_noise_seed": None,
    }

"""
ECG layout rendering functions

Main rendering engine that handles signal positioning, grid generation, and text overlays.
Supports multiple spacing modes (standard, min_max_spacing, one_lead_shift, column_shift)
and both full_grid and with_text_zones layouts.
"""

import random
import numpy as np
import matplotlib.pyplot as plt
import textwrap

from ecg_generator.config.constants import (
    DPI, IMG_WIDTH_PX, IMG_HEIGHT_PX, MM_TO_PX, TIME_SCALE_MM_PER_S, AMP_SCALE_PX_PER_MV, 
    FORMAT_DIMENSIONS
)
from ecg_generator.rendering.grid import (
    generate_ecg_grid_background, generate_ecg_grid_background_clipped, draw_separation_styles)
from ecg_generator.rendering.signal import (
    calculate_text_position, render_signal_with_pulse, render_extra_line_signal, _px_to_linewidth)
from ecg_generator.config.randomization import (
    generate_medical_info, generate_patient_info, generate_cardiac_measurements, 
    generate_medical_comment, get_medical_text_visibility)
from ecg_generator.layout.figure_utils import create_standard_figure, CoordinateData


SUBSCRIPT_DIGITS = str.maketrans('0123456789', '₀₁₂₃₄₅₆₇₈₉')

# Fonts with verified full Unicode subscript digit (₀-₉) support
_SUBSCRIPT_SAFE_FONTS = {"DejaVuSans", "Arimo", "Carlito"}


def _add_lead_label(coord_data, config, final_x, final_y, lead, original_lead,
                    signal_width, ha):
    """Add a lead label as deferred PIL text and record for mask generation.

    Converts the text size from mm to PIL pixels and uses the font config
    from text_formatting.

    Args:
        coord_data: CoordinateData instance
        config: Full config dict
        final_x, final_y: Position in matplotlib data space
        lead: Display text (e.g. "I", "aVR")
        original_lead: Original lead name for coordinate tracking
        signal_width: Signal area width in pixels
        ha: Horizontal alignment
    """
    # Apply Unicode subscript indices if enabled (#60)
    # Only for fonts with verified subscript glyph coverage
    font_family = config.get("text_formatting", {}).get("font_family", "DejaVuSans")
    if config.get("use_subscript_indices", False) and font_family in _SUBSCRIPT_SAFE_FONTS:
        lead = lead.translate(SUBSCRIPT_DIGITS)

    tf = config["text_formatting"]
    # Convert lead_text_size (mm) to pixel size for PIL
    # lead_text_size is in mm, MM_TO_PX=12 px/mm, apply font_size_factor
    base_size_px = tf["lead_text_size"] * MM_TO_PX
    size_factor = tf.get("font_size_factor", 1.0)
    size_px = base_size_px * size_factor

    # For mask generation, store fontsize in matplotlib points
    fontsize_pt = tf["lead_text_size"] * MM_TO_PX * 72 / DPI * 1.33 * size_factor

    # Get font config
    font_family = tf.get("font_family", "DejaVuSans")
    font_bold = tf.get("font_bold", True)
    font_italic = tf.get("font_italic", False)

    # Convert color
    color = tf.get("lead_text_color", "black")

    coord_data.add_deferred_text(
        final_x, final_y, lead, int(size_px),
        color=color, font_family=font_family,
        bold=font_bold, italic=font_italic,
        ha=ha, va='bottom', category='label'
    )
    coord_data.add_lead_label(final_x, final_y, lead, fontsize_pt, ha)


def _col_seg_width(config, j, segment_width_px):
    """Return per-column segment width (for with_calib + single pulse)."""
    per_col_widths = config.get("_per_col_segment_width_px")
    if per_col_widths is not None:
        return per_col_widths[j]
    return segment_width_px


def _col_slice_idx(config, j, slice_samples):
    """Return (start_idx, end_idx) for column j sample slicing."""
    per_col_samples = config.get("_per_col_slice_samples")
    if per_col_samples is not None:
        start = sum(per_col_samples[:j])
        return start, start + per_col_samples[j]
    if config.get("_independent_cells", False):
        # Each cell shows its own lead's full duration (no time slicing).
        return 0, slice_samples
    return j * slice_samples, (j + 1) * slice_samples


def _check_and_adjust_horizontal_spacing(config, n_cols, segment_width_px, signal_area_width, impulse_width_px):
    """
    Check if signals fit horizontally within grid bounds and adjust spacing if needed.

    For both full_grid and with_text_zones layouts, ensures signals don't overflow horizontally
    by reducing horizontal_spacing_mm to maximum value that fits, with minimum of 0mm.

    Note on terminology:
    - n_cols = number of COLUMNS = number of time segments displayed horizontally
    - n_rows = number of ROWS = number of different leads stacked vertically
    - For horizontal width calculation, we use n_cols (time segments across the page)

    Args:
        config: Configuration dict (modified in-place)
        n_cols: Number of columns (time segments displayed horizontally)
        segment_width_px: Width of one signal segment (time slice) in pixels
        signal_area_width: Available width for signals in pixels
        impulse_width_px: Width of reference pulse in pixels (if any)

    Returns:
        float: Adjusted horizontal spacing in mm
    """
    current_spacing_mm = config.get("horizontal_spacing_mm", 0)
    current_spacing_px = current_spacing_mm * MM_TO_PX

    # Calculate total width needed:
    # - n_cols signal segments (each lead's signal is split into n_cols time segments)
    # - (n_cols - 1) spacing gaps between segments
    # Example: 3x4 format has 4 columns, so 4 segments across + 3 gaps between them
    base_width_px = n_cols * segment_width_px
    total_spacing_px = (n_cols - 1) * current_spacing_px if n_cols > 1 else 0

    # Check if reference pulses add extra width
    # Pulses at "right" position extend AFTER the signal, adding extra width
    ref_pulse_config = config.get("reference_pulse", {})
    horizontal_pos = ref_pulse_config.get("horizontal_position_ref_pulse", "left")
    pulse_and_signal_space = ref_pulse_config.get("pulse_and_signal_space", False)
    space_gap_px = MM_TO_PX if pulse_and_signal_space else 0

    extra_pulse_width = 0
    rp_num = ref_pulse_config.get("number_of_ref_pulse")
    if rp_num:
        if horizontal_pos == "right":
            # Pulse AFTER signal adds width: pulse + optional gap
            extra_pulse_width = impulse_width_px + space_gap_px
        # For "left" and "middle": pulse is in negative space (before signal start), no extra width

    # For one_column/two_columns with left/middle position: pulses of columns 2+
    # extend left into the previous column's area. Enforce minimum inter-column
    # spacing so pulses don't overlap with preceding signals.
    min_spacing_px = 0
    if rp_num in ("one_column", "two_columns") and horizontal_pos in ("left", "middle") and n_cols > 1:
        min_spacing_px = impulse_width_px + space_gap_px

    total_width_needed = base_width_px + total_spacing_px + extra_pulse_width

    # Ensure minimum spacing for inter-column pulses
    if min_spacing_px > 0 and current_spacing_px < min_spacing_px:
        total_spacing_px = (n_cols - 1) * min_spacing_px
        total_width_needed = base_width_px + total_spacing_px + extra_pulse_width

    # Check if we exceed available width
    if total_width_needed > signal_area_width:
        # Reduce segment_width or spacing to fit
        if n_cols > 1:
            # Available for spacing = total - signals - pulse
            available_for_spacing = signal_area_width - base_width_px - extra_pulse_width
            max_spacing_px = available_for_spacing / (n_cols - 1)
            max_spacing_px = max(min_spacing_px, max_spacing_px)  # Respect pulse minimum

            if max_spacing_px * (n_cols - 1) + base_width_px + extra_pulse_width > signal_area_width:
                # Still doesn't fit — reduce segment width to make room for pulses
                needed_for_pulses = (n_cols - 1) * min_spacing_px + extra_pulse_width
                new_segment = (signal_area_width - needed_for_pulses) / n_cols
                if new_segment > 0:
                    # Update segment_width via reducing spacing to minimum
                    max_spacing_px = min_spacing_px
                else:
                    max_spacing_px = 0

            max_spacing_mm = max_spacing_px / MM_TO_PX
            config["horizontal_spacing_mm"] = max_spacing_mm
            return max_spacing_mm
        else:
            config["horizontal_spacing_mm"] = 0
            return 0

    # Apply minimum spacing even when total fits
    if min_spacing_px > 0 and current_spacing_px < min_spacing_px:
        min_spacing_mm = min_spacing_px / MM_TO_PX
        config["horizontal_spacing_mm"] = min_spacing_mm
        return min_spacing_mm

    return current_spacing_mm


def _check_special_spacing_fits(spacing_type, special_spacing, signal_area_height,
                                 leads_data_noisy, layout, n_rows, n_cols, slice_samples,
                                 amp_scale_px_per_mV=None):
    """
    Check if special spacing configuration fits in available vertical space.

    Args:
        spacing_type: Type of special spacing ("min_max_spacing", "one_lead_shift", "column_shift")
        special_spacing: Special spacing configuration dict
        signal_area_height: Available vertical space in pixels
        leads_data_noisy: Dictionary of lead signal data
        layout: Layout grid (2D list)
        n_rows: Number of rows
        n_cols: Number of columns
        slice_samples: Number of samples per column segment
        amp_scale_px_per_mV: Amplitude scale in px/mV (defaults to module constant)

    Returns:
        bool: True if spacing fits, False if fallback to standard layout needed
    """
    if amp_scale_px_per_mV is None:
        amp_scale_px_per_mV = AMP_SCALE_PX_PER_MV
    if spacing_type == "min_max_spacing":
        # Estimate total height needed based on signal amplitudes
        spacing_mm = special_spacing.get("spacing_mm", 0)
        spacing_px = spacing_mm * MM_TO_PX

        # Calculate per-column height requirements
        # This must match the actual rendering logic in _render_with_min_max_spacing
        max_height_needed = 0

        for col_idx in range(n_cols):
            # First pass: collect all signal heights for this column
            signal_heights = []

            for row_idx in range(n_rows):
                if row_idx >= len(layout) or col_idx >= len(layout[row_idx]):
                    continue

                lead = layout[row_idx][col_idx]

                # Get signal data for this segment
                if lead in leads_data_noisy:
                    signal = leads_data_noisy[lead]
                    start_idx = col_idx * slice_samples
                    end_idx = (col_idx + 1) * slice_samples

                    if end_idx <= len(signal):
                        slice_signal = signal[start_idx:end_idx]
                        dc_offset = np.median(signal)
                        signal_max_mV = np.max(slice_signal) - dc_offset
                        signal_min_mV = np.min(slice_signal) - dc_offset

                        # Height occupied by this signal (peak to peak)
                        signal_height = (signal_max_mV - signal_min_mV) * amp_scale_px_per_mV
                        signal_heights.append(signal_height)

            # Calculate total column height: sum of signals + spacing between them
            column_height = sum(signal_heights)
            if len(signal_heights) > 1:
                # Add spacing between signals (n-1 gaps for n signals)
                column_height += (len(signal_heights) - 1) * spacing_px

            max_height_needed = max(max_height_needed, column_height)

        # Add margins for:
        # - Initial offset from top (signal maxima positioned at start_y_top)
        # - Label positioning: labels are at y0 + 5mm (below baseline)
        # - Label font height: approximately 3-4mm
        # - Bottom margin for safety
        # Total: 5mm (label offset) + 4mm (font height) + 5mm (safety) = 14mm minimum
        label_offset_px = 5 * MM_TO_PX  # Label is 5mm below baseline (see line 272 in rendering)
        label_height_px = 4 * MM_TO_PX  # Approximate font height
        safety_margin_px = 5 * MM_TO_PX  # Additional safety margin
        total_margin_px = label_offset_px + label_height_px + safety_margin_px

        total_height_needed = max_height_needed + total_margin_px

        return total_height_needed <= signal_area_height

    elif spacing_type == "per_lead_offsets":
        # Per-lead offsets are small (max ±2mm subtle, ±10mm dramatic)
        offsets = special_spacing.get("offsets", {})
        max_shift_px = max((abs(v) for v in offsets.values()), default=0) * MM_TO_PX

        typical_signal_height = 10 * MM_TO_PX
        estimated_needed = n_rows * typical_signal_height + max_shift_px

        return estimated_needed <= signal_area_height

    elif spacing_type == "column_shift":
        # For column shift, similar logic to one_lead_shift
        shift_mm = special_spacing.get("shift_mm", 0)
        shift_px = shift_mm * MM_TO_PX

        # Estimate typical signal height per row
        typical_signal_height = 10 * MM_TO_PX
        estimated_needed = n_rows * typical_signal_height + abs(shift_px)

        return estimated_needed <= signal_area_height

    # Unknown spacing type - allow it to proceed
    return True


def _render_with_min_max_spacing(ax, layout, leads_data_noisy, config, inverse_mapping, coord_data,
                                  signal_area_x_start, signal_area_y_start, segment_width_px,
                                  impulse_width_px, impulse_width_s, duration_s, slice_samples,
                                  row_height_px, n_rows, n_cols,
):
    """
    Render signals with min_max spacing (aligns signal maxima/minima)

    Positions each lead so signal maxima align vertically within each column,
    with configurable spacing between minima and next maxima.

    Args:
        ax (matplotlib.axes.Axes): Axes to draw on
        layout (list): Lead layout grid
        leads_data_noisy (dict): Lead signal data with noise
        config (dict): Configuration dictionary
        inverse_mapping (dict): Lead name mapping
        coord_data (CoordinateData): Object for coordinate tracking
        signal_area_x_start (float): Starting X position
        signal_area_y_start (float): Starting Y position (top edge)
        segment_width_px (float): Width of one segment in pixels
        impulse_width_px (float): Width of reference pulse in pixels
        impulse_width_s (float): Width of reference pulse in seconds
        slice_samples (int): Number of samples per segment
        row_height_px (float): Row height in pixels (for separators)
        n_rows (int): Number of rows
        n_cols (int): Number of columns
    """
    # Compute scales from config (shadow module-level constants)
    TIME_SCALE_PX_PER_S = config.get("speed_mm_per_s", 25) * MM_TO_PX
    AMP_SCALE_PX_PER_MV = config.get("gain_mm_per_mV", 10) * MM_TO_PX

    special_spacing = config.get("special_spacing")
    spacing_mm = special_spacing.get("spacing_mm", 0)
    spacing_px = spacing_mm * MM_TO_PX
    slice_duration = duration_s / n_cols

    # Track Y position for each column independently
    column_y_cursors = {}  # {col_index: current_y_position}
    column_prev_minima = {}  # {col_index: previous_lead_minima_position}

    # Calculate starting Y position (top of available space)
    start_y_top = signal_area_y_start

    # Render signals with min_max_spacing logic
    for i, row in enumerate(layout):
        # Initialize cumulative X position for this row
        cumulative_x = signal_area_x_start
        horizontal_spacing_px = config.get("horizontal_spacing_mm", 0) * MM_TO_PX

        for j, lead in enumerate(row):
            original_lead = inverse_mapping.get(lead, lead)
            if original_lead not in leads_data_noisy:
                continue

            signal = leads_data_noisy[original_lead]
            x0 = cumulative_x

            # Apply min_max_spacing per column
            # Get signal segment for this column
            start_idx, end_idx = _col_slice_idx(config, j, slice_samples)
            slice_signal = signal[start_idx:end_idx]

            # Calculate min and max of demeaned signal in mV
            # (must match the DC offset removal in render_signal_with_pulse)
            dc_offset = np.median(signal)
            signal_max_mV = np.max(slice_signal) - dc_offset
            signal_min_mV = np.min(slice_signal) - dc_offset

            # Determine Y position (baseline) for this lead
            if j not in column_y_cursors:
                # First lead in this column: position maxima at start_y_top
                y0 = start_y_top - signal_max_mV * AMP_SCALE_PX_PER_MV

                # Store minima position for next lead in this column
                minima_position = y0 + signal_min_mV * AMP_SCALE_PX_PER_MV
                column_prev_minima[j] = minima_position
                column_y_cursors[j] = y0
            else:
                # Subsequent leads in column: maxima positioned spacing_px below previous minima
                prev_minima_y = column_prev_minima[j]
                current_maxima_y = prev_minima_y - spacing_px

                # Calculate baseline
                y0 = current_maxima_y - signal_max_mV * AMP_SCALE_PX_PER_MV

                # Update minima position for next lead in this column
                minima_position = y0 + signal_min_mV * AMP_SCALE_PX_PER_MV
                column_prev_minima[j] = minima_position
                column_y_cursors[j] = y0

            # Render the signal segment
            col_width = _col_seg_width(config, j, segment_width_px)
            segment_lead_name = f"{original_lead}_seg{j}"
            coord_data.lead_time_ranges[segment_lead_name] = (j * slice_duration, (j + 1) * slice_duration)
            show_pulse, label_x = render_signal_with_pulse(
                ax, x0, y0, signal, config, slice_samples, j,
                impulse_width_s, col_width, impulse_width_px,
                TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV, i, layout,
                coord_data, segment_lead_name, n_rows, n_cols,
                )

            # Render lead label
            base_y = y0 + 5 * MM_TO_PX
            signal_width = col_width + horizontal_spacing_px
            final_x, final_y = calculate_text_position(label_x, base_y, config["text_formatting"], signal_width, coord_data, original_lead)
            ha = 'center' if config["text_formatting"]["spacing_lead_text"] == "centered" else 'left'

            _add_lead_label(coord_data, config, final_x, final_y, lead, original_lead, signal_width, ha)

            # Update cumulative_x for next segment
            cumulative_x += col_width + horizontal_spacing_px

        # Draw separation lines for this row (if applicable)
        if config["separation_style"] and config["separation_style"] != "none":
            sep_cumulative_x = signal_area_x_start

            for j in range(1, n_cols):
                sep_cumulative_x += _col_seg_width(config, j - 1, segment_width_px)
                sep_x = sep_cumulative_x + horizontal_spacing_px / 2
                sep_cumulative_x += horizontal_spacing_px

                # Use standard row positioning for separators (estimate)
                y_baseline = start_y_top - (i + 1) * row_height_px
                y_bottom_sep = y_baseline
                y_top_sep = y_bottom_sep + row_height_px

                style = config["separation_style"]
                color = config.get("separation_color", "black")
                draw_separation_styles(ax, sep_x, y_baseline, y_bottom_sep, y_top_sep, style, color)


def _render_separators(ax, config, layout, signal_area_x_start, signal_area_y_start,
                       segment_width_px, impulse_width_px, row_height_px, n_rows, n_cols):
    """
    Render vertical separators between columns.

    Handles two types of separators:
    - Continuous styles ("solid", "dashed", "dotted"): Span from top margin to last standard row
    - Per-row styles (all others): Must be called from within the row rendering loop

    Args:
        ax: Matplotlib axes
        config: Configuration dictionary
        layout: Layout grid
        signal_area_x_start: X position where signals start
        signal_area_y_start: Y position at top of signal area
        segment_width_px: Width of one signal segment in pixels
        impulse_width_px: Width of reference pulse in pixels
        row_height_px: Height of one row in pixels
        n_rows: Total number of rows
        n_cols: Number of columns
    """
    style = config.get("separation_style")

    # No separators to draw
    if not style or style == "none":
        return

    # Only draw continuous styles here; per-row styles are handled in the main loop
    if style not in ["solid", "dashed", "dotted"]:
        return

    color = config.get("separation_color", "black")
    initial_shift_px = 5 * MM_TO_PX

    # Find last standard row (before extra leads)
    last_standard_row_idx = n_rows - 1
    for idx, row in enumerate(layout):
        if len(row) > 1 and len(set(row)) == 1:  # Extra line detected
            last_standard_row_idx = idx - 1
            break

    # Calculate Y coordinates for continuous separators
    # Top of separators: at the very top of signal area
    sep_y_top = signal_area_y_start + row_height_px / 2
    # Bottom of separators: extend down by half the vertical spacing from the top
    sep_y_bottom = signal_area_y_start - initial_shift_px - last_standard_row_idx * row_height_px - row_height_px / 2

    # Get horizontal spacing
    horizontal_spacing_px = config.get("horizontal_spacing_mm", 0) * MM_TO_PX

    # Calculate X positions for each separator
    sep_cumulative_x = signal_area_x_start

    for j in range(1, n_cols):
        # Move to end of previous segment
        sep_cumulative_x += _col_seg_width(config, j - 1, segment_width_px)

        # Place separator in the middle of the spacing
        sep_x = sep_cumulative_x + horizontal_spacing_px / 2

        # Add remaining spacing for next iteration
        sep_cumulative_x += horizontal_spacing_px

        # Draw continuous separator from bottom to top
        # Note: y_baseline parameter is not used for continuous styles
        draw_separation_styles(ax, sep_x, sep_y_bottom, sep_y_bottom, sep_y_top, style, color)


def _render_with_one_lead_shift(ax, layout, leads_data_noisy, config, inverse_mapping, coord_data,
                                 signal_area_x_start, signal_area_y_start, signal_area_width,
                                 segment_width_px, impulse_width_px, impulse_width_s, duration_s,
                                 slice_samples, row_height_px, n_rows, n_cols,
):
    """
    Render signals with vertical shift applied to a single lead

    Args:
        ax (matplotlib.axes.Axes): Axes to draw on
        layout (list): Lead layout grid
        leads_data_noisy (dict): Lead signal data with noise
        config (dict): Configuration dictionary
        inverse_mapping (dict): Lead name mapping
        coord_data (CoordinateData): Object for coordinate tracking
        signal_area_x_start (float): Starting X position
        signal_area_y_start (float): Starting Y position (top edge)
        signal_area_width (float): Width of signal area
        segment_width_px (float): Width of one segment in pixels
        impulse_width_px (float): Width of reference pulse in pixels
        impulse_width_s (float): Width of reference pulse in seconds
        duration_s (float): Total signal duration in seconds
        slice_samples (int): Number of samples per segment
        row_height_px (float): Row height in pixels
        n_rows (int): Number of rows
        n_cols (int): Number of columns
    """
    # Compute scales from config (shadow module-level constants)
    TIME_SCALE_PX_PER_S = config.get("speed_mm_per_s", 25) * MM_TO_PX
    AMP_SCALE_PX_PER_MV = config.get("gain_mm_per_mV", 10) * MM_TO_PX

    special_spacing = config.get("special_spacing")
    target_lead_index = special_spacing.get("lead_index", -1)
    shift_mm = special_spacing.get("shift_mm", 0)
    direction = special_spacing.get("direction", "down")

    # Calculate shift in pixels (down = negative Y in matplotlib coords, up = positive Y)
    shift_px = shift_mm * MM_TO_PX * (-1 if direction == "down" else 1)
    slice_duration = duration_s / n_cols

    # Track global lead counter for standard leads only
    global_lead_counter = 0

    # Rendu des signaux
    for i, row in enumerate(layout):
        is_extra_line = len(row) > 1 and len(set(row)) == 1

        # Calcul des positions Y dans la zone disponible pour les signaux
        # Row 0 starts with a small 5mm shift from the top
        initial_shift_px = 5 * MM_TO_PX
        y_bottom = signal_area_y_start - initial_shift_px - i * row_height_px
        y_bottom_sep = y_bottom
        y_top = y_bottom + row_height_px
        y_top_sep = y_top

        # Apply random vertical offset (does not affect separation lines)
        row_offset = config.get("_row_vertical_offsets_px", [0.0] * n_rows)[i]
        y_bottom += row_offset

        # Initialize cumulative X position for this row
        cumulative_x = signal_area_x_start
        horizontal_spacing_px = config.get("horizontal_spacing_mm", 0) * MM_TO_PX

        for j, lead in enumerate(row):
            original_lead = inverse_mapping.get(lead, lead)
            if original_lead not in leads_data_noisy:
                continue

            # Position horizontale using cumulative tracking
            x0 = cumulative_x
            y0 = y_bottom

            signal = leads_data_noisy[original_lead]

            if is_extra_line:
                # Extra lines - continuous signal cropped to displayed duration
                # Only render once per row (j == 0) to avoid duplicate coordinate capture
                if j == 0:
                    extra_lead_name = original_lead + "_extra"
                    coord_data.lead_time_ranges[extra_lead_name] = (0.0, duration_s)
                    # Crop signal to displayed duration (at non-standard speeds,
                    # duration_s < source_duration_s so fewer samples are shown)
                    per_col_samples = config.get("_per_col_slice_samples")
                    extra_samples = sum(per_col_samples) if per_col_samples else slice_samples * n_cols
                    extra_signal = signal[:extra_samples] if extra_samples < len(signal) else signal
                    label_x = render_extra_line_signal(
                        ax, signal_area_x_start, y0, extra_signal, config, duration_s,
                        impulse_width_s, TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV,
                        signal_area_width,
                        i, layout, coord_data, extra_lead_name, n_rows, n_cols,
                        )

                    base_y = y0 + 5 * MM_TO_PX
                    signal_width = signal_area_width
                    final_x, final_y = calculate_text_position(label_x, base_y, config["text_formatting"], signal_width, coord_data, original_lead)
                    ha = 'center' if config["text_formatting"]["spacing_lead_text"] == "centered" else 'left'

                    _add_lead_label(coord_data, config, final_x, final_y, lead, original_lead, signal_width, ha)

                # Extra lines don't need cumulative_x updates (they span full width)
            else:
                # Lignes normales - segments
                # Apply shift if this is the target lead (only affects this specific segment)
                if global_lead_counter == target_lead_index:
                    y0 += shift_px

                # Use unique segment name to avoid connecting separate segments
                col_width = _col_seg_width(config, j, segment_width_px)
                segment_lead_name = f"{original_lead}_seg{j}"
                coord_data.lead_time_ranges[segment_lead_name] = (j * slice_duration, (j + 1) * slice_duration)
                show_pulse, label_x = render_signal_with_pulse(
                    ax, x0, y0, signal, config, slice_samples, j,
                    impulse_width_s, col_width, impulse_width_px,
                    TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV, i, layout,
                    coord_data, segment_lead_name, n_rows, n_cols,
                )

                base_y = y0 + 5 * MM_TO_PX
                signal_width = col_width + horizontal_spacing_px
                final_x, final_y = calculate_text_position(label_x, base_y, config["text_formatting"], signal_width, coord_data, original_lead)
                ha = 'center' if config["text_formatting"]["spacing_lead_text"] == "centered" else 'left'

                _add_lead_label(coord_data, config, final_x, final_y, lead, original_lead, signal_width, ha)

                # Update cumulative_x for next segment
                cumulative_x += col_width + horizontal_spacing_px

                # Increment global lead counter for standard leads
                global_lead_counter += 1

        # Vertical separators (only for non-continuous styles)
        if not is_extra_line and config["separation_style"] != "none":
            style = config["separation_style"]

            # For continuous styles (lignes, pointillés, tirets), skip per-row rendering
            if style not in ["solid", "dashed", "dotted"]:
                # Recalculate cumulative positions for separation lines
                sep_cumulative_x = signal_area_x_start

                for j in range(1, n_cols):
                    # Move to end of previous segment
                    sep_cumulative_x += _col_seg_width(config, j - 1, segment_width_px)

                    # Place separator in the middle of the spacing
                    sep_x = sep_cumulative_x + horizontal_spacing_px / 2

                    # Add remaining spacing for next iteration
                    sep_cumulative_x += horizontal_spacing_px

                    y_baseline = y_bottom
                    color = config.get("separation_color", "black")
                    draw_separation_styles(ax, sep_x, y_baseline, y_bottom_sep, y_top_sep, style, color)

    # Draw continuous separators (lignes, pointillés, tirets) spanning from top to last standard row
    _render_separators(ax, config, layout, signal_area_x_start, signal_area_y_start,
                       segment_width_px, impulse_width_px, row_height_px, n_rows, n_cols)


def _render_with_column_shift(ax, layout, leads_data_noisy, config, inverse_mapping, coord_data,
                               signal_area_x_start, signal_area_y_start, signal_area_width,
                               segment_width_px, impulse_width_px, impulse_width_s, duration_s,
                               slice_samples, row_height_px, n_rows, n_cols,
   ):
    """
    Render signals with vertical shift applied to an entire column

    Args:
        ax (matplotlib.axes.Axes): Axes to draw on
        layout (list): Lead layout grid
        leads_data_noisy (dict): Lead signal data with noise
        config (dict): Configuration dictionary
        inverse_mapping (dict): Lead name mapping
        coord_data (CoordinateData): Object for coordinate tracking
        signal_area_x_start (float): Starting X position
        signal_area_y_start (float): Starting Y position (top edge)
        signal_area_width (float): Width of signal area
        segment_width_px (float): Width of one segment in pixels
        impulse_width_px (float): Width of reference pulse in pixels
        impulse_width_s (float): Width of reference pulse in seconds
        duration_s (float): Total signal duration in seconds
        slice_samples (int): Number of samples per segment
        row_height_px (float): Row height in pixels
        n_rows (int): Number of rows
        n_cols (int): Number of columns
    """
    # Compute scales from config (shadow module-level constants)
    TIME_SCALE_PX_PER_S = config.get("speed_mm_per_s", 25) * MM_TO_PX
    AMP_SCALE_PX_PER_MV = config.get("gain_mm_per_mV", 10) * MM_TO_PX

    special_spacing = config.get("special_spacing")
    target_column_index = special_spacing.get("column_index", -1)
    shift_mm = special_spacing.get("shift_mm", 0)
    direction = special_spacing.get("direction", "down")

    # Calculate shift in pixels (down = negative Y in matplotlib coords, up = positive Y)
    shift_px = shift_mm * MM_TO_PX * (-1 if direction == "down" else 1)
    slice_duration = duration_s / n_cols

    # Rendu des signaux
    for i, row in enumerate(layout):
        is_extra_line = len(row) > 1 and len(set(row)) == 1

        # Calcul des positions Y dans la zone disponible pour les signaux
        # Row 0 starts with a small 5mm shift from the top
        initial_shift_px = 5 * MM_TO_PX
        y_bottom = signal_area_y_start - initial_shift_px - i * row_height_px
        y_bottom_sep = y_bottom
        y_top = y_bottom + row_height_px
        y_top_sep = y_top

        # Apply random vertical offset (does not affect separation lines)
        row_offset = config.get("_row_vertical_offsets_px", [0.0] * n_rows)[i]
        y_bottom += row_offset

        # Initialize cumulative X position for this row
        cumulative_x = signal_area_x_start
        horizontal_spacing_px = config.get("horizontal_spacing_mm", 0) * MM_TO_PX

        for j, lead in enumerate(row):
            original_lead = inverse_mapping.get(lead, lead)
            if original_lead not in leads_data_noisy:
                continue

            # Position horizontale using cumulative tracking
            x0 = cumulative_x
            y0 = y_bottom

            # Apply shift if this is the target column
            if j == target_column_index:
                y0 += shift_px

            signal = leads_data_noisy[original_lead]

            if is_extra_line:
                # Lignes extra - signal cropped to displayed duration
                # Only render once per row (j == 0) to avoid duplicate coordinate capture
                if j == 0:
                    extra_lead_name = original_lead + "_extra"
                    coord_data.lead_time_ranges[extra_lead_name] = (0.0, duration_s)
                    # Crop signal to displayed duration (handles non-standard speeds)
                    per_col_samples = config.get("_per_col_slice_samples")
                    extra_samples = sum(per_col_samples) if per_col_samples else slice_samples * n_cols
                    extra_signal = signal[:extra_samples] if extra_samples < len(signal) else signal
                    label_x = render_extra_line_signal(
                        ax, signal_area_x_start, y_bottom, extra_signal, config, duration_s,
                        impulse_width_s, TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV,
                        signal_area_width,
                        i, layout, coord_data, extra_lead_name, n_rows, n_cols,
                        )

                    base_y = y_bottom + 5 * MM_TO_PX
                    signal_width = signal_area_width
                    final_x, final_y = calculate_text_position(label_x, base_y, config["text_formatting"], signal_width, coord_data, original_lead)
                    ha = 'center' if config["text_formatting"]["spacing_lead_text"] == "centered" else 'left'

                    _add_lead_label(coord_data, config, final_x, final_y, lead, original_lead, signal_width, ha)

                # Extra lines don't need cumulative_x updates (they span full width)
            else:
                # Standard leads - segmented signals
                col_width = _col_seg_width(config, j, segment_width_px)
                segment_lead_name = f"{original_lead}_seg{j}"
                coord_data.lead_time_ranges[segment_lead_name] = (j * slice_duration, (j + 1) * slice_duration)
                show_pulse, label_x = render_signal_with_pulse(
                    ax, x0, y0, signal, config, slice_samples, j,
                    impulse_width_s, col_width, impulse_width_px,
                    TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV, i, layout,
                    coord_data, segment_lead_name, n_rows, n_cols,
                )

                base_y = y0 + 5 * MM_TO_PX
                signal_width = col_width + horizontal_spacing_px
                final_x, final_y = calculate_text_position(label_x, base_y, config["text_formatting"], signal_width, coord_data, original_lead)
                ha = 'center' if config["text_formatting"]["spacing_lead_text"] == "centered" else 'left'

                _add_lead_label(coord_data, config, final_x, final_y, lead, original_lead, signal_width, ha)

                # Update cumulative_x for next segment
                cumulative_x += col_width + horizontal_spacing_px

        # Vertical separators (only for non-continuous styles)
        if not is_extra_line and config["separation_style"] != "none":
            style = config["separation_style"]

            # For continuous styles (lignes, pointillés, tirets), skip per-row rendering
            if style not in ["solid", "dashed", "dotted"]:
                # Recalculate cumulative positions for separation lines
                sep_cumulative_x = signal_area_x_start

                for j in range(1, n_cols):
                    # Move to end of previous segment
                    sep_cumulative_x += _col_seg_width(config, j - 1, segment_width_px)

                    # Place separator in the middle of the spacing
                    sep_x = sep_cumulative_x + horizontal_spacing_px / 2

                    # Add remaining spacing for next iteration
                    sep_cumulative_x += horizontal_spacing_px

                    # Determine if separator should be shifted
                    # Separator j is between column j-1 and j
                    # We'll use the average position or just use standard position
                    y_baseline = y_bottom
                    color = config.get("separation_color", "black")
                    draw_separation_styles(ax, sep_x, y_baseline, y_bottom_sep, y_top_sep, style, color)

    # Draw continuous separators (lignes, pointillés, tirets) spanning from top to last standard row
    _render_separators(ax, config, layout, signal_area_x_start, signal_area_y_start,
                       segment_width_px, impulse_width_px, row_height_px, n_rows, n_cols)


def _wrap_text_to_width(text, fontsize, available_width_px):
    """
    Wrap text to fit within a specified pixel width.

    Args:
        text: Text string to wrap
        fontsize: Font size in points
        available_width_px: Available width in pixels

    Returns:
        list: List of wrapped text lines
    """
    # Estimate character width based on font size
    # For fontsize 8pt, approximate character width is ~20 pixels (extremely conservative estimate)
    # This is a rough approximation for proportional fonts at 300 DPI
    # Using 2.5x multiplier to account for wide characters, spacing, and rendering variations
    # This highly conservative approach ensures text never exceeds margins
    char_width_px = fontsize * 2  # Extremely conservative estimate

    # Calculate maximum characters per line
    max_chars_per_line = int(available_width_px / char_width_px)

    # Ensure minimum of 20 characters per line
    max_chars_per_line = max(20, max_chars_per_line)

    # Wrap the text
    wrapped_lines = textwrap.wrap(text, width=max_chars_per_line, break_long_words=False, break_on_hyphens=True)

    return wrapped_lines


def _render_standard_layout(ax, layout, leads_data_noisy, config, inverse_mapping, coord_data,
                            signal_area_x_start, signal_area_y_start, signal_area_width,
                            segment_width_px, impulse_width_px, impulse_width_s, duration_s,
                            slice_samples, row_height_px, n_rows, n_cols,
):
    """
    Render signals with standard fixed vertical spacing

    Args:
        ax (matplotlib.axes.Axes): Axes to draw on
        layout (list): Lead layout grid
        leads_data_noisy (dict): Lead signal data with noise
        config (dict): Configuration dictionary
        inverse_mapping (dict): Lead name mapping
        coord_data (CoordinateData): Object for coordinate tracking
        signal_area_x_start (float): Starting X position
        signal_area_y_start (float): Starting Y position (top edge)
        signal_area_width (float): Width of signal area
        segment_width_px (float): Width of one segment in pixels
        impulse_width_px (float): Width of reference pulse in pixels
        impulse_width_s (float): Width of reference pulse in seconds
        duration_s (float): Total signal duration in seconds
        slice_samples (int): Number of samples per segment
        row_height_px (float): Row height in pixels
        n_rows (int): Number of rows
        n_cols (int): Number of columns
    """
    # Compute scales from config (shadow module-level constants)
    TIME_SCALE_PX_PER_S = config.get("speed_mm_per_s", 25) * MM_TO_PX
    AMP_SCALE_PX_PER_MV = config.get("gain_mm_per_mV", 10) * MM_TO_PX

    slice_duration = duration_s / n_cols

    # Per-lead offsets (from special_spacing type "per_lead_offsets")
    special_spacing = config.get("special_spacing")
    lead_offsets = {}
    if special_spacing and special_spacing.get("type") == "per_lead_offsets":
        lead_offsets = special_spacing.get("offsets", {})
        # Convert string keys from JSON (if loaded from file) to int
        lead_offsets = {int(k): v for k, v in lead_offsets.items()}

    # Global lead counter for per-lead offset lookup (0-11 for standard leads)
    global_lead_counter = 0

    # Render signals
    for i, row in enumerate(layout):
        is_extra_line = len(row) > 1 and len(set(row)) == 1

        # Calculate Y positions within available signal area
        initial_shift_px = 5 * MM_TO_PX  # Row 0 starts 5mm from top
        y_bottom = signal_area_y_start - initial_shift_px - i * row_height_px
        y_bottom_sep = y_bottom
        y_top = y_bottom + row_height_px
        y_top_sep = y_top

        # Apply random vertical offset (does not affect separation lines)
        row_offset = config.get("_row_vertical_offsets_px", [0.0] * n_rows)[i]
        y_bottom += row_offset

        cumulative_x = signal_area_x_start
        horizontal_spacing_px = config.get("horizontal_spacing_mm", 0) * MM_TO_PX

        for j, lead in enumerate(row):
            original_lead = inverse_mapping.get(lead, lead)
            if original_lead not in leads_data_noisy:
                continue

            x0 = cumulative_x
            y0 = y_bottom

            # Apply per-lead vertical offset (standard leads only)
            if not is_extra_line and global_lead_counter in lead_offsets:
                y0 += lead_offsets[global_lead_counter] * MM_TO_PX

            signal = leads_data_noisy[original_lead]

            if is_extra_line:
                # Extra lines - signal cropped to displayed duration (rhythm strips)
                # Only render once per row (j == 0) to avoid duplicate coordinate capture
                if j == 0:
                    extra_lead_name = original_lead + "_extra"
                    coord_data.lead_time_ranges[extra_lead_name] = (0.0, duration_s)
                    # Crop signal to displayed duration (handles non-standard speeds)
                    per_col_samples = config.get("_per_col_slice_samples")
                    extra_samples = sum(per_col_samples) if per_col_samples else slice_samples * n_cols
                    extra_signal = signal[:extra_samples] if extra_samples < len(signal) else signal
                    label_x = render_extra_line_signal(
                        ax, signal_area_x_start, y0, extra_signal, config, duration_s,
                        impulse_width_s, TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV,
                        signal_area_width,
                        i, layout, coord_data, extra_lead_name, n_rows, n_cols,
                        )

                    base_y = y0 + 5 * MM_TO_PX
                    signal_width = signal_area_width
                    final_x, final_y = calculate_text_position(label_x, base_y, config["text_formatting"], signal_width, coord_data, original_lead)
                    ha = 'center' if config["text_formatting"]["spacing_lead_text"] == "centered" else 'left'

                    _add_lead_label(coord_data, config, final_x, final_y, lead, original_lead, signal_width, ha)

                # Extra lines don't need cumulative_x updates (they span full width)
            else:
                # Standard leads - segmented signals
                col_width = _col_seg_width(config, j, segment_width_px)
                segment_lead_name = f"{original_lead}_seg{j}"
                coord_data.lead_time_ranges[segment_lead_name] = (j * slice_duration, (j + 1) * slice_duration)
                show_pulse, label_x = render_signal_with_pulse(
                    ax, x0, y0, signal, config, slice_samples, j,
                    impulse_width_s, col_width, impulse_width_px,
                    TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV, i, layout,
                    coord_data, segment_lead_name, n_rows, n_cols,
                )

                base_y = y0 + 5 * MM_TO_PX
                signal_width = col_width + horizontal_spacing_px
                final_x, final_y = calculate_text_position(label_x, base_y, config["text_formatting"], signal_width, coord_data, original_lead)
                ha = 'center' if config["text_formatting"]["spacing_lead_text"] == "centered" else 'left'

                _add_lead_label(coord_data, config, final_x, final_y, lead, original_lead, signal_width, ha)

                # Update cumulative_x for next segment
                cumulative_x += col_width + horizontal_spacing_px

                # Increment per-lead counter (standard leads only)
                global_lead_counter += 1

        # Vertical separators (only for non-continuous styles)
        if not is_extra_line and config["separation_style"] != "none":
            style = config["separation_style"]

            # For continuous styles (lignes, pointillés, tirets), skip per-row rendering
            if style not in ["solid", "dashed", "dotted"]:
                # Recalculate cumulative positions for separation lines
                sep_cumulative_x = signal_area_x_start

                for j in range(1, n_cols):
                    # Move to end of previous segment
                    sep_cumulative_x += _col_seg_width(config, j - 1, segment_width_px)

                    # Place separator in the middle of the spacing
                    sep_x = sep_cumulative_x + horizontal_spacing_px / 2

                    # Add remaining spacing for next iteration
                    sep_cumulative_x += horizontal_spacing_px

                    y_baseline = y_bottom
                    color = config.get("separation_color", "black")
                    draw_separation_styles(ax, sep_x, y_baseline, y_bottom_sep, y_top_sep, style, color)

    # Draw continuous separators (lignes, pointillés, tirets) spanning from top to last standard row
    _render_separators(ax, config, layout, signal_area_x_start, signal_area_y_start,
                       segment_width_px, impulse_width_px, row_height_px, n_rows, n_cols)


def render_ecg_layout(leads_data_noisy, layout, config, dimensions, inverse_mapping, page_width_px=None, page_height_px=None):
    """
    Main ECG rendering function - generates complete ECG image with signals and overlays

    Handles grid generation, signal positioning with various spacing modes, medical text
    overlays, and coordinate tracking for mask generation.

    Args:
        leads_data_noisy (dict): Lead signal data with noise applied
        layout (list): Lead layout grid
        config (dict): Complete configuration dictionary
        dimensions (dict): Calculated dimensions for layout
        inverse_mapping (dict): Lead name mapping (displayed -> original)
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        tuple: (fig, ax, coord_data)
            - fig (matplotlib.figure.Figure): Generated figure
            - ax (matplotlib.axes.Axes): Axes object
            - coord_data (CoordinateData): Coordinate tracking data for masks
    """
    n_rows = len(layout)
    n_cols = len(layout[0])

    # Extract page dimensions from config or parameters
    page_width_px = page_width_px or config.get("page_width_px", IMG_WIDTH_PX)
    page_height_px = page_height_px or config.get("page_height_px", IMG_HEIGHT_PX)

    fig, ax = create_standard_figure(transparent=False, page_width_px=page_width_px, page_height_px=page_height_px)
    coord_data = CoordinateData()
    coord_data.signal_line_width_px = config.get("signal_line_width", 1)

    # === GRID GENERATION ===
    major_style, minor_style = config["grid_style"]
    layout_style = config.get("grid_layout_style", "full_grid")

    double_grid = config.get("double_grid")
    bi_paper = config.get("bi_paper")

    # Bi-paper only works with full_grid layout (no text zones, no grid_squares)
    if bi_paper and (layout_style != "full_grid" or config.get("grid_squares") is not None):
        bi_paper = None
        config["bi_paper"] = None

    if bi_paper:
        # Bi-paper composite (#45): grid only on bottom portion, white top
        split_y = page_height_px * (1.0 - bi_paper["split_fraction"])  # matplotlib y=0 is bottom
        tint = bi_paper["paper_tint"]

        # Draw paper tint rectangle on bottom portion (behind grid)
        from matplotlib.patches import Rectangle
        tint_color = (tint[0] / 255.0, tint[1] / 255.0, tint[2] / 255.0)
        ax.add_patch(Rectangle((0, 0), page_width_px, split_y,
                               facecolor=tint_color, edgecolor='none', zorder=0))

        # Draw grid only in bottom portion
        bi_dimensions = {
            "grid_x_start": 0,
            "grid_y_start": 0,
            "grid_width": page_width_px,
            "grid_height": int(split_y),
        }
        generate_ecg_grid_background_clipped(ax, config["grid_color"], major_style, minor_style,
                                             bi_dimensions, coord_data, double_grid=double_grid, grid_line_params=config.get("grid_line_params"))

        # Draw seam/shadow line at the split point
        seam_y = split_y + bi_paper["seam_overlap_px"]
        seam_lw = _px_to_linewidth(bi_paper["seam_width_px"])
        ax.plot([0, page_width_px], [seam_y, seam_y],
                color='#888888', linewidth=seam_lw, alpha=0.6, zorder=5)
        # Subtle shadow below the seam (darker thin line)
        ax.plot([0, page_width_px], [seam_y - 2, seam_y - 2],
                color='#555555', linewidth=seam_lw * 0.5, alpha=0.3, zorder=5)

    elif layout_style == "with_text_zones":
        generate_ecg_grid_background_clipped(ax, config["grid_color"], major_style, minor_style, dimensions, coord_data, double_grid=double_grid, grid_line_params=config.get("grid_line_params"))
    else:
        generate_ecg_grid_background(ax, grid_color=config["grid_color"], major_style=major_style, minor_style=minor_style, coord_data=coord_data,
                                    page_width_px=page_width_px, page_height_px=page_height_px, double_grid=double_grid, grid_line_params=config.get("grid_line_params"))

    # === OPTIONAL BLACK LINE ABOVE GRID (CFA1 style, #6) ===
    # Only for with_text_zones layout (grid is a bordered rectangle with margins)
    top_black_line = config.get("top_black_line")
    if top_black_line and layout_style == "with_text_zones":
        tbl_thickness = top_black_line["thickness_px"]
        tbl_offset_px = top_black_line["offset_mm"] * MM_TO_PX
        tbl_x_start = dimensions["grid_x_start"]
        tbl_x_end = dimensions["grid_x_start"] + dimensions["grid_width"]
        tbl_y = dimensions["grid_y_start"] + dimensions["grid_height"] + tbl_offset_px
        # Only draw if line fits within page bounds
        if tbl_y <= page_height_px:
            ax.plot([tbl_x_start, tbl_x_end], [tbl_y, tbl_y],
                    color="black", linewidth=_px_to_linewidth(tbl_thickness), antialiased=False)

    # === SIGNAL POSITIONING AREA ===
    # Calculate where ECG signals will be drawn (independent of grid coverage)
    # Signals are positioned TOP-TO-BOTTOM:
    #   - signal_area_y_start = top edge (highest Y coordinate)
    #   - signal_area_y_end = bottom edge (lowest Y coordinate)
    #   - Rows rendered downward from signal_area_y_start
    margin_px = 10 * MM_TO_PX

    # Store margin info for potential adjustment later
    top_margin = 0
    bottom_margin = 0

    if layout_style == "with_text_zones":
        # Signals positioned within clipped grid area (with margins applied)
        signal_area_x_start = dimensions["grid_x_start"] + 5 * MM_TO_PX
        signal_area_y_start = dimensions["grid_y_start"] + dimensions["grid_height"] - 5 * MM_TO_PX  # Top of grid
        signal_area_y_end = dimensions["grid_y_start"] + 5 * MM_TO_PX  # Bottom of grid
        signal_area_width = dimensions["grid_width"] - 5 * MM_TO_PX    # Only count a full margin on the left if there is a reference pulse
        signal_area_height = signal_area_y_start - signal_area_y_end
    else:
        # full_grid: Signals avoid medical text overlay zones (grid still covers full page)
        # Special handling for paramedic format with custom text zones
        fmt = config.get("format_choice", "")
        if fmt == "3x4_paramedic":
            margins = FORMAT_DIMENSIONS["3x4_paramedic"]["margins"]
            top_margin = margins["text_zone_top_mm"] * MM_TO_PX  # 25mm
            bottom_margin = margins["text_zone_bottom_mm"] * MM_TO_PX  # 10mm
        elif fmt.endswith("_cardiofax"):
            # Cardiofax thermal: minimal margins, signals fill the strip
            top_margin = 3 * MM_TO_PX
            bottom_margin = 2 * MM_TO_PX
        else:
            medical_text_active = config.get("show_medical_text", False)
            top_margin = 30 * MM_TO_PX if medical_text_active else 10 * MM_TO_PX # Space for medical text at top
            bottom_margin = 15 * MM_TO_PX if medical_text_active else 5 * MM_TO_PX  # Space for text at bottom

        # When grid_squares is set, constrain signals to grid area (#4)
        grid_squares = config.get("grid_squares")
        if grid_squares is not None:
            signal_area_x_start = dimensions["grid_x_start"] + 5 * MM_TO_PX
            signal_area_y_start = dimensions["grid_y_start"] + dimensions["grid_height"] - 5 * MM_TO_PX
            signal_area_y_end = dimensions["grid_y_start"] + 5 * MM_TO_PX
            signal_area_width = dimensions["grid_width"] - 5 * MM_TO_PX
        else:
            signal_area_x_start = margin_px
            if bi_paper:
                # Bi-paper: signals span both sections.
                # split_y is in matplotlib coords (y=0 at bottom).
                # Top white section: split_y → page_height_px
                # Bottom grid section: 0 → split_y
                # Place all signals across full height so they straddle the split.
                # The first half of rows falls in the white section (top),
                # the second half falls in the grid section (bottom).
                split_y_bp = page_height_px * (1.0 - bi_paper["split_fraction"])
                signal_area_y_start = page_height_px - 5 * MM_TO_PX  # Near top
                signal_area_y_end = 5 * MM_TO_PX  # Near bottom
            else:
                signal_area_y_start = page_height_px - top_margin - margin_px  # Top edge (below medical text)
                signal_area_y_end = bottom_margin + margin_px  # Bottom edge (above bottom text)
            signal_area_width = page_width_px - 2 * margin_px
        signal_area_height = signal_area_y_start - signal_area_y_end

    # Temporal parameters
    # NOTE: original code hardcoded 10s, but we override via config when the
    # actual duration is known (set by ecgmind_raw2paper/pipeline.py from <SampleBase>)
    source_duration_s = config.get("_source_duration_s", 10)
    total_samples = len(next(iter(leads_data_noisy.values())))
    # Pulse width from config shape (sum of rise + plateau + fall)
    pulse_shape = config.get("reference_pulse", {}).get("pulse_shape", (0.04, 0.20, 0.04))
    impulse_width_s = sum(pulse_shape)

    # Note: with_calib mode is only allowed when pulse <= 10mm (enforced in
    # randomization). No runtime cap needed here.

    # Compute pixel scales from config (variable speed and gain)
    speed_mm_per_s = config.get("speed_mm_per_s", TIME_SCALE_MM_PER_S)
    gain_mm_per_mV = config.get("gain_mm_per_mV", 10)
    TIME_SCALE_PX_PER_S = speed_mm_per_s * MM_TO_PX
    AMP_SCALE_PX_PER_MV = gain_mm_per_mV * MM_TO_PX

    # When pulse is on the left, reserve space so pulse stays inside the grid
    impulse_width_px = impulse_width_s * TIME_SCALE_PX_PER_S
    ref_pulse_cfg = config.get("reference_pulse", {})
    if ref_pulse_cfg.get("horizontal_position_ref_pulse") == "left":
        space_gap_px = MM_TO_PX if ref_pulse_cfg.get("pulse_and_signal_space", False) else 0
        pulse_reserve = impulse_width_px + space_gap_px
        # Only add extra offset beyond the existing 5mm inset
        existing_inset = 5 * MM_TO_PX
        if pulse_reserve > existing_inset:
            extra = pulse_reserve - existing_inset
            signal_area_x_start += extra
            signal_area_width -= extra

    # Duration handling for non-standard speeds:
    # - High speed (>25mm/s): signal fills more pixels per second, so truncate
    #   displayed duration to fit within available page width
    # - Low speed (<25mm/s): signal fills fewer pixels, leaving empty space (natural)
    #
    # _independent_cells (custom flag): when True, each cell shows its assigned
    # lead's FULL duration (no time-slicing between columns). Used when each cell
    # contains a DIFFERENT lead with simultaneous data.
    if config.get("_independent_cells", False):
        slice_duration_source = source_duration_s
    else:
        slice_duration_source = source_duration_s / n_cols
    # Subtract horizontal spacing from available width so signals don't overflow
    horiz_spacing_total_px = 0
    if n_cols > 1:
        horiz_spacing_total_px = (n_cols - 1) * config.get("horizontal_spacing_mm", 0) * MM_TO_PX
    available_per_col_px = (signal_area_width - horiz_spacing_total_px) / n_cols
    max_slice_duration = available_per_col_px / TIME_SCALE_PX_PER_S
    slice_duration = min(slice_duration_source, max_slice_duration)

    # Column duration mode (#8): adjust effective duration based on mode
    col_dur_mode = config.get("column_duration_mode", {})
    col_dur_mode_name = col_dur_mode.get("mode", "standard") if col_dur_mode else "standard"

    if col_dur_mode_name == "with_calib":
        # Calibration pulse counts toward 10s total only when every column has a pulse.
        # A single pulse ("one") is extra space — it never shortens the signal.
        ref_pulse_cfg = config.get("reference_pulse", {})
        rp_num = ref_pulse_cfg.get("number_of_ref_pulse")
        if rp_num == "one_column":
            # One pulse per column — all columns lose equally
            reduced = max(slice_duration - impulse_width_s, slice_duration * 0.5)
            slice_duration = min(reduced, max_slice_duration)
        elif rp_num == "two_columns":
            # Two pulses per column — all columns lose equally
            reduced = max(slice_duration - 2 * impulse_width_s, slice_duration * 0.5)
            slice_duration = min(reduced, max_slice_duration)
        # "one" pulse: no duration reduction (pulse is extra, not part of 10s)
    elif col_dur_mode_name == "space_included":
        # Horizontal spacing counts as part of total duration — signals are shorter
        horiz_spacing_px = config.get("horizontal_spacing_mm", 0) * MM_TO_PX
        total_spacing_px = (n_cols - 1) * horiz_spacing_px if n_cols > 1 else 0
        spacing_time_s = total_spacing_px / TIME_SCALE_PX_PER_S
        effective_signal_time = max(source_duration_s - spacing_time_s, source_duration_s * 0.7)
        slice_duration = min(effective_signal_time / n_cols, max_slice_duration)
    elif col_dur_mode_name == "random_short":
        # Random fraction of normal duration
        frac = col_dur_mode.get("duration_fraction", 1.0)
        slice_duration = min(slice_duration_source * frac, max_slice_duration)
    # "standard" and "space_excluded": default behaviour (signals = full 10s)

    duration_s = slice_duration * n_cols

    # Segment widths
    segment_width_px = TIME_SCALE_PX_PER_S * slice_duration

    # Adjust slice_samples to match displayed duration
    samples_per_second = total_samples / source_duration_s
    slice_samples = int(slice_duration * samples_per_second)

    # Clean up any stale per-column overrides from previous runs
    config.pop("_per_col_slice_samples", None)
    config.pop("_per_col_segment_width_px", None)

    # Check and adjust horizontal spacing for all grid layouts
    # This ensures signals don't overflow horizontally outside the grid bounds
    _check_and_adjust_horizontal_spacing(config, n_cols, segment_width_px, signal_area_width, impulse_width_px)

    # Final guard: ensure signals + spacing fit within signal area width.
    # If total exceeds available width, reduce spacing first, then segment width.
    final_spacing_px = config.get("horizontal_spacing_mm", 0) * MM_TO_PX
    total_horiz = n_cols * segment_width_px + (n_cols - 1) * final_spacing_px
    if total_horiz > signal_area_width:
        # First: reduce spacing to fit
        max_spacing_px = (signal_area_width - n_cols * segment_width_px) / max(1, n_cols - 1)
        if max_spacing_px >= 0:
            config["horizontal_spacing_mm"] = max_spacing_px / MM_TO_PX
        else:
            # Spacing alone not enough — also reduce segment width
            config["horizontal_spacing_mm"] = 0
            segment_width_px = signal_area_width / n_cols
            slice_duration = segment_width_px / TIME_SCALE_PX_PER_S
            duration_s = slice_duration * n_cols
            slice_samples = int(slice_duration * samples_per_second)

    # Prevent lead text from overflowing into previous column after spacing adjustment
    text_formatting = config.get("text_formatting", {})
    spacing_lead_text = text_formatting.get("spacing_lead_text")
    horizontal_spacing_mm = config.get("horizontal_spacing_mm", 0)

    if isinstance(spacing_lead_text, (int, float)) and spacing_lead_text < 0:
        if abs(spacing_lead_text) > horizontal_spacing_mm:
            text_formatting["spacing_lead_text"] = -horizontal_spacing_mm
            config["text_formatting"] = text_formatting

    # Detect special spacing mode FIRST (before any height adjustments)
    special_spacing = config.get("special_spacing")
    spacing_type = special_spacing.get("type") if special_spacing else None

    # Validate special spacing fits in available space
    if spacing_type:
        fits = _check_special_spacing_fits(
            spacing_type, special_spacing, signal_area_height,
            leads_data_noisy, layout, n_rows, n_cols, slice_samples,
            amp_scale_px_per_mV=AMP_SCALE_PX_PER_MV
        )
        if not fits:
            # Fall back to standard layout with existing vertical_spacing_mm
            config["special_spacing"] = None
            spacing_type = None
            # vertical_spacing_mm already exists in config and will be used by standard layout

    # Calculate row_height_px for spacing modes that use vertical_spacing_mm
    # (standard layout, one_lead_shift, column_shift)
    # min_max_spacing uses its own dynamic spacing logic based on signal amplitudes
    #
    # Variable channel spacing (#12): when configured, overrides vertical_spacing_mm
    # and adjusts signal_area_y_start with custom margins.
    var_spacing = config.get("variable_channel_spacing")
    if var_spacing is not None and spacing_type != "min_max_spacing":
        row_height_px = var_spacing["spacing_mm"] * MM_TO_PX
        # Adjust signal start to respect variable top margin
        var_top_margin_px = var_spacing["margin_top_mm"] * MM_TO_PX
        # Override vertical_spacing_mm so downstream code is consistent
        config["vertical_spacing_mm"] = var_spacing["spacing_mm"]
        # Re-derive signal_area_y_start: shift top edge down by variable margin
        # For with_text_zones: already inside grid, adjust from grid top
        if layout_style == "with_text_zones":
            signal_area_y_start = dimensions["grid_y_start"] + dimensions["grid_height"] - var_top_margin_px
        else:
            grid_squares = config.get("grid_squares")
            if grid_squares is not None:
                signal_area_y_start = dimensions["grid_y_start"] + dimensions["grid_height"] - var_top_margin_px
            else:
                signal_area_y_start = page_height_px - top_margin - var_top_margin_px
        signal_area_height = signal_area_y_start - signal_area_y_end

        # Clamp row_height if it would push rows off the page
        total_needed = n_rows * row_height_px + 5 * MM_TO_PX  # 5mm initial shift
        if total_needed > signal_area_height:
            row_height_px = (signal_area_height - 5 * MM_TO_PX) / n_rows
            config["vertical_spacing_mm"] = row_height_px / MM_TO_PX
    else:
        row_height_px = config["vertical_spacing_mm"] * MM_TO_PX
    min_spacing_px = 10 * MM_TO_PX  # Minimum spacing for readability

    # Only adjust row_height for non-min_max spacing modes
    # min_max_spacing calculates positioning dynamically and doesn't use row_height_px for signals
    if spacing_type != "min_max_spacing" and var_spacing is None:
        # Auto-adjust spacing for all formats to fit in available height
        total_height_needed = (n_rows - 1) * row_height_px
        available_height = signal_area_height

        if total_height_needed > available_height:
            # Reduce spacing to fit all signals
            row_height_px = available_height / n_rows

            # If below minimum acceptable spacing, use minimum and adjust top_margin
            if row_height_px < min_spacing_px:
                row_height_px = min_spacing_px
                required_height = n_rows * min_spacing_px
                missing_height = required_height - signal_area_height

                # Reduce top_margin to compensate (only in full_grid mode with medical text)
                if layout_style == "full_grid" and top_margin > 0:
                    min_top_margin = 5 * MM_TO_PX  # Minimum 5mm for text
                    adjusted_top_margin = max(min_top_margin, top_margin - missing_height)

                    # Recalculate signal area with new top_margin
                    signal_area_y_start = page_height_px - adjusted_top_margin - margin_px
                    signal_area_y_end = bottom_margin + margin_px
                    signal_area_height = signal_area_y_start - signal_area_y_end

    # === PRE-COMPUTE RANDOM VERTICAL OFFSETS PER ROW ===
    # Disabled for min_max_spacing (dynamic per-column positioning would cause overlaps)
    # Skip if offsets were pre-injected (e.g. from test or loaded config)
    if "_row_vertical_offsets_px" not in config:
        vertical_offset_max_mm = config.get("vertical_offset_max_mm", 0.0)
        if vertical_offset_max_mm > 0 and spacing_type != "min_max_spacing":
            row_offsets_px = [
                random.uniform(-vertical_offset_max_mm, vertical_offset_max_mm) * MM_TO_PX
                for _ in range(n_rows)
            ]
        else:
            row_offsets_px = [0.0] * n_rows
        config["_row_vertical_offsets_px"] = row_offsets_px

    # === SIGNAL CLIPPING BOUNDS ===
    x_clip_max = signal_area_x_start + signal_area_width

    # === RENDER SIGNALS ===
    if spacing_type == "min_max_spacing":
        _render_with_min_max_spacing(
            ax, layout, leads_data_noisy, config, inverse_mapping, coord_data,
            signal_area_x_start, signal_area_y_start, segment_width_px,
            impulse_width_px, impulse_width_s, duration_s, slice_samples, row_height_px, n_rows, n_cols,
        )
    elif spacing_type == "per_lead_offsets":
        _render_standard_layout(
            ax, layout, leads_data_noisy, config, inverse_mapping, coord_data,
            signal_area_x_start, signal_area_y_start, signal_area_width,
            segment_width_px, impulse_width_px, impulse_width_s, duration_s,
            slice_samples, row_height_px, n_rows, n_cols,
        )
    elif spacing_type == "column_shift":
        _render_with_column_shift(
            ax, layout, leads_data_noisy, config, inverse_mapping, coord_data,
            signal_area_x_start, signal_area_y_start, signal_area_width,
            segment_width_px, impulse_width_px, impulse_width_s, duration_s,
            slice_samples, row_height_px, n_rows, n_cols,
        )
    else:
        _render_standard_layout(
            ax, layout, leads_data_noisy, config, inverse_mapping, coord_data,
            signal_area_x_start, signal_area_y_start, signal_area_width,
            segment_width_px, impulse_width_px, impulse_width_s, duration_s,
            slice_samples, row_height_px, n_rows, n_cols,
        )

    # === ADD MEDICAL TEXT OVERLAYS ===
    should_show_medical_text = config.get("show_medical_text", False)

    # Font config for all text (medical, speed/gain, etc.)
    tf = config["text_formatting"]
    med_font_family = tf.get("font_family", "DejaVuSans")
    med_font_bold = tf.get("font_bold", False)
    med_font_italic = tf.get("font_italic", False)
    med_size_factor = tf.get("font_size_factor", 1.0)
    med_size_px = int(8 * DPI / 72 * med_size_factor)  # 8pt base, scaled

    if config.get("layout_style", "full_grid") == "with_text_zones" or (config.get("layout_style", "full_grid") == "full_grid" and should_show_medical_text):
        # Generate or use shared medical data (for multi-page consistency)
        if "_shared_medical_data" in config:
            # Multi-page: use pre-generated data for consistency across pages
            patient_info = config["_shared_medical_data"]["patient_info"]
            cardiac_measurements = config["_shared_medical_data"]["cardiac_measurements"]
            medical_comment = config["_shared_medical_data"]["medical_comment"]
        else:
            # Single-page or first-time generation: create new data
            patient_info = generate_patient_info()
            cardiac_measurements = generate_cardiac_measurements()
            medical_comment = generate_medical_comment(lang=patient_info.get('lang'))

        # Language for font selection (non-Latin needs Unicode font)
        text_lang = patient_info.get('lang')

        # Use pre-generated visibility from config, or generate a new one
        visibility = config.get("_text_visibility")
        if visibility is None:
            visibility = get_medical_text_visibility()

        # Starting Y position at top (in top margin)
        # Paramedic format uses tighter spacing (5mm from top instead of 10mm)
        if config.get("format_choice") == "3x4_paramedic":
            top_start_y = page_height_px - 5 * MM_TO_PX  # 5mm from top edge for paramedic
        else:
            top_start_y = page_height_px - 10 * MM_TO_PX  # 10mm from top edge for standard formats
        line_spacing = 4 * MM_TO_PX  # 4mm between lines
        current_line = 0  # Line counter for dynamic spacing

        # ZONE 1: Patient information (top left)
        patient_x = 10 * MM_TO_PX  # 10mm from left edge

        if visibility['patient_info']['nom']:
            text_content = f"Nom: {patient_info['nom']}"
            text_y = top_start_y - current_line*line_spacing
            coord_data.add_deferred_text(
                patient_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(patient_x, text_y, text_content, 8, ha='left', va='top')
            current_line += 1
        if visibility['patient_info']['prenom']:
            text_content = f"Prenom: {patient_info['prenom']}"
            text_y = top_start_y - current_line*line_spacing
            coord_data.add_deferred_text(
                patient_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(patient_x, text_y, text_content, 8, ha='left', va='top')
            current_line += 1
        if visibility['patient_info']['date_naissance']:
            text_content = f"Date de naissance: {patient_info['date_naissance']}"
            text_y = top_start_y - current_line*line_spacing
            coord_data.add_deferred_text(
                patient_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(patient_x, text_y, text_content, 8, ha='left', va='top')
            current_line += 1
        if visibility['patient_info']['poids']:
            text_content = f"Poids: {patient_info['poids']} kg"
            text_y = top_start_y - current_line*line_spacing
            coord_data.add_deferred_text(
                patient_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(patient_x, text_y, text_content, 8, ha='left', va='top')
            current_line += 1
        if visibility['patient_info']['taille']:
            text_content = f"Taille: {patient_info['taille']} cm"
            text_y = top_start_y - current_line*line_spacing
            coord_data.add_deferred_text(
                patient_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(patient_x, text_y, text_content, 8, ha='left', va='top')
            current_line += 1
        if visibility['patient_info']['identifiant']:
            text_content = f"Identifiant du patient: {patient_info['identifiant']}"
            text_y = top_start_y - current_line*line_spacing
            coord_data.add_deferred_text(
                patient_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(patient_x, text_y, text_content, 8, ha='left', va='top')
            current_line += 1

        # ZONE 2: Cardiac measurements (center)
        cardiac_x = page_width_px // 2 - 50 * MM_TO_PX  # Shifted toward center
        cardiac_line = 0

        if visibility['cardiac_measurements']['freq_card']:
            text_content = f"Frequence cardiaque: {cardiac_measurements['freq_card']} bpm"
            text_y = top_start_y - cardiac_line*line_spacing
            coord_data.add_deferred_text(
                cardiac_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(cardiac_x, text_y, text_content, 8, ha='left', va='top')
            cardiac_line += 1
        if visibility['cardiac_measurements']['pr_interval']:
            text_content = f"Intervalle PR: {cardiac_measurements['pr_interval']} ms"
            text_y = top_start_y - cardiac_line*line_spacing
            coord_data.add_deferred_text(
                cardiac_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(cardiac_x, text_y, text_content, 8, ha='left', va='top')
            cardiac_line += 1
        if visibility['cardiac_measurements']['qrs_duration']:
            text_content = f"Duree QRS: {cardiac_measurements['qrs_duration']} ms"
            text_y = top_start_y - cardiac_line*line_spacing
            coord_data.add_deferred_text(
                cardiac_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(cardiac_x, text_y, text_content, 8, ha='left', va='top')
            cardiac_line += 1
        if visibility['cardiac_measurements']['qt_qtcb']:
            text_content = f"QT/QTcB: {cardiac_measurements['qt_qtcb']} ms"
            text_y = top_start_y - cardiac_line*line_spacing
            coord_data.add_deferred_text(
                cardiac_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(cardiac_x, text_y, text_content, 8, ha='left', va='top')
            cardiac_line += 1
        if visibility['cardiac_measurements']['axes']:
            text_content = f"Axes P-R-T: {cardiac_measurements['axe_p']}-{cardiac_measurements['axe_r']}-{cardiac_measurements['axe_t']}"
            text_y = top_start_y - cardiac_line*line_spacing
            coord_data.add_deferred_text(
                cardiac_x, text_y, text_content, med_size_px,
                color='black', font_family=med_font_family,
                bold=med_font_bold, italic=med_font_italic,
                ha='left', va='top', category='medical', lang=text_lang)
            coord_data.add_medical_text(cardiac_x, text_y, text_content, 8, ha='left', va='top')
            cardiac_line += 1

        # ZONE 3: Medical comment (center-right)
        comment_x = page_width_px // 2 + 20 * MM_TO_PX

        if visibility['medical_comment']:
            right_margin_px = 10 * MM_TO_PX
            safety_padding_px = 5 * MM_TO_PX
            available_width_px = page_width_px - comment_x - right_margin_px - safety_padding_px

            comment_fontsize = 8
            wrapped_comment_lines = _wrap_text_to_width(medical_comment, comment_fontsize, available_width_px)

            for line_idx, line_text in enumerate(wrapped_comment_lines):
                y_position = top_start_y - line_idx * line_spacing
                coord_data.add_deferred_text(
                    comment_x, y_position, line_text, med_size_px,
                    color='black', font_family=med_font_family,
                    bold=med_font_bold, italic=med_font_italic,
                    ha='left', va='top', category='medical', lang=text_lang)
                coord_data.add_medical_text(comment_x, y_position, line_text, comment_fontsize, ha='left', va='top')

    # === HEART AXIS CIRCLE (optional, 10% chance, in header zone) ===
    show_axis_circle = config.get("show_axis_circle", False)
    try:
        _has_cardiac = cardiac_measurements is not None
    except NameError:
        _has_cardiac = False
    if show_axis_circle and _has_cardiac:
        import math
        # Position: right side of header, between cardiac measurements and medical comment
        circle_cx = page_width_px // 2 + 5 * MM_TO_PX
        circle_cy = top_start_y - 3 * line_spacing  # below top text lines
        circle_r = 8 * MM_TO_PX  # 8mm radius (~16mm diameter)

        # Draw circle outline
        theta = np.linspace(0, 2 * math.pi, 100)
        ax.plot(circle_cx + circle_r * np.cos(theta),
                circle_cy + circle_r * np.sin(theta),
                color='black', linewidth=0.8, zorder=10)

        # Tick marks every 30 degrees
        for deg in range(0, 360, 30):
            rad = math.radians(deg)
            inner = 0.85 * circle_r
            outer = circle_r
            ax.plot([circle_cx + inner * math.cos(rad), circle_cx + outer * math.cos(rad)],
                    [circle_cy + inner * math.sin(rad), circle_cy + outer * math.sin(rad)],
                    color='black', linewidth=0.6, zorder=10)

        # Axis arrows: P (thin), QRS (thick), T (medium)
        axes_data = [
            (cardiac_measurements.get('axe_p', 60), 'black', 0.6, 0.6),   # P axis
            (cardiac_measurements.get('axe_r', 40), 'black', 1.2, 0.8),   # QRS axis (thicker)
            (cardiac_measurements.get('axe_t', 30), 'black', 0.8, 0.7),   # T axis
        ]
        labels = ['P', 'QRS', 'T']
        for i, (angle_deg, color, lw, length_frac) in enumerate(axes_data):
            rad = math.radians(-angle_deg)  # ECG convention: 0° = right, positive = downward
            dx = length_frac * circle_r * math.cos(rad)
            dy = length_frac * circle_r * math.sin(rad)
            ax.annotate('', xy=(circle_cx + dx, circle_cy - dy),
                        xytext=(circle_cx, circle_cy),
                        arrowprops=dict(arrowstyle='->', color=color, lw=lw),
                        zorder=11)
            # Label at arrow tip
            label_x = circle_cx + (length_frac + 0.15) * circle_r * math.cos(rad)
            label_y = circle_cy - (length_frac + 0.15) * circle_r * math.sin(rad)
            coord_data.add_deferred_text(
                label_x, label_y, labels[i], med_size_px * 0.7,
                color='black', font_family=med_font_family,
                bold=False, italic=False, ha='center', va='center', category='medical')

        # Degree labels at cardinal positions
        for deg, label in [(0, '0°'), (90, '90°'), (180, '±180°'), (-90, '-90°')]:
            rad = math.radians(deg)
            lx = circle_cx + (circle_r + 4 * MM_TO_PX) * math.cos(rad)
            ly = circle_cy + (circle_r + 4 * MM_TO_PX) * math.sin(rad)
            coord_data.add_deferred_text(
                lx, ly, label, med_size_px * 0.6,
                color='black', font_family=med_font_family,
                bold=False, italic=False, ha='center', va='center', category='medical')

    # === BLACK SQUARES (unified: calibration, anonymization, timing — #53, #77) ===
    black_squares = config.get("black_squares") or []
    for sq in black_squares:
        sq_x = sq["x_mm"] * MM_TO_PX
        sq_y = sq["y_mm"] * MM_TO_PX
        sq_w = sq["w_mm"] * MM_TO_PX
        sq_h = sq["h_mm"] * MM_TO_PX
        rect = plt.Rectangle(
            (sq_x, sq_y), sq_w, sq_h,
            facecolor='black', edgecolor='none', zorder=10
        )
        ax.add_patch(rect)
        coord_data.add_black_square(sq_x, sq_y, sq_w, sq_h)

    # === SPEED/GAIN TEXT (scale and visit info) ===

    show_speed_gain = config.get("show_speed_gain", True)
    if config.get("show_medical_text", True) and show_speed_gain:
        text_format = config.get("speed_gain_text_format", "full_with_hz")
        scale_text, visit_text = generate_medical_info(
            speed_mm_per_s=config.get("speed_mm_per_s", 25),
            gain_mm_per_mV=config.get("gain_mm_per_mV", 10),
            text_format=text_format
        )

        # Position: bottom (80%) or top (20%)
        sg_position = config.get("speed_gain_position", "bottom")
        x_offset_mm = config.get("speed_gain_x_offset_mm", 0)

        if sg_position == "bottom":
            text_y = 3 * MM_TO_PX  # 3mm from bottom edge
            va = 'bottom'
        else:
            text_y = page_height_px - 3 * MM_TO_PX  # 3mm from top edge
            va = 'top'

        # Base X position with random offset
        scale_text_x = (10 + x_offset_mm) * MM_TO_PX
        # Shift text right if a calibration square occupies the bottom-left
        has_bottom_left_square = any(
            sq.get("type") == "calibration" and sq.get("y_mm", 99) < 15
            for sq in (config.get("black_squares") or [])
        )
        if has_bottom_left_square:
            # Clear the widest possible calibration square (15mm size + 30mm offset + 3mm gap)
            scale_text_x = (48 + x_offset_mm) * MM_TO_PX

        # Font config for speed/gain text (use same font as lead labels)
        sg_font = med_font_family
        sg_size_px = med_size_px

        # Left text (scale) via PIL deferred text
        coord_data.add_deferred_text(
            scale_text_x, text_y, scale_text, sg_size_px,
            color='black', font_family=sg_font, bold=False, italic=False,
            ha='left', va=va, category='speed_gain'
        )
        coord_data.add_medical_text(scale_text_x, text_y, scale_text, 8, ha='left', va=va)

        # Right text (visit) via PIL deferred text
        visit_text_x = page_width_px - (10 + x_offset_mm) * MM_TO_PX
        coord_data.add_deferred_text(
            visit_text_x, text_y, visit_text, sg_size_px,
            color='black', font_family=sg_font, bold=False, italic=False,
            ha='right', va=va, category='speed_gain'
        )
        coord_data.add_medical_text(visit_text_x, text_y, visit_text, 8, ha='right', va=va)

    # === MACHINE INTERPRETATION BLOCK (#54) ===
    machine_interp = config.get("machine_interpretation")
    if machine_interp:
        interp_lines = machine_interp["lines"]
        interp_bordered = machine_interp.get("bordered", False)
        interp_position = machine_interp.get("position", "below_signals")
        interp_font_factor = machine_interp.get("font_size_factor", 0.85)
        interp_size_px = med_size_px * interp_font_factor

        interp_line_spacing = interp_size_px * 1.4
        block_height = len(interp_lines) * interp_line_spacing + 4 * MM_TO_PX

        if interp_position == "bottom_right":
            interp_x = page_width_px * 0.55
            interp_y_top = 15 * MM_TO_PX + block_height
        else:  # below_signals
            interp_x = signal_area_x_start
            interp_y_top = signal_area_y_end - 2 * MM_TO_PX

        # Draw border if configured
        if interp_bordered:
            border_pad = 2 * MM_TO_PX
            rect_x = interp_x - border_pad
            rect_y = interp_y_top - block_height - border_pad
            rect_w = page_width_px * 0.4
            rect_h = block_height + 2 * border_pad
            border_rect = plt.Rectangle(
                (rect_x, rect_y), rect_w, rect_h,
                facecolor='none', edgecolor='black',
                linewidth=_px_to_linewidth(1), zorder=10
            )
            ax.add_patch(border_rect)

        # Render interpretation lines
        for idx, line_text in enumerate(interp_lines):
            ly = interp_y_top - idx * interp_line_spacing
            is_header = idx == 0 and line_text.isupper()
            coord_data.add_deferred_text(
                interp_x, ly, line_text, interp_size_px,
                color='black', font_family=med_font_family,
                bold=is_header, italic=False,
                ha='left', va='top', category='medical')
            coord_data.add_medical_text(interp_x, ly, line_text, 7, ha='left', va='top')

    # === MANUFACTURER BRANDING (#43) ===
    branding = config.get("manufacturer_branding")
    if branding:
        brand_text = branding["text"]
        brand_pos = branding["position"]
        brand_size = med_size_px * 0.75
        brand_margin = 5 * MM_TO_PX

        if brand_pos == "top_right":
            bx, by = page_width_px - brand_margin, page_height_px - brand_margin
            bha, bva = 'right', 'top'
        elif brand_pos == "top_left":
            bx, by = brand_margin, page_height_px - brand_margin
            bha, bva = 'left', 'top'
        elif brand_pos == "bottom_right":
            bx, by = page_width_px - brand_margin, brand_margin
            bha, bva = 'right', 'bottom'
        else:  # bottom_left
            bx, by = brand_margin, brand_margin
            bha, bva = 'left', 'bottom'

        brand_gray = random.randint(100, 180)
        brand_color = f"#{brand_gray:02x}{brand_gray:02x}{brand_gray:02x}"
        coord_data.add_deferred_text(
            bx, by, brand_text, brand_size,
            color=brand_color, font_family=med_font_family,
            bold=False, italic=False,
            ha=bha, va=bva, category='medical')
        coord_data.add_medical_text(bx, by, brand_text, 7, ha=bha, va=bva)

    # === VERTICAL TIMING MARKERS (#37) ===
    timing_markers = config.get("timing_markers")
    if timing_markers:
        marker_style = timing_markers["style"]
        marker_color = timing_markers["color"]
        marker_alpha = timing_markers["alpha"]
        marker_lw = _px_to_linewidth(timing_markers["linewidth_px"])

        # Map matplotlib linestyle
        ls_map = {"dashed": "--", "dotted": ":", "dashdot": "-."}
        ls = ls_map.get(marker_style, "--")

        for frac in timing_markers["positions_frac"]:
            marker_x = signal_area_x_start + frac * signal_area_width
            ax.plot(
                [marker_x, marker_x],
                [signal_area_y_end, signal_area_y_start],
                color=marker_color, linestyle=ls,
                linewidth=marker_lw, alpha=marker_alpha,
                zorder=3  # Above grid (1-2), below signals (5+)
            )

    # Record page boundary for mask generation
    coord_data.set_page_boundary(page_width_px, page_height_px)

    # Refine label centers from anchor positions to actual text bbox centers
    coord_data.refine_label_centers_from_bbox(fig, ax)

    return fig, ax, coord_data
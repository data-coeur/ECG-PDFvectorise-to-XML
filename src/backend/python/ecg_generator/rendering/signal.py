"""
Signal rendering and text positioning functions

Handles ECG signal rendering with reference pulse marks, text label positioning,
and coordinate capture for mask generation.
"""

import numpy as np
from scipy.signal import lfilter
from ecg_generator.config.constants import MM_TO_PX, AMP_SCALE_PX_PER_MV, TIME_SCALE_PX_PER_S, DPI


def _generate_pulse_coords(ref_pulse_config, AMP_SCALE_PX_PER_MV, TIME_SCALE_PX_PER_S):
    """Generate calibration pulse time/amplitude coordinates from config.

    Args:
        ref_pulse_config: reference_pulse config dict
        AMP_SCALE_PX_PER_MV: Amplitude scale (pixels per mV)
        TIME_SCALE_PX_PER_S: Time scale (pixels per second)

    Returns:
        tuple: (pulse_time, pulse_signal, impulse_total_s)
            - pulse_time: list of time values in seconds
            - pulse_signal: list of amplitude values in mV (with vertical offset)
            - impulse_total_s: total pulse duration in seconds
    """
    # Get shape from config or use default
    pulse_shape = ref_pulse_config.get("pulse_shape", (0.04, 0.20, 0.04))
    rise_s, plateau_s, fall_s = pulse_shape
    total_s = rise_s + plateau_s + fall_s

    # Vertical offset
    signal_and_pulse_shift_mm = ref_pulse_config.get("signal_and_pulse_shift_mm", 0)
    gain_mm_per_mV = AMP_SCALE_PX_PER_MV / MM_TO_PX
    vertical_offset_mV = signal_and_pulse_shift_mm / gain_mm_per_mV

    # Build pulse waveform at 0-based: 0 → 1 → 0 (offset added after filtering)
    if rise_s == 0 and fall_s == 0:
        pulse_time = [0.0, 0.0, plateau_s, plateau_s]
        pulse_signal_raw = [0, 1, 1, 0]
    else:
        pulse_time = [0.0, rise_s, rise_s, rise_s + plateau_s,
                      rise_s + plateau_s, total_s]
        pulse_signal_raw = [0, 0, 1, 1, 0, 0]

    # Optional IIR lowpass (10% of pulses) — makes pulse not a perfect rectangle (#65)
    # Filter on 0-based signal first, then add offset — ensures baseline starts at 0
    if ref_pulse_config.get("pulse_lowpass", False):
        n_pts = max(200, int(total_s * 10000))
        t_dense = np.linspace(0, total_s, n_pts)
        sig_dense = np.interp(t_dense, pulse_time, pulse_signal_raw)

        # IIR order-1 lowpass at 40Hz (NO forward-backward — single pass only)
        fs = n_pts / total_s
        rc = 1.0 / (2 * np.pi * 40)
        dt = 1.0 / fs
        alpha = dt / (rc + dt)
        b = [alpha]
        a = [1.0, -(1 - alpha)]
        sig_filtered = lfilter(b, a, sig_dense)

        # Downsample back to reasonable number of points
        n_out = 50
        indices = np.linspace(0, n_pts - 1, n_out, dtype=int)
        pulse_time = t_dense[indices].tolist()
        pulse_signal = (sig_filtered[indices] + vertical_offset_mV).tolist()
    else:
        pulse_signal = [v + vertical_offset_mV for v in pulse_signal_raw]

    return pulse_time, pulse_signal, total_s


def _px_to_linewidth(px):
    """Convert a desired pixel width to matplotlib linewidth (points).

    Matplotlib linewidth is in points (1/72 inch).  At our DPI (304.8),
    1 point = DPI/72 ≈ 4.23 pixels, so a 1 px line needs ~0.236 pt.
    """
    return px * 72.0 / DPI



def _should_show_format_special_pulse(config, row_index, layout, column_index):
    """
    Determine if a pulse should be displayed according to format_special rules

    Args:
        config (dict): Configuration
        row_index (int): Current row index
        layout (list): Complete layout
        column_index (int): Column index

    Returns:
        bool: True if pulse should be displayed
    """
    if row_index is None or layout is None:
        return False

    format_choice = config.get("format_choice", "")

    # Format 6x2+1: pulse on line before extra (second-to-last row)
    if format_choice == "6x2+1" and row_index == len(layout) - 2 and column_index == 0:
        return True

    # Format 3x4+1: pulse on last line
    if format_choice == "3x4+1" and row_index == len(layout) - 1 and column_index == 0:
        return True

    return False


def should_show_pulse_at_position(config, row_index, col_index, n_rows, n_cols, is_extra_line=False):
    """
    Determine if a reference pulse should be displayed at this specific position

    Args:
        config (dict): Configuration containing reference_pulse settings
        row_index (int): Current row index (0-indexed)
        col_index (int): Current column index (0-indexed)
        n_rows (int): Total number of rows
        n_cols (int): Total number of columns
        is_extra_line (bool): True if this is an extra line (full continuous signal)

    Returns:
        bool: True if pulse should be displayed at this position
    """
    ref_pulse_config = config.get("reference_pulse", {})
    number_of_ref_pulse = ref_pulse_config.get("number_of_ref_pulse")

    # No pulse configured
    if not number_of_ref_pulse:
        return False

    horizontal_pos = ref_pulse_config.get("horizontal_position_ref_pulse")
    vertical_pos = ref_pulse_config.get("vertical_position_ref_pulse")  # 1-indexed or None
    format_choice = config.get("format_choice", "")

    # Determine target column based on horizontal position
    if horizontal_pos == "left":
        target_col = 0
    elif horizontal_pos == "middle":
        target_col = n_cols // 2
    elif horizontal_pos == "right":
        target_col = n_cols - 1
    else:
        target_col = 0  # Fallback to left

    # Logic based on pulse type
    if number_of_ref_pulse == "one":
        # Single pulse at specific position (both row AND column)
        if vertical_pos is None:
            return False

        # Convert vertical_pos from 1-indexed to 0-indexed
        target_row = vertical_pos - 1

        return row_index == target_row and col_index == target_col

    elif number_of_ref_pulse == "one_column":
        # All rows in a single column
        return col_index == target_col

    elif number_of_ref_pulse == "two_columns":
        # Only for 6x2 format
        if format_choice not in ["6x2", "4x2"]:
            return False

        # Middle column always present
        middle_col = n_cols // 2

        # Second column based on horizontal_position_ref_pulse
        if horizontal_pos == "left":
            second_col = 0
        elif horizontal_pos == "right":
            second_col = n_cols - 1
        else:
            # If horizontal_pos is "middle", only use middle column
            second_col = middle_col

        return col_index == middle_col or col_index == second_col

    return False


def draw_reference_pulse(ax, start_x, baseline_y, signal_color, vertical_offset_mm=0, pulse_height_mV=1, pulse_width_s=0.2, coord_data=None, pulse_key=None):
    """
    Draw a reference pulse mark

    Args:
        ax: Matplotlib axes
        start_x (float): X starting position in pixels
        baseline_y (float): Y baseline in pixels
        signal_color (str): Signal color
        vertical_offset_mm (float): Vertical offset in millimeters
        pulse_height_mV (float): Pulse height in millivolts (default 1mV)
        pulse_width_s (float): Pulse width in seconds (default 0.2s)
        coord_data: Optional CoordinateData for recording pulse coordinates
        pulse_key: Optional key for this pulse in coord_data
    """
    height_px = pulse_height_mV * AMP_SCALE_PX_PER_MV
    width_px = pulse_width_s * TIME_SCALE_PX_PER_S
    vertical_offset_px = vertical_offset_mm * MM_TO_PX
    adjusted_baseline_y = baseline_y + vertical_offset_px
    x_vals = [start_x, start_x, start_x + width_px, start_x + width_px]
    y_vals = [adjusted_baseline_y, adjusted_baseline_y + height_px, adjusted_baseline_y + height_px, adjusted_baseline_y]
    ax.plot(x_vals, y_vals, color=signal_color, linewidth=_px_to_linewidth(1.5), antialiased=False)

    # Record pulse coordinates for mask generation
    if coord_data is not None and pulse_key is not None:
        for x, y in zip(x_vals, y_vals):
            coord_data.add_reference_pulse_point(pulse_key, x, y)


def calculate_text_position(base_x, base_y, text_formatting, signal_width_px=None, coord_data=None, lead_name=None):
    """
    Calculate text position based on formatting parameters

    Args:
        base_x (float): Base X position in pixels
        base_y (float): Base Y position in pixels
        text_formatting (dict): Text formatting parameters
        signal_width_px (float, optional): Signal width in pixels (for centering)
        coord_data (CoordinateData, optional): Object to capture label coordinates
        lead_name (str, optional): Lead name for coordinate capture

    Returns:
        tuple: (final_x, final_y) Final text position in pixels
    """
    # Y position with vertical offset
    final_y = base_y + text_formatting["lead_text_shift"] * MM_TO_PX

    # X position based on spacing configuration
    x_position = text_formatting["spacing_lead_text"]
    if x_position == -10:
        final_x = base_x - 10 * MM_TO_PX
    elif x_position == -5:
        final_x = base_x - 5 * MM_TO_PX
    elif x_position == 0:
        final_x = base_x  # Standard position
    elif x_position == 10:
        final_x = base_x + 10 * MM_TO_PX
    elif x_position == "centered":
        # Centered at signal midpoint (if width provided)
        if signal_width_px:
            final_x = base_x + signal_width_px / 2
        else:
            final_x = base_x  # Fallback if no width
    else:
        final_x = base_x

    # Capture label center for NPZ
    if coord_data is not None and lead_name is not None:
        coord_data.add_label_center(lead_name, final_x, final_y)

    return final_x, final_y


def render_signal_with_pulse(ax, x0, y0, signal, config, slice_samples, j,
                           impulse_width_s, segment_width_px, impulse_width_px,
                           TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV, row_index=None, layout=None,
                           coord_data=None, lead_name=None, n_rows=None, n_cols=None):
    """
    Render a signal segment with reference pulse and capture coordinates

    The signal is always rendered at full duration, the pulse is placed before or after it.

    Args:
        ax: Matplotlib axes
        x0 (float): Starting X position in pixels
        y0 (float): Starting Y position in pixels
        signal (np.ndarray): Signal data
        config (dict): Configuration
        slice_samples (int): Number of samples per slice
        j (int): Column index
        impulse_width_s (float): Pulse width in seconds
        segment_width_px (float): Segment width in pixels
        impulse_width_px (float): Pulse width in pixels
        TIME_SCALE_PX_PER_S (float): Time scale in pixels per second
        AMP_SCALE_PX_PER_MV (float): Amplitude scale in pixels per millivolt
        row_index (int, optional): Row index (to determine if pulse should be shown)
        layout (list, optional): Complete layout
        coord_data (CoordinateData, optional): Object to capture signal coordinates
        lead_name (str, optional): Lead name for coordinate capture
        n_rows (int, optional): Total number of rows
        n_cols (int, optional): Total number of columns

    Returns:
        tuple: (show_pulse, label_x) - Pulse information and label position
    """
    # Temporal slicing by column (per-column for with_calib + single pulse)
    per_col_samples = config.get("_per_col_slice_samples")
    if per_col_samples is not None:
        start_idx = sum(per_col_samples[:j])
        end_idx = start_idx + per_col_samples[j]
    elif config.get("_independent_cells", False):
        # Each cell contains a different lead with simultaneous data —
        # show the full lead signal in every cell, no time-slicing.
        start_idx = 0
        end_idx = slice_samples
    else:
        start_idx = j * slice_samples
        end_idx = (j + 1) * slice_samples
    slice_signal = signal[start_idx:end_idx]

    # Remove DC offset so isoelectric baseline aligns with y0 (#62)
    # Use full lead (not slice) to avoid per-column baseline jumps
    centering = config.get("signal_centering", "median")
    if centering == "min_max":
        baseline = (np.min(signal) + np.max(signal)) / 2
    elif centering == "mean":
        baseline = np.mean(signal)
    else:  # median (default, robust to QRS peaks)
        baseline = np.median(signal)
    slice_signal = slice_signal - baseline

    # Determine if pulse should be displayed at this position
    show_pulse = False
    if n_rows is not None and n_cols is not None and row_index is not None:
        show_pulse = should_show_pulse_at_position(config, row_index, j, n_rows, n_cols, is_extra_line=False)

    # Pulse parameters
    ref_pulse_config = config.get("reference_pulse", {})
    horizontal_pos = ref_pulse_config.get("horizontal_position_ref_pulse", "left")
    pulse_and_signal_space = ref_pulse_config.get("pulse_and_signal_space", False)
    signal_and_pulse_shift_mm = ref_pulse_config.get("signal_and_pulse_shift_mm", 0)

    # Calculate gap between pulse and signal (if configured)
    space_gap_px = MM_TO_PX if pulse_and_signal_space else 0

    # Full signal duration (NO cropping) — use per-column width if available
    per_col_widths = config.get("_per_col_segment_width_px")
    col_segment_width_px = per_col_widths[j] if per_col_widths is not None else segment_width_px
    slice_duration = col_segment_width_px / TIME_SCALE_PX_PER_S
    time_slice = np.linspace(0, slice_duration, len(slice_signal))

    if show_pulse:
        # Generate pulse coordinates from config (variable shapes, optional lowpass)
        pulse_time, pulse_signal, _ = _generate_pulse_coords(
            ref_pulse_config, AMP_SCALE_PX_PER_MV, TIME_SCALE_PX_PER_S)

        # Pulse color: use config override or default to signal color
        pulse_color = ref_pulse_config.get("pulse_color") or config["signal_color"]

        # Determine pulse position based on horizontal_position_ref_pulse
        if horizontal_pos == "left":
            pulse_x_start = x0 - impulse_width_px - space_gap_px
            signal_x_start = x0

            ax.plot(
                pulse_x_start + np.array(pulse_time) * TIME_SCALE_PX_PER_S,
                y0 + np.array(pulse_signal) * AMP_SCALE_PX_PER_MV,
                color=pulse_color,
                linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
                antialiased=config.get("signal_antialiased", False)
            )
            ax.plot(
                signal_x_start + time_slice * TIME_SCALE_PX_PER_S,
                y0 + slice_signal * AMP_SCALE_PX_PER_MV,
                color=config["signal_color"],
                linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
                antialiased=config.get("signal_antialiased", False)
            )
            signal_x_coords = signal_x_start + time_slice * TIME_SCALE_PX_PER_S

        elif horizontal_pos == "middle":
            pulse_x_start = x0 - impulse_width_px - space_gap_px
            signal_x_start = x0

            ax.plot(
                pulse_x_start + np.array(pulse_time) * TIME_SCALE_PX_PER_S,
                y0 + np.array(pulse_signal) * AMP_SCALE_PX_PER_MV,
                color=pulse_color,
                linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
                antialiased=config.get("signal_antialiased", False)
            )
            ax.plot(
                signal_x_start + time_slice * TIME_SCALE_PX_PER_S,
                y0 + slice_signal * AMP_SCALE_PX_PER_MV,
                color=config["signal_color"],
                linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
                antialiased=config.get("signal_antialiased", False)
            )
            signal_x_coords = signal_x_start + time_slice * TIME_SCALE_PX_PER_S

        else:  # horizontal_pos == "right"
            # Signal fills segment minus pulse width; pulse placed after signal
            signal_x_start = x0
            effective_signal_width = segment_width_px - impulse_width_px - space_gap_px
            if effective_signal_width < segment_width_px * 0.5:
                effective_signal_width = segment_width_px  # Fallback: no room, skip shrink
            signal_duration = effective_signal_width / TIME_SCALE_PX_PER_S
            time_slice_right = np.linspace(0, signal_duration, len(slice_signal))
            pulse_x_start = x0 + effective_signal_width + space_gap_px

            ax.plot(
                signal_x_start + time_slice_right * TIME_SCALE_PX_PER_S,
                y0 + slice_signal * AMP_SCALE_PX_PER_MV,
                color=config["signal_color"],
                linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
                antialiased=config.get("signal_antialiased", False)
            )
            ax.plot(
                pulse_x_start + np.array(pulse_time) * TIME_SCALE_PX_PER_S,
                y0 + np.array(pulse_signal) * AMP_SCALE_PX_PER_MV,
                color=pulse_color,
                linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
                antialiased=config.get("signal_antialiased", False)
            )
            signal_x_coords = signal_x_start + time_slice_right * TIME_SCALE_PX_PER_S
    else:
        # No pulse - render signal normally
        ax.plot(
            x0 + time_slice * TIME_SCALE_PX_PER_S,
            y0 + slice_signal * AMP_SCALE_PX_PER_MV,
            color=config["signal_color"],
            linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
            antialiased=config.get("signal_antialiased", False)
        )
        signal_x_coords = x0 + time_slice * TIME_SCALE_PX_PER_S

    # Capture pulse coordinates for mask generation
    if show_pulse and coord_data is not None:
        pulse_key = f"pulse_{lead_name}_{j}" if lead_name else f"pulse_{j}"
        pulse_x_arr = pulse_x_start + np.array(pulse_time) * TIME_SCALE_PX_PER_S
        pulse_y_arr = y0 + np.array(pulse_signal) * AMP_SCALE_PX_PER_MV
        for px, py in zip(pulse_x_arr, pulse_y_arr):
            coord_data.add_reference_pulse_point(pulse_key, float(px), float(py))

    # Label position
    # Label always stays with signal at x0 regardless of pulse position
    # For "left" and "middle": pulse is in negative space, signal at x0
    # For "right": pulse is after signal, signal at x0
    label_x = x0

    # Capture signal coordinates for mask generation (EXCLUDE pulse coordinates)
    if coord_data is not None and lead_name is not None:
        signal_y = y0 + slice_signal * AMP_SCALE_PX_PER_MV
        for i, (sx, sy) in enumerate(zip(signal_x_coords, signal_y)):
            coord_data.add_lead_signal_point(lead_name, sx, sy, float(slice_signal[i]))

    return show_pulse, label_x


def render_extra_line_signal(ax, margin_px, y0, signal, config, duration_s,
                           impulse_width_s, TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV, IMG_WIDTH_PX,
                           row_index=None, layout=None, coord_data=None, lead_name=None, n_rows=None, n_cols=None):
    """
    Render signal for extra lines (full continuous rhythm strips) and capture coordinates

    The signal is always rendered at full duration, the pulse is placed before or after it.

    Args:
        ax: Matplotlib axes
        margin_px (float): Margin in pixels
        y0 (float): Y position in pixels
        signal (np.ndarray): Signal data
        config (dict): Configuration
        duration_s (float): Total duration in seconds
        impulse_width_s (float): Pulse width in seconds
        TIME_SCALE_PX_PER_S (float): Time scale in pixels per second
        AMP_SCALE_PX_PER_MV (float): Amplitude scale in pixels per millivolt
        IMG_WIDTH_PX (float): Image width in pixels
        row_index (int, optional): Row index (to determine if pulse should be shown)
        layout (list, optional): Complete layout
        coord_data (CoordinateData, optional): Object to capture signal coordinates
        lead_name (str, optional): Lead name for coordinate capture
        n_rows (int, optional): Total number of rows
        n_cols (int, optional): Total number of columns

    Returns:
        float: Label X position in pixels
    """
    # Determine if pulse should be displayed at this position
    # For extra lines, we consider we are at column 0
    show_pulse = False
    if n_rows is not None and n_cols is not None and row_index is not None:
        show_pulse = should_show_pulse_at_position(config, row_index, 0, n_rows, n_cols, is_extra_line=True)

    # Pulse parameters
    ref_pulse_config = config.get("reference_pulse", {})
    horizontal_pos = ref_pulse_config.get("horizontal_position_ref_pulse", "left")
    pulse_and_signal_space = ref_pulse_config.get("pulse_and_signal_space", False)
    signal_and_pulse_shift_mm = ref_pulse_config.get("signal_and_pulse_shift_mm", 0)

    # Calculate gap between pulse and signal (if configured)
    space_gap_px = MM_TO_PX if pulse_and_signal_space else 0
    impulse_width_px = impulse_width_s * TIME_SCALE_PX_PER_S

    # Signal is pre-cropped to duration_s by the caller (extra_samples = slice_samples * n_cols)
    # so len(signal) already matches the displayed duration -- no further crop needed (#29).
    # Remove DC offset so isoelectric baseline aligns with y0 (#62)
    centering = config.get("signal_centering", "median")
    if centering == "min_max":
        baseline = (np.min(signal) + np.max(signal)) / 2
    elif centering == "mean":
        baseline = np.mean(signal)
    else:
        baseline = np.median(signal)
    signal = signal - baseline
    time_axis = np.linspace(0, duration_s, len(signal))

    if show_pulse:
        # Generate pulse coordinates from config (variable shapes, optional lowpass)
        pulse_time, pulse_signal, _ = _generate_pulse_coords(
            ref_pulse_config, AMP_SCALE_PX_PER_MV, TIME_SCALE_PX_PER_S)

        # Pulse color: use config override or default to signal color
        pulse_color = ref_pulse_config.get("pulse_color") or config["signal_color"]

        # Determine pulse position for extra lines
        if horizontal_pos == "left":
            pulse_x_start = margin_px - impulse_width_px - space_gap_px
            signal_x_start = margin_px
        elif horizontal_pos == "middle":
            pulse_x_start = margin_px
            signal_x_start = margin_px + impulse_width_px + space_gap_px
        else:  # right
            signal_x_start = margin_px
            signal_width_px = duration_s * TIME_SCALE_PX_PER_S
            pulse_x_start = signal_x_start + signal_width_px + space_gap_px

        # Draw pulse
        pulse_x_arr = pulse_x_start + np.array(pulse_time) * TIME_SCALE_PX_PER_S
        pulse_y_arr = y0 + np.array(pulse_signal) * AMP_SCALE_PX_PER_MV
        ax.plot(
            pulse_x_arr, pulse_y_arr,
            color=pulse_color,
            linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
            antialiased=config.get("signal_antialiased", False)
        )

        # Record pulse coordinates for mask generation
        if coord_data is not None and lead_name is not None:
            pulse_key = f"pulse_{lead_name}_extra"
            for px, py in zip(pulse_x_arr, pulse_y_arr):
                coord_data.add_reference_pulse_point(pulse_key, float(px), float(py))

        # Draw signal
        ax.plot(
            signal_x_start + time_axis * TIME_SCALE_PX_PER_S,
            y0 + signal * AMP_SCALE_PX_PER_MV,
            color=config["signal_color"],
            linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
            antialiased=config.get("signal_antialiased", False)
        )

        signal_x_coords = signal_x_start + time_axis * TIME_SCALE_PX_PER_S

    else:
        # No pulse - render signal normally
        ax.plot(
            margin_px + time_axis * TIME_SCALE_PX_PER_S,
            y0 + signal * AMP_SCALE_PX_PER_MV,
            color=config["signal_color"],
            linewidth=_px_to_linewidth(config.get("signal_line_width", 1)),
            antialiased=config.get("signal_antialiased", False)
        )
        signal_x_coords = margin_px + time_axis * TIME_SCALE_PX_PER_S

    # Label position (should always match signal_x_start)
    if show_pulse:
        if horizontal_pos == "left":
            # Signal at margin_px, pulse in negative space
            label_x = margin_px
        elif horizontal_pos == "middle":
            # Signal is shifted right to make room for pulse
            label_x = margin_px + impulse_width_px + space_gap_px
        else:  # right
            # Signal at margin_px, pulse after
            label_x = margin_px
    else:
        # No pulse, signal at margin_px
        label_x = margin_px

    # Capture signal coordinates for mask generation (EXCLUDE pulse coordinates)
    if coord_data is not None and lead_name is not None:
        signal_y = y0 + signal * AMP_SCALE_PX_PER_MV
        for i, (sx, sy) in enumerate(zip(signal_x_coords, signal_y)):
            coord_data.add_lead_signal_point(lead_name, sx, sy, float(signal[i]))

    return label_x
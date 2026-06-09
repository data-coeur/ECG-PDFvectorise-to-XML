"""
Signal rendering and lead-label text positioning.

Trimmed to what the fixed config exercises:
- a single reference pulse at ``vertical_position_ref_pulse`` on the right
  side of its column (``horizontal_position_ref_pulse = "right"``)
- median-centered signal baselines
- default pulse shape (0.04 rise, 0.20 plateau, 0.04 fall)

Alternative pulse positions (``"left"`` / ``"middle"``), per-column duration
overrides (``_per_col_*``), and the multi-pulse variants
(``"one_column"`` / ``"two_columns"``) are unreachable from this repo's
config and have been removed.
"""

import numpy as np

from ecg_generator.config.constants import MM_TO_PX, DPI


def _generate_pulse_coords(ref_pulse_config, AMP_SCALE_PX_PER_MV):
    """Generate calibration pulse (time, amplitude) coordinates."""
    rise_s, plateau_s, fall_s = ref_pulse_config.get("pulse_shape", (0.04, 0.20, 0.04))
    total_s = rise_s + plateau_s + fall_s

    signal_and_pulse_shift_mm = ref_pulse_config.get("signal_and_pulse_shift_mm", 0)
    gain_mm_per_mV = AMP_SCALE_PX_PER_MV / MM_TO_PX
    vertical_offset_mV = signal_and_pulse_shift_mm / gain_mm_per_mV

    pulse_time = [0.0, rise_s, rise_s, rise_s + plateau_s,
                  rise_s + plateau_s, total_s]
    pulse_signal_raw = [0, 0, 1, 1, 0, 0]
    pulse_signal = [v + vertical_offset_mV for v in pulse_signal_raw]

    return pulse_time, pulse_signal, total_s


def _px_to_linewidth(px):
    """Convert a desired pixel width to matplotlib linewidth (points)."""
    return px * 72.0 / DPI


def should_show_pulse_at_position(config, row_index, col_index, n_cols, is_extra_line=False):
    """Return True when a single reference pulse belongs at (row_index, col_index).

    Uses ``vertical_position_ref_pulse`` (1-indexed) to pick the row and
    ``horizontal_position_ref_pulse`` to pick the column. Only the ``"one"``
    flavor of ``number_of_ref_pulse`` is supported.
    """
    ref_pulse_config = config.get("reference_pulse", {})
    number_of_ref_pulse = ref_pulse_config.get("number_of_ref_pulse")
    if number_of_ref_pulse != "one":
        return False

    vertical_pos = ref_pulse_config.get("vertical_position_ref_pulse")
    if vertical_pos is None:
        return False
    target_row = vertical_pos - 1

    if is_extra_line:
        # Rhythm strips span full width; horizontal placement is resolved by
        # render_extra_line_signal via horizontal_position_ref_pulse.
        return row_index == target_row

    horizontal_pos = ref_pulse_config.get("horizontal_position_ref_pulse")
    if horizontal_pos == "left":
        target_col = 0
    elif horizontal_pos == "middle":
        target_col = n_cols // 2
    else:  # "right" (default) — also covers unknown values
        target_col = n_cols - 1
    return row_index == target_row and col_index == target_col


def calculate_text_position(base_x, base_y, text_formatting, signal_width_px=None):
    """Resolve the lead-label position from ``spacing_lead_text``."""
    final_y = base_y + text_formatting["lead_text_shift"] * MM_TO_PX

    x_position = text_formatting["spacing_lead_text"]
    if x_position == -10:
        final_x = base_x - 10 * MM_TO_PX
    elif x_position == -5:
        final_x = base_x - 5 * MM_TO_PX
    elif x_position == 0:
        final_x = base_x
    elif x_position == 10:
        final_x = base_x + 10 * MM_TO_PX
    elif x_position == "centered":
        final_x = base_x + signal_width_px / 2 if signal_width_px else base_x
    else:
        final_x = base_x

    return final_x, final_y


def render_signal_with_pulse(ax, x0, y0, signal, config, slice_samples, j,
                             segment_width_px, impulse_width_px,
                             TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV,
                             row_index=None, n_cols=None):
    """Render one signal column, with an optional pulse on its right edge.

    Returns ``(show_pulse, label_x)``. The reference pulse (when shown) is
    placed to the right of the signal, separated by ``pulse_gap_mm``.
    """
    start_idx = j * slice_samples
    end_idx = (j + 1) * slice_samples
    slice_signal = signal[start_idx:end_idx]

    # Median-centered baseline (robust to QRS peaks) — aligns isoelectric line with y0.
    slice_signal = slice_signal - np.median(signal)

    show_pulse = False
    if n_cols is not None and row_index is not None:
        show_pulse = should_show_pulse_at_position(config, row_index, j, n_cols, is_extra_line=False)

    ref_pulse_config = config.get("reference_pulse", {})
    pulse_and_signal_space = ref_pulse_config.get("pulse_and_signal_space", False)
    pulse_gap_mm = ref_pulse_config.get("pulse_gap_mm", 1)
    space_gap_px = pulse_gap_mm * MM_TO_PX if pulse_and_signal_space else 0

    antialiased = config.get("signal_antialiased", False)
    signal_lw = _px_to_linewidth(config.get("signal_line_width", 1))
    signal_color = config["signal_color"]

    if show_pulse:
        pulse_time, pulse_signal, _ = _generate_pulse_coords(ref_pulse_config, AMP_SCALE_PX_PER_MV)
        pulse_color = ref_pulse_config.get("pulse_color") or signal_color
        pulse_line_width = ref_pulse_config.get("pulse_line_width") or config.get("signal_line_width", 1)

        # Signal fills segment minus pulse width; pulse is placed after the signal.
        effective_signal_width = segment_width_px - impulse_width_px - space_gap_px
        if effective_signal_width < segment_width_px * 0.5:
            effective_signal_width = segment_width_px
        signal_duration = effective_signal_width / TIME_SCALE_PX_PER_S
        time_slice = np.linspace(0, signal_duration, len(slice_signal))
        pulse_x_start = x0 + effective_signal_width + space_gap_px

        ax.plot(
            x0 + time_slice * TIME_SCALE_PX_PER_S,
            y0 + slice_signal * AMP_SCALE_PX_PER_MV,
            color=signal_color, linewidth=signal_lw, antialiased=antialiased,
        )
        ax.plot(
            pulse_x_start + np.array(pulse_time) * TIME_SCALE_PX_PER_S,
            y0 + np.array(pulse_signal) * AMP_SCALE_PX_PER_MV,
            color=pulse_color, linewidth=_px_to_linewidth(pulse_line_width),
            antialiased=antialiased,
        )
    else:
        slice_duration = segment_width_px / TIME_SCALE_PX_PER_S
        time_slice = np.linspace(0, slice_duration, len(slice_signal))
        ax.plot(
            x0 + time_slice * TIME_SCALE_PX_PER_S,
            y0 + slice_signal * AMP_SCALE_PX_PER_MV,
            color=signal_color, linewidth=signal_lw, antialiased=antialiased,
        )

    # Label always stays with signal at x0.
    return show_pulse, x0


def render_extra_line_signal(ax, margin_px, y0, signal, config, duration_s,
                             TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV,
                             row_index=None, n_cols=None):
    """Render a rhythm strip (full-width continuous signal) with optional pulse on the right."""
    show_pulse = False
    if n_cols is not None and row_index is not None:
        show_pulse = should_show_pulse_at_position(config, row_index, 0, n_cols, is_extra_line=True)

    ref_pulse_config = config.get("reference_pulse", {})
    pulse_and_signal_space = ref_pulse_config.get("pulse_and_signal_space", False)
    pulse_gap_mm = ref_pulse_config.get("pulse_gap_mm", 1)
    space_gap_px = pulse_gap_mm * MM_TO_PX if pulse_and_signal_space else 0

    # Signal is pre-cropped by the caller; len(signal) already matches duration_s.
    signal = signal - np.median(signal)
    time_axis = np.linspace(0, duration_s, len(signal))

    antialiased = config.get("signal_antialiased", False)
    signal_lw = _px_to_linewidth(config.get("signal_line_width", 1))
    signal_color = config["signal_color"]

    if show_pulse:
        pulse_time, pulse_signal, _ = _generate_pulse_coords(ref_pulse_config, AMP_SCALE_PX_PER_MV)
        pulse_color = ref_pulse_config.get("pulse_color") or signal_color
        pulse_line_width = ref_pulse_config.get("pulse_line_width") or config.get("signal_line_width", 1)

        signal_x_start = margin_px
        signal_width_px = duration_s * TIME_SCALE_PX_PER_S
        pulse_x_start = signal_x_start + signal_width_px + space_gap_px

        ax.plot(
            pulse_x_start + np.array(pulse_time) * TIME_SCALE_PX_PER_S,
            y0 + np.array(pulse_signal) * AMP_SCALE_PX_PER_MV,
            color=pulse_color, linewidth=_px_to_linewidth(pulse_line_width),
            antialiased=antialiased,
        )
        ax.plot(
            signal_x_start + time_axis * TIME_SCALE_PX_PER_S,
            y0 + signal * AMP_SCALE_PX_PER_MV,
            color=signal_color, linewidth=signal_lw, antialiased=antialiased,
        )
    else:
        ax.plot(
            margin_px + time_axis * TIME_SCALE_PX_PER_S,
            y0 + signal * AMP_SCALE_PX_PER_MV,
            color=signal_color, linewidth=signal_lw, antialiased=antialiased,
        )

    # Label position: always at the signal start (margin_px).
    return margin_px

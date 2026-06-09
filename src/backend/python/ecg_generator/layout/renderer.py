"""
ECG layout rendering functions

Main rendering engine that handles signal positioning, grid generation, and
lead labels for the single supported configuration (full_grid, 6x2+1, solid
grid, line_10mm separators, no medical text / reference pulse variants).
"""

import random

from ecg_generator.config.constants import (
    IMG_WIDTH_PX, IMG_HEIGHT_PX, MM_TO_PX, TIME_SCALE_MM_PER_S,
)
from ecg_generator.rendering.grid import (
    generate_ecg_grid_background, draw_separation_styles)
from ecg_generator.rendering.signal import (
    calculate_text_position, render_signal_with_pulse, render_extra_line_signal)
from ecg_generator.layout.figure_utils import create_standard_figure, CoordinateData


def _add_lead_label(coord_data, config, final_x, final_y, lead, ha):
    """Queue a lead label for PIL deferred rendering."""
    tf = config["text_formatting"]
    # Convert lead_text_size (mm) to pixel size for PIL.
    base_size_px = tf["lead_text_size"] * MM_TO_PX
    size_factor = tf.get("font_size_factor", 1.0)
    size_px = base_size_px * size_factor

    font_family = tf.get("font_family", "DejaVuSans")
    font_bold = tf.get("font_bold", True)
    font_italic = tf.get("font_italic", False)
    color = tf.get("lead_text_color", "black")

    coord_data.add_deferred_text(
        final_x, final_y, lead, int(size_px),
        color=color, font_family=font_family,
        bold=font_bold, italic=font_italic,
        ha=ha, va='bottom', category='label'
    )


def _check_and_adjust_horizontal_spacing(config, n_cols, segment_width_px, signal_area_width, impulse_width_px):
    """
    Reduce ``horizontal_spacing_mm`` so signals + spacing + right-side pulse fit
    within ``signal_area_width``. Returns the adjusted spacing (mm).
    """
    current_spacing_mm = config.get("horizontal_spacing_mm", 0)
    current_spacing_px = current_spacing_mm * MM_TO_PX

    base_width_px = n_cols * segment_width_px
    total_spacing_px = (n_cols - 1) * current_spacing_px if n_cols > 1 else 0

    # Pulse is always positioned on the right of its column, adding extra width.
    ref_pulse_config = config.get("reference_pulse", {})
    pulse_and_signal_space = ref_pulse_config.get("pulse_and_signal_space", False)
    pulse_gap_mm = ref_pulse_config.get("pulse_gap_mm", 1)
    space_gap_px = pulse_gap_mm * MM_TO_PX if pulse_and_signal_space else 0
    extra_pulse_width = impulse_width_px + space_gap_px if ref_pulse_config.get("number_of_ref_pulse") else 0

    total_width_needed = base_width_px + total_spacing_px + extra_pulse_width

    if total_width_needed > signal_area_width:
        if n_cols > 1:
            max_spacing_px = (signal_area_width - base_width_px - extra_pulse_width) / (n_cols - 1)
            max_spacing_px = max(0, max_spacing_px)
            max_spacing_mm = max_spacing_px / MM_TO_PX
            config["horizontal_spacing_mm"] = max_spacing_mm
            return max_spacing_mm
        config["horizontal_spacing_mm"] = 0
        return 0

    return current_spacing_mm


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

            signal = leads_data_noisy[original_lead]

            if is_extra_line:
                # Extra lines - signal cropped to displayed duration (rhythm strips)
                # Only render once per row (j == 0) to avoid duplicate rendering.
                if j == 0:
                    # Crop signal to displayed duration (handles non-standard speeds)
                    extra_samples = slice_samples * n_cols
                    extra_signal = signal[:extra_samples] if extra_samples < len(signal) else signal
                    label_x = render_extra_line_signal(
                        ax, signal_area_x_start, y0, extra_signal, config, duration_s,
                        TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV,
                        i, n_cols,
                    )

                    base_y = y0 - 5 * MM_TO_PX
                    signal_width = signal_area_width
                    final_x, final_y = calculate_text_position(label_x, base_y, config["text_formatting"], signal_width)
                    ha = 'center' if config["text_formatting"]["spacing_lead_text"] == "centered" else 'left'

                    _add_lead_label(coord_data, config, final_x, final_y, lead, ha)

                # Extra lines don't need cumulative_x updates (they span full width)
            else:
                # Standard leads - segmented signals
                col_width = segment_width_px
                show_pulse, label_x = render_signal_with_pulse(
                    ax, x0, y0, signal, config, slice_samples, j,
                    col_width, impulse_width_px,
                    TIME_SCALE_PX_PER_S, AMP_SCALE_PX_PER_MV, i,
                    n_cols,
                )

                base_y = y0 - 5 * MM_TO_PX
                signal_width = col_width + horizontal_spacing_px
                final_x, final_y = calculate_text_position(label_x, base_y, config["text_formatting"], signal_width)
                ha = 'center' if config["text_formatting"]["spacing_lead_text"] == "centered" else 'left'

                _add_lead_label(coord_data, config, final_x, final_y, lead, ha)

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
                    sep_cumulative_x += segment_width_px

                    # Place separator in the middle of the spacing
                    sep_x = sep_cumulative_x + horizontal_spacing_px / 2

                    # Add remaining spacing for next iteration
                    sep_cumulative_x += horizontal_spacing_px

                    y_baseline = y_bottom
                    color = config.get("separation_color", "black")
                    draw_separation_styles(ax, sep_x, y_baseline, style, color)


def render_ecg_layout(leads_data_noisy, layout, config, inverse_mapping,
                      page_width_px=None, page_height_px=None,
                      signal_area_x_start_override=None,
                      signal_area_y_start_override=None,
                      signal_area_width_override=None,
                      signal_area_height_override=None):
    """Render the full ECG page to a matplotlib figure.

    Returns ``(fig, ax, coord_data)``. ``coord_data.deferred_texts`` carries
    lead-label text items that the caller flushes to PIL after saving.

    When the four ``signal_area_*_override`` arguments are provided, the
    renderer uses them verbatim and skips its internal margin computation,
    pulse-on-left shift, spacing-reduction guards, and height-reduction path.
    All four must be supplied together. The default A4 path is preserved when
    they are all None.
    """
    overrides = (
        signal_area_x_start_override, signal_area_y_start_override,
        signal_area_width_override, signal_area_height_override,
    )
    override_mode = any(v is not None for v in overrides)
    if override_mode and not all(v is not None for v in overrides):
        raise ValueError(
            "render_ecg_layout: signal_area_*_override arguments must all be "
            "provided together (got partial overrides)."
        )

    n_rows = len(layout)
    n_cols = len(layout[0])

    # Extract page dimensions from config or parameters
    page_width_px = page_width_px or config.get("page_width_px", IMG_WIDTH_PX)
    page_height_px = page_height_px or config.get("page_height_px", IMG_HEIGHT_PX)

    # Optional per-line / background overrides. When absent (standard
    # random_config path), these stay None and behavior matches prior versions.
    background_color = config.get("background_color")
    minor_grid_color = config.get("minor_grid_color")
    major_grid_color = config.get("major_grid_color")

    fig, ax = create_standard_figure(transparent=False, page_width_px=page_width_px, page_height_px=page_height_px,
                                     background_color=background_color)
    coord_data = CoordinateData()

    # === GRID GENERATION ===
    major_style, minor_style = config["grid_style"]

    # In override mode, anchor major grid lines on the signal x-start so a
    # major line lands exactly there regardless of canvas width.
    grid_x_origin = signal_area_x_start_override if override_mode else None

    generate_ecg_grid_background(
        ax, grid_color=config["grid_color"], major_style=major_style, minor_style=minor_style,
        page_width_px=page_width_px, page_height_px=page_height_px,
        minor_grid_color=minor_grid_color, major_grid_color=major_grid_color,
        x_origin=grid_x_origin,
    )

    # === SIGNAL POSITIONING AREA ===
    if override_mode:
        signal_area_x_start = signal_area_x_start_override
        signal_area_y_start = signal_area_y_start_override
        signal_area_width = signal_area_width_override
        signal_area_height = signal_area_height_override
        # top_margin / margin_px only used in the (now-skipped) auto-reduce path.
        top_margin = 0
        margin_px = 0
    else:
        margin_px = 10 * MM_TO_PX
        x_offset_px = config.get("signal_x_offset_mm", 0) * MM_TO_PX

        top_margin = 10 * MM_TO_PX
        bottom_margin = 5 * MM_TO_PX
        signal_area_x_start = margin_px + x_offset_px
        signal_area_y_start = page_height_px - top_margin - margin_px
        signal_area_y_end = bottom_margin + margin_px
        signal_area_width = page_width_px - 2 * margin_px - x_offset_px
        signal_area_height = signal_area_y_start - signal_area_y_end

    # Temporal parameters
    source_duration_s = 10  # Source XML always has 10s of data
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
    if not override_mode and ref_pulse_cfg.get("horizontal_position_ref_pulse") == "left":
        pulse_gap_mm = ref_pulse_cfg.get("pulse_gap_mm", 1)
        space_gap_px = pulse_gap_mm * MM_TO_PX if ref_pulse_cfg.get("pulse_and_signal_space", False) else 0
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
    slice_duration_source = source_duration_s / n_cols
    # Subtract horizontal spacing from available width so signals don't overflow
    horiz_spacing_total_px = 0
    if n_cols > 1:
        horiz_spacing_total_px = (n_cols - 1) * config.get("horizontal_spacing_mm", 0) * MM_TO_PX
    available_per_col_px = (signal_area_width - horiz_spacing_total_px) / n_cols
    max_slice_duration = available_per_col_px / TIME_SCALE_PX_PER_S
    slice_duration = min(slice_duration_source, max_slice_duration)

    duration_s = slice_duration * n_cols

    # Segment widths
    segment_width_px = TIME_SCALE_PX_PER_S * slice_duration

    # Adjust slice_samples to match displayed duration
    samples_per_second = total_samples / source_duration_s
    slice_samples = int(slice_duration * samples_per_second)

    # Check and adjust horizontal spacing for all grid layouts
    # This ensures signals don't overflow horizontally outside the grid bounds.
    # In override mode, compute_canvas_layout has already sized everything to fit
    # exactly, so we skip both shrink paths to avoid mutating the caller's config.
    if not override_mode:
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

    row_height_px = config["vertical_spacing_mm"] * MM_TO_PX
    min_spacing_px = 10 * MM_TO_PX  # Minimum spacing for readability

    # Auto-adjust spacing to fit in available height. Skipped in override mode
    # because compute_canvas_layout has already sized the canvas to fit.
    if not override_mode:
        total_height_needed = (n_rows - 1) * row_height_px
        available_height = signal_area_height

        if total_height_needed > available_height:
            row_height_px = available_height / n_rows
            if row_height_px < min_spacing_px:
                row_height_px = min_spacing_px
                required_height = n_rows * min_spacing_px
                missing_height = required_height - signal_area_height
                if top_margin > 0:
                    min_top_margin = 5 * MM_TO_PX
                    adjusted_top_margin = max(min_top_margin, top_margin - missing_height)
                    signal_area_y_start = page_height_px - adjusted_top_margin - margin_px
                    signal_area_y_end = bottom_margin + margin_px
                    signal_area_height = signal_area_y_start - signal_area_y_end

    # === PRE-COMPUTE RANDOM VERTICAL OFFSETS PER ROW ===
    if "_row_vertical_offsets_px" not in config:
        vertical_offset_max_mm = config.get("vertical_offset_max_mm", 0.0)
        if vertical_offset_max_mm > 0:
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
    _render_standard_layout(
        ax, layout, leads_data_noisy, config, inverse_mapping, coord_data,
        signal_area_x_start, signal_area_y_start, signal_area_width,
        segment_width_px, impulse_width_px, impulse_width_s, duration_s,
        slice_samples, row_height_px, n_rows, n_cols,
    )

    return fig, ax, coord_data
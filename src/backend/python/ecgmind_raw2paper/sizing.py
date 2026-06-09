"""Compute dynamic canvas dimensions and signal anchors from signal extents.

Replaces the fixed-A4 model: the canvas is grown only as much as needed for the
actual rendered content plus the user-specified margins (3 mm top, 2 mm right,
1 mm bottom inside the strip area, 5 mm left).

Grid alignment with the signal start is preserved by anchoring the major grid
lines on the signal x-start (see ``generate_ecg_grid_background`` ``x_origin``),
so canvas dimensions can stay exact (no rounding to a 5 mm multiple).
"""

import math
from dataclasses import dataclass

import numpy as np

from ecg_generator.config.constants import MM_TO_PX


@dataclass
class CanvasLayout:
    canvas_width_px: int
    canvas_height_px: int
    signal_area_x_start_px: float
    signal_area_y_start_px: float
    signal_area_width_px: float
    signal_area_height_px: float


def _row_amplitude_extent(row, leads_data, inverse_mapping, slice_samples, n_cols, side):
    """Return the max amplitude (mV) of `row`'s rendered slices on the given side.

    `side` is "top" (max above the baseline) or "bottom" (max below the baseline,
    expressed as a positive number). Mirrors how `signal.py` median-centers slices
    against the median of the full source signal.
    """
    is_extra = len(row) > 1 and len(set(row)) == 1
    extents = []
    if is_extra:
        labels_to_render = [(0, row[0])]
        full_extra = True
    else:
        labels_to_render = list(enumerate(row))
        full_extra = False

    for j, label in labels_to_render:
        original = inverse_mapping.get(label, label)
        sig = leads_data.get(original)
        if sig is None:
            continue
        med = np.median(sig)
        if full_extra:
            end = min(slice_samples * n_cols, len(sig))
            window = sig[:end] - med
        else:
            start = j * slice_samples
            end = min((j + 1) * slice_samples, len(sig))
            if start >= end:
                continue
            window = sig[start:end] - med
        if side == "top":
            extents.append(max(0.0, float(np.max(window))))
        else:
            extents.append(max(0.0, float(-np.min(window))))
    return max(extents) if extents else 0.0


def compute_canvas_layout(leads_data, layout, config, inverse_mapping,
                          has_text, has_logo,
                          logo_target_height_px=90,
                          source_duration_s=10.0):
    """Compute the dynamic canvas dimensions and the renderer anchor points.

    Args:
        leads_data: dict of original_lead_name -> ndarray (full source signal).
        layout: list of rows; each row is a list of display lead labels.
        config: validated render config.
        inverse_mapping: display label -> original lead name (renderer uses the
            same mapping at draw time).
        has_text: whether the bottom-left annotation strip will be drawn.
        has_logo: whether the bottom-right logo will be drawn.
        logo_target_height_px: height of the strip when present (defaults to the
            current 90 px ≈ 7.5 mm logo height).
        source_duration_s: duration of the source recording (always 10 s here).
    """
    n_rows = len(layout)
    n_cols = len(layout[0])

    speed_mm_per_s = config.get("speed_mm_per_s", 25)
    gain_mm_per_mV = config.get("gain_mm_per_mV", 10)
    speed_px_per_s = speed_mm_per_s * MM_TO_PX
    gain_px_per_mV = gain_mm_per_mV * MM_TO_PX

    horiz_spacing_px = config.get("horizontal_spacing_mm", 0) * MM_TO_PX
    vertical_spacing_mm = config.get("vertical_spacing_mm", 24)

    text_formatting = config.get("text_formatting", {})
    lead_text_shift_mm = text_formatting.get("lead_text_shift", 14)
    lead_text_size_mm = text_formatting.get("lead_text_size", 4)

    # --- Reference pulse geometry --------------------------------------------
    ref_pulse_cfg = config.get("reference_pulse", {}) or {}
    has_pulse = ref_pulse_cfg.get("number_of_ref_pulse") == "one"
    pulse_shape = ref_pulse_cfg.get("pulse_shape", (0.04, 0.20, 0.04))
    pulse_width_px = sum(pulse_shape) * speed_px_per_s if has_pulse else 0.0
    pulse_and_signal_space = ref_pulse_cfg.get("pulse_and_signal_space", False)
    pulse_gap_px = (
        ref_pulse_cfg.get("pulse_gap_mm", 1) * MM_TO_PX
        if (has_pulse and pulse_and_signal_space) else 0.0
    )
    pulse_position = ref_pulse_cfg.get("horizontal_position_ref_pulse", "right")

    # --- Horizontal extent (signal-data-independent) -------------------------
    # Mirrors renderer arithmetic so slice_samples below matches at draw time.
    slice_duration = source_duration_s / n_cols
    segment_width_px = speed_px_per_s * slice_duration
    signal_block_width_px = (
        n_cols * segment_width_px + (n_cols - 1) * horiz_spacing_px
    )

    left_inset_px = 5 * MM_TO_PX
    if has_pulse and pulse_position == "left":
        # Pulse sits between the 5 mm canvas margin and the signal start.
        left_inset_px += pulse_width_px + pulse_gap_px
    right_pad_px = 2 * MM_TO_PX

    # Rightmost rendered x. The pulse may extend PAST the signal block:
    #   - On a rhythm row, render_extra_line_signal places the pulse after the
    #     full-width signal (signal_x + n_cols*segment + gap + pulse_width).
    #   - On a standard row, render_signal_with_pulse normally squeezes the
    #     pulse inside segment_width — but if effective_signal_width drops below
    #     half segment_width (very high speed / short slice), it falls back to
    #     placing the pulse after segment_width too.
    signal_block_end_x = left_inset_px + signal_block_width_px
    rightmost_x = signal_block_end_x

    if has_pulse:
        vertical_pos = ref_pulse_cfg.get("vertical_position_ref_pulse")
        target_row_idx = (vertical_pos - 1) if vertical_pos is not None else -1
        pulse_target_is_extra = False
        if 0 <= target_row_idx < n_rows:
            target_row = layout[target_row_idx]
            pulse_target_is_extra = (
                len(target_row) > 1 and len(set(target_row)) == 1
            )

        if pulse_target_is_extra:
            # Rhythm-strip pulse: appended past the rhythm signal end.
            rhythm_signal_end_x = left_inset_px + n_cols * segment_width_px
            pulse_end_x = rhythm_signal_end_x + pulse_gap_px + pulse_width_px
            rightmost_x = max(rightmost_x, pulse_end_x)
        else:
            # Standard-row pulse: fits inside segment unless overflow fallback.
            effective = segment_width_px - pulse_width_px - pulse_gap_px
            if effective < segment_width_px * 0.5:
                rightmost_x = signal_block_end_x + pulse_gap_px + pulse_width_px

    canvas_width_px = rightmost_x + right_pad_px

    # --- Slice samples (must mirror renderer) --------------------------------
    sample_lead = next(iter(leads_data.values()))
    total_samples = len(sample_lead)
    samples_per_second = total_samples / source_duration_s
    slice_samples = int(slice_duration * samples_per_second)

    # --- Top extent above row-0 baseline -------------------------------------
    signal_top_mV = _row_amplitude_extent(
        layout[0], leads_data, inverse_mapping, slice_samples, n_cols, "top",
    )
    signal_top_above_baseline_px = signal_top_mV * gain_px_per_mV
    # Label glyph top: base_y = y0 - 5 mm; final_y = base_y + lead_text_shift_mm;
    # va='bottom' so glyph top ≈ final_y + lead_text_size_mm.
    label_top_above_baseline_px = (
        (lead_text_shift_mm - 5 + lead_text_size_mm) * MM_TO_PX
    )
    top_extent_px = max(signal_top_above_baseline_px, label_top_above_baseline_px)

    # --- Bottom extent below last-row baseline -------------------------------
    signal_bottom_mV = _row_amplitude_extent(
        layout[-1], leads_data, inverse_mapping, slice_samples, n_cols, "bottom",
    )
    signal_bottom_below_baseline_px = signal_bottom_mV * gain_px_per_mV

    # --- Bottom strip --------------------------------------------------------
    bottom_strip_height_px = (
        float(logo_target_height_px) if (has_text or has_logo) else 0.0
    )

    # --- Vertical totals -----------------------------------------------------
    vertical_span_px = (n_rows - 1) * vertical_spacing_mm * MM_TO_PX
    top_margin_px = 3 * MM_TO_PX
    gap_above_strip_px = 2 * MM_TO_PX if bottom_strip_height_px > 0 else 0.0
    bottom_margin_px = 1 * MM_TO_PX

    canvas_height_px = (
        top_margin_px
        + top_extent_px
        + vertical_span_px
        + signal_bottom_below_baseline_px
        + gap_above_strip_px
        + bottom_strip_height_px
        + bottom_margin_px
    )

    # Keep canvas dims exact (no rounding). Grid alignment with the signal
    # x-start is handled by passing x_origin to generate_ecg_grid_background.
    canvas_width_px = int(math.ceil(canvas_width_px))
    canvas_height_px = int(math.ceil(canvas_height_px))

    # --- Anchor points returned to the renderer ------------------------------
    signal_area_x_start_px = left_inset_px
    row_0_baseline_y_px = canvas_height_px - top_margin_px - top_extent_px
    # The renderer subtracts a hardcoded 5 mm initial_shift to get row 0's
    # baseline, so we hand it back row_0_baseline + 5 mm.
    signal_area_y_start_px = row_0_baseline_y_px + 5 * MM_TO_PX
    # Generous height: the renderer's auto-reduce-spacing path triggers only if
    # (n_rows - 1) * row_height > signal_area_height; this comfortably exceeds
    # that threshold and override mode skips the path anyway.
    signal_area_height_px = (
        vertical_span_px + signal_bottom_below_baseline_px + 5 * MM_TO_PX
    )

    return CanvasLayout(
        canvas_width_px=canvas_width_px,
        canvas_height_px=canvas_height_px,
        signal_area_x_start_px=signal_area_x_start_px,
        signal_area_y_start_px=signal_area_y_start_px,
        signal_area_width_px=signal_block_width_px,
        signal_area_height_px=signal_area_height_px,
    )

"""
ECG grid and separator rendering.

Trimmed to the single styling exercised by the repo:
- full-page solid/solid grid (1 mm minor, 5 mm major)
- ``line_10mm`` inter-column separator
"""

import math

import numpy as np

from ecg_generator.config.constants import IMG_WIDTH_PX, IMG_HEIGHT_PX, MM_TO_PX


def generate_ecg_grid_background(ax, grid_color, major_style, minor_style,
                                 page_width_px=None, page_height_px=None,
                                 minor_grid_color=None, major_grid_color=None,
                                 x_origin=None):
    """
    Draw a full-page ECG millimeter grid (solid 1 mm minor + 5 mm major lines).

    ``major_style`` / ``minor_style`` are accepted for config compatibility
    but must be ``"solid"``.

    When ``x_origin`` is given, major (5 mm) lines are anchored so that one of
    them passes exactly through ``x_origin`` instead of being centered. Minor
    lines are aligned to the same anchor. This lets the dynamic-canvas pipeline
    keep the signal start on a major grid line even when the canvas width is
    not a multiple of 5 mm. ``y`` direction is always centered.
    """
    width_px = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    height_px = page_height_px if page_height_px is not None else IMG_HEIGHT_PX

    minor_lw = 0.2
    minor_a = 0.4
    major_lw = 0.6
    major_a = 1.0

    minor_px = 1 * MM_TO_PX
    major_px = 5 * MM_TO_PX

    # X-direction grid positions
    if x_origin is not None:
        # Anchor: major lines pass through x_origin. Find the leftmost major
        # x in [0, major_px) that is congruent to x_origin modulo major_px.
        x_first_major = x_origin - math.floor(x_origin / major_px) * major_px
        major_x_arr = np.arange(x_first_major, width_px + 1, major_px)
        # Minor lines share the same lattice (since major_px = 5 * minor_px,
        # x_first_major mod minor_px == 0 whenever x_origin is a whole number
        # of mm; we still derive it explicitly to stay safe).
        x_first_minor = x_first_major - math.floor(x_first_major / minor_px) * minor_px
        minor_x_arr = np.arange(x_first_minor, width_px + 1, minor_px)
    else:
        # Centered (default A4 behavior).
        n_squares_x = int(width_px // major_px)
        grid_extent_x = n_squares_x * major_px
        x_offset = (width_px - grid_extent_x) / 2
        major_x_arr = np.arange(x_offset, x_offset + grid_extent_x + 1, major_px)
        minor_x_arr = np.arange(x_offset, x_offset + grid_extent_x, minor_px)

    # Y-direction grid positions (always centered)
    n_squares_y = int(height_px // major_px)
    grid_extent_y = n_squares_y * major_px
    y_offset = (height_px - grid_extent_y) / 2
    major_y_arr = np.arange(y_offset, y_offset + grid_extent_y + 1, major_px)
    minor_y_arr = np.arange(y_offset, y_offset + grid_extent_y + 1, minor_px)

    minor_color = minor_grid_color or grid_color
    major_color = major_grid_color or grid_color

    major_x_set = set(np.round(major_x_arr).astype(int))
    major_y_set = set(np.round(major_y_arr).astype(int))

    # Minor grid (1 mm), skipping positions that coincide with major lines.
    for x in minor_x_arr:
        if int(np.round(x)) not in major_x_set:
            ax.axvline(x=x, color=minor_color, linewidth=minor_lw, alpha=minor_a, antialiased=False)
    for y in minor_y_arr:
        if int(np.round(y)) not in major_y_set:
            ax.axhline(y=y, color=minor_color, linewidth=minor_lw, alpha=minor_a, antialiased=False)

    # Major grid (5 mm).
    for x in major_x_arr:
        ax.axvline(x=x, color=major_color, linewidth=major_lw, alpha=major_a, antialiased=False)
    for y in major_y_arr:
        ax.axhline(y=y, color=major_color, linewidth=major_lw, alpha=major_a, antialiased=False)


def draw_separation_styles(ax, sep_x, y_baseline, style, color):
    """Draw a column separator; only ``"line_10mm"`` is supported."""
    if style != "line_10mm":
        return
    length_px = 10 * MM_TO_PX
    ax.vlines(
        x=sep_x,
        ymin=y_baseline - length_px / 2,
        ymax=y_baseline + length_px / 2,
        colors=color,
        linewidth=1,
    )

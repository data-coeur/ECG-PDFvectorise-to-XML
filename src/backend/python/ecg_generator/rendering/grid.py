"""
ECG grid and separator generation functions

Generates millimeter-precision ECG grid backgrounds with configurable styles
(solid, dotted, dashed, points) for both major (5mm) and minor (1mm) grid lines.
Supports full-page and clipped grid layouts for text zone margins.
"""

import numpy as np
import matplotlib.colors as mcolors
from ecg_generator.config.constants import IMG_WIDTH_PX, IMG_HEIGHT_PX, MM_TO_PX, DPI


def _color_to_bgra(hex_color):
    """Convert hex/named color to (B, G, R, A) uint8 tuple for cv2."""
    r, g, b = [int(c * 255) for c in mcolors.to_rgb(hex_color)]
    return (b, g, r)


def _shift_color(hex_color, shift):
    """Shift an RGB hex color by a signed integer per channel, clamped to [0,255].

    Args:
        hex_color (str): Base color as hex string (e.g. "#cc0000") or named color.
        shift (int): Signed per-channel shift (positive = darker for light colors,
                     negative = lighter).

    Returns:
        str: Shifted hex color "#RRGGBB".
    """
    r, g, b = [int(c * 255) for c in mcolors.to_rgb(hex_color)]
    r = max(0, min(255, r + shift))
    g = max(0, min(255, g + shift))
    b = max(0, min(255, b + shift))
    return f"#{r:02x}{g:02x}{b:02x}"


def generate_ecg_grid_background(ax, grid_color, major_style, minor_style, coord_data=None, page_width_px=None, page_height_px=None, double_grid=None, grid_line_params=None):
    """
    Generate full-page ECG millimeter grid background and capture intersections

    Args:
        ax (matplotlib.axes.Axes): Axes to draw on
        grid_color (str): Grid line color
        major_style (str): Major grid line style - "solid", "dashed", "dotted", or "dots"
        minor_style (str): Minor grid line style - "solid", "dashed", "dotted", or "dots"
        coord_data (CoordinateData, optional): Object to capture grid intersections for mask generation
        page_width_px (int, optional): Page width in pixels (default: A4 width)
        page_height_px (int, optional): Page height in pixels (default: A4 height)
        grid_line_params (dict, optional): Line widths and alphas (#55, #58).
            Keys: minor_linewidth, minor_alpha, major_linewidth, major_alpha

    Returns:
        list: Grid intersection coordinates [(x, y), ...] if coord_data is None, else None
    """
    # Use custom dimensions or fall back to A4
    width_px = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    height_px = page_height_px if page_height_px is not None else IMG_HEIGHT_PX

    # Grid line parameters (#55, #58, #91)
    glp = grid_line_params or {}
    minor_lw = glp.get('minor_linewidth', 0.2)
    minor_a = glp.get('minor_alpha', 0.4)
    major_lw = glp.get('major_linewidth', 0.6)
    major_a = glp.get('major_alpha', 1.0)
    aa = glp.get('antialiased', False)

    # Convert matplotlib linewidth (pt) to pixel thickness for cv2 AA path
    px_per_pt = DPI / 72.0
    minor_thick_px = max(1, int(round(minor_lw * px_per_pt)))
    major_thick_px = max(1, int(round(major_lw * px_per_pt)))

    minor_px = 1 * MM_TO_PX  # 1mm spacing
    major_px = 5 * MM_TO_PX  # 5mm spacing

    # Major grid = complete 5mm squares only; minor grid extends to page edges
    n_squares_x = int(width_px // major_px)
    n_squares_y = int(height_px // major_px)
    grid_extent_x = n_squares_x * major_px
    grid_extent_y = n_squares_y * major_px

    # Center grid horizontally and vertically (#66)
    x_offset = (width_px - grid_extent_x) / 2
    y_offset = (height_px - grid_extent_y) / 2

    # Minor line positions: two sets —
    #   draw_minor_x/y: positions matplotlib can render (used for axvline/axhline)
    #   all_minor_x/y:  full set including page edge (used for NPZ/masks)
    draw_minor_x = np.arange(x_offset, x_offset + grid_extent_x, minor_px)
    all_minor_x = np.arange(x_offset, x_offset + grid_extent_x + 1, minor_px)
    all_minor_y = np.arange(y_offset, y_offset + grid_extent_y + 1, minor_px)
    major_x_positions = set(np.round(np.arange(x_offset, x_offset + grid_extent_x + 1, major_px)).astype(int))
    major_y_positions = set(np.round(np.arange(y_offset, y_offset + grid_extent_y + 1, major_px)).astype(int))

    # Helper: store line for cv2 AA post-processing or draw with matplotlib
    color_bgr = _color_to_bgra(grid_color)

    def _draw_line(x1, y1, x2, y2, lw_pt, alpha, thick_px, style=None):
        if aa and style is None and thick_px % 2 == 0 and coord_data is not None:
            # Solid lines ≥2px with AA → post-process rendering (#91)
            coord_data.aa_grid_lines.append({
                'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
                'color_bgr': color_bgr, 'thickness_px': thick_px, 'alpha': alpha,
            })
        elif x1 == x2:  # vertical
            kwargs = dict(color=grid_color, linewidth=lw_pt, alpha=alpha, antialiased=False)
            if style: kwargs['linestyle'] = style
            ax.axvline(x=x1, **kwargs)
        else:  # horizontal
            kwargs = dict(color=grid_color, linewidth=lw_pt, alpha=alpha, antialiased=False)
            if style: kwargs['linestyle'] = style
            ax.axhline(y=y1, **kwargs)

    # Draw minor grid lines (1mm) — extends to page edges (renderable positions only)
    if minor_style == "solid":  # Solid lines
        for x in draw_minor_x:
            if int(np.round(x)) not in major_x_positions:
                _draw_line(x, 0, x, height_px, minor_lw, minor_a, minor_thick_px)
        for y in all_minor_y:
            if int(np.round(y)) not in major_y_positions:
                _draw_line(0, y, width_px, y, minor_lw, minor_a, minor_thick_px)
    elif minor_style == "dashed":  # Dotted lines
        for x in draw_minor_x:
            if int(np.round(x)) not in major_x_positions:
                ax.axvline(x=x, color=grid_color, linewidth=minor_lw, alpha=minor_a, linestyle=':', antialiased=aa)
        for y in all_minor_y:
            if int(np.round(y)) not in major_y_positions:
                ax.axhline(y=y, color=grid_color, linewidth=minor_lw, alpha=minor_a, linestyle=':', antialiased=aa)
    elif minor_style == "dotted":  # Dashed lines
        for x in draw_minor_x:
            if int(np.round(x)) not in major_x_positions:
                ax.axvline(x=x, color=grid_color, linewidth=minor_lw, alpha=minor_a, linestyle='--', antialiased=aa)
        for y in all_minor_y:
            if int(np.round(y)) not in major_y_positions:
                ax.axhline(y=y, color=grid_color, linewidth=minor_lw, alpha=minor_a, linestyle='--', antialiased=aa)
    elif minor_style == "dots":  # Point markers
        for x in draw_minor_x:
            for y in all_minor_y:
                x_int = int(np.round(x))
                y_int = int(np.round(y))
                if x_int not in major_x_positions and y_int not in major_y_positions:
                    ax.plot(x, y, 'o', color=grid_color, markersize=1.0, alpha=1.0,
                            markerfacecolor=grid_color, markeredgewidth=0, antialiased=aa)

    # Draw major grid lines (5mm) within complete grid squares
    major_x_range = np.arange(x_offset, x_offset + grid_extent_x + 1, major_px)
    major_y_range = np.arange(y_offset, y_offset + grid_extent_y + 1, major_px)
    if major_style == "solid":  # Solid lines
        for x in major_x_range:
            _draw_line(x, 0, x, height_px, major_lw, major_a, major_thick_px)
        for y in major_y_range:
            _draw_line(0, y, width_px, y, major_lw, major_a, major_thick_px)
    elif major_style == "dashed":  # Dotted lines
        for x in major_x_range:
            ax.axvline(x=x, color=grid_color, linewidth=major_lw, alpha=major_a, linestyle=':', antialiased=aa)
        for y in major_y_range:
            ax.axhline(y=y, color=grid_color, linewidth=major_lw, alpha=major_a, linestyle=':', antialiased=aa)
    elif major_style == "dotted":  # Dashed lines
        for x in major_x_range:
            ax.axvline(x=x, color=grid_color, linewidth=major_lw, alpha=major_a, linestyle='--', antialiased=aa)
        for y in major_y_range:
            ax.axhline(y=y, color=grid_color, linewidth=major_lw, alpha=major_a, linestyle='--', antialiased=aa)
    elif major_style == "dots":  # Point markers
        for x in major_x_range:
            for y in major_y_range:
                ax.plot(x, y, 'o', color=grid_color, markersize=2.5, alpha=1.0, markerfacecolor=grid_color,
                        markeredgewidth=0, antialiased=aa)

    # === DOUBLE GRID OVERLAY (issue #10) ===
    if double_grid is not None:
        overlay_x = major_x_range
        overlay_y = major_y_range
        _draw_double_grid_overlay(ax, double_grid, grid_color, overlay_x, overlay_y, full_page=True, aa=aa)

    # Capture grid line positions and intersections for mask generation / NPZ
    # Major grid = complete 5mm squares; minor grid extends to page edges
    grid_intersections = []
    major_x_arr = np.arange(x_offset, x_offset + grid_extent_x + 1, major_px)
    major_y_arr = np.arange(y_offset, y_offset + grid_extent_y + 1, major_px)
    minor_x_arr = np.array([x for x in all_minor_x
                            if int(np.round(x)) not in major_x_positions])
    minor_y_arr = np.array([y for y in all_minor_y
                            if int(np.round(y)) not in major_y_positions])

    for x in major_x_arr:
        for y in major_y_arr:
            intersection = (x, y)
            grid_intersections.append(intersection)

            if coord_data is not None:
                coord_data.add_grid_intersection(x, y)

    if coord_data is not None:
        coord_data.set_grid_line_positions(
            major_x=major_x_arr, major_y=major_y_arr,
            minor_x=minor_x_arr, minor_y=minor_y_arr,
            x_range=(0.0, float(width_px)),
            y_range=(0.0, float(height_px))
        )

    if coord_data is None:
        return grid_intersections


def generate_ecg_grid_background_clipped(ax, grid_color, major_style, minor_style, dimensions, coord_data=None, double_grid=None, grid_line_params=None):
    """
    Generate ECG grid background in a specific area (for layouts with text zones)

    Used for "with_text_zones" layout where grid is confined to a central area
    with margins for patient/medical text.

    Args:
        ax (matplotlib.axes.Axes): Axes to draw on
        grid_color (str): Grid line color
        major_style (str): Major grid line style - "solid", "dashed", "dotted", or "dots"
        minor_style (str): Minor grid line style - "solid", "dashed", "dotted", or "dots"
        dimensions (dict): Grid zone dimensions with keys: grid_x_start, grid_y_start, grid_width, grid_height
        coord_data (CoordinateData, optional): Object to capture grid intersections for mask generation
        grid_line_params (dict, optional): Line widths and alphas (#55, #58)

    Returns:
        list: Grid intersection coordinates [(x, y), ...] if coord_data is None, else None
    """
    x_start = dimensions["grid_x_start"]
    y_start = dimensions["grid_y_start"]
    width = dimensions["grid_width"]
    height = dimensions["grid_height"]

    # Grid line parameters (#55, #58, #91)
    glp = grid_line_params or {}
    minor_lw = glp.get('minor_linewidth', 0.2)
    minor_a = glp.get('minor_alpha', 0.4)
    major_lw = glp.get('major_linewidth', 0.6)
    major_a = glp.get('major_alpha', 1.0)
    aa = glp.get('antialiased', False)

    minor_px = 1 * MM_TO_PX
    major_px = 5 * MM_TO_PX

    # Anti-aliasing: shift grid by 0.5px (#91)
    aa_shift = 0.5 if aa else 0.0

    # Grid covers only complete 5mm squares within clipped area
    n_squares_x = int(width // major_px)
    n_squares_y = int(height // major_px)
    grid_width = n_squares_x * major_px
    grid_height = n_squares_y * major_px

    # Calculate major line positions within clipped area (complete squares)
    major_x_positions = set(np.round(np.arange(x_start, x_start + grid_width + 1, major_px) + aa_shift).astype(int))
    major_y_positions = set(np.round(np.arange(y_start, y_start + grid_height + 1, major_px) + aa_shift).astype(int))

    # Draw minor grid lines (1mm) within complete grid squares
    x_end = x_start + grid_width
    y_end = y_start + grid_height
    if minor_style == "solid":  # Solid lines
        for x in np.arange(x_start, x_end + 1, minor_px) + aa_shift:
            if int(np.round(x)) not in major_x_positions:
                ax.plot([x, x], [y_start, y_end], color=grid_color, linewidth=minor_lw, alpha=minor_a,
                        antialiased=aa)
        for y in np.arange(y_start, y_end + 1, minor_px) + aa_shift:
            if int(np.round(y)) not in major_y_positions:
                ax.plot([x_start, x_end], [y, y], color=grid_color, linewidth=minor_lw, alpha=minor_a,
                        antialiased=aa)
    elif minor_style == "dashed":  # Dotted lines
        for x in np.arange(x_start, x_end + 1, minor_px) + aa_shift:
            if int(np.round(x)) not in major_x_positions:
                ax.plot([x, x], [y_start, y_end], color=grid_color, linewidth=minor_lw, alpha=minor_a,
                        linestyle=':', antialiased=aa)
        for y in np.arange(y_start, y_end + 1, minor_px) + aa_shift:
            if int(np.round(y)) not in major_y_positions:
                ax.plot([x_start, x_end], [y, y], color=grid_color, linewidth=minor_lw, alpha=minor_a,
                        linestyle=':', antialiased=aa)
    elif minor_style == "dotted":  # Dashed lines
        for x in np.arange(x_start, x_end + 1, minor_px) + aa_shift:
            if int(np.round(x)) not in major_x_positions:
                ax.plot([x, x], [y_start, y_end], color=grid_color, linewidth=minor_lw, alpha=minor_a,
                        linestyle='--', antialiased=aa)
        for y in np.arange(y_start, y_end + 1, minor_px) + aa_shift:
            if int(np.round(y)) not in major_y_positions:
                ax.plot([x_start, x_end], [y, y], color=grid_color, linewidth=minor_lw, alpha=minor_a,
                        linestyle='--', antialiased=aa)
    elif minor_style == "dots":  # Point markers
        for x in np.arange(x_start, x_end + 1, minor_px) + aa_shift:
            for y in np.arange(y_start, y_end + 1, minor_px) + aa_shift:
                x_int = int(np.round(x))
                y_int = int(np.round(y))
                if x_int not in major_x_positions and y_int not in major_y_positions:
                    ax.plot(x, y, 'o', color=grid_color, markersize=1.0, alpha=1.0,
                            markerfacecolor=grid_color, markeredgewidth=0, antialiased=aa)

    # Draw major grid lines (5mm) within complete squares + border outline at grid boundary
    if major_style == "solid":  # Solid lines
        for x in np.arange(x_start, x_end + 1, major_px) + aa_shift:
            ax.plot([x, x], [y_start, y_end], color=grid_color, linewidth=major_lw, alpha=major_a, antialiased=aa)
        for y in np.arange(y_start, y_end + 1, major_px) + aa_shift:
            ax.plot([x_start, x_end], [y, y], color=grid_color, linewidth=major_lw, alpha=major_a, antialiased=aa)
    elif major_style == "dashed":  # Dotted lines
        for x in np.arange(x_start, x_end + 1, major_px) + aa_shift:
            ax.plot([x, x], [y_start, y_end], color=grid_color, linewidth=major_lw, alpha=major_a, linestyle=':', antialiased=aa)
        for y in np.arange(y_start, y_end + 1, major_px) + aa_shift:
            ax.plot([x_start, x_end], [y, y], color=grid_color, linewidth=major_lw, alpha=major_a, linestyle=':', antialiased=aa)
    elif major_style == "dotted":  # Dashed lines
        for x in np.arange(x_start, x_end + 1, major_px) + aa_shift:
            ax.plot([x, x], [y_start, y_end], color=grid_color, linewidth=major_lw, alpha=major_a, linestyle='--', antialiased=aa)
        for y in np.arange(y_start, y_end + 1, major_px) + aa_shift:
            ax.plot([x_start, x_end], [y, y], color=grid_color, linewidth=major_lw, alpha=major_a, linestyle='--', antialiased=aa)
    elif major_style == "dots":  # Point markers
        for x in np.arange(x_start, x_end + 1, major_px) + aa_shift:
            for y in np.arange(y_start, y_end + 1, major_px) + aa_shift:
                ax.plot(x, y, 'o', color=grid_color, markersize=2.5, alpha=1.0, markerfacecolor=grid_color,
                        markeredgewidth=0, antialiased=aa)

    # === DOUBLE GRID OVERLAY (issue #10) ===
    if double_grid is not None:
        overlay_x = np.arange(x_start, x_end + 1, major_px) + aa_shift
        overlay_y = np.arange(y_start, y_end + 1, major_px) + aa_shift
        _draw_double_grid_overlay(ax, double_grid, grid_color, overlay_x, overlay_y,
                                  x_start=x_start, y_start=y_start, x_end=x_end, y_end=y_end, aa=aa)

    # Capture grid line positions and intersections within complete squares
    grid_intersections = []
    major_x_arr = np.arange(x_start, x_end + 1, major_px)
    major_y_arr = np.arange(y_start, y_end + 1, major_px)
    minor_x_arr = np.array([xv for xv in np.arange(x_start, x_end + 1, minor_px)
                            if int(np.round(xv)) not in major_x_positions])
    minor_y_arr = np.array([yv for yv in np.arange(y_start, y_end + 1, minor_px)
                            if int(np.round(yv)) not in major_y_positions])

    for x in major_x_arr:
        for y in major_y_arr:
            intersection = (x, y)
            grid_intersections.append(intersection)

            if coord_data is not None:
                coord_data.add_grid_intersection(x, y)

    if coord_data is not None:
        coord_data.set_grid_line_positions(
            major_x=major_x_arr, major_y=major_y_arr,
            minor_x=minor_x_arr, minor_y=minor_y_arr,
            x_range=(float(x_start), float(x_end)),
            y_range=(float(y_start), float(y_end))
        )

    if coord_data is None:
        return grid_intersections


def _draw_double_grid_overlay(ax, double_grid, base_color, major_x_positions_arr, major_y_positions_arr,
                              x_start=None, y_start=None, x_end=None, y_end=None, full_page=False, aa=False):
    """Draw super-major grid lines (every N-th major line) for double-grid effect.

    Real ECG machines often print a three-level hierarchy: 1 mm minor, 5 mm major,
    and 10 mm or 15 mm super-major lines that are thicker/darker.  Only every
    ``every_n``-th major line gets the heavy overlay (e.g. every 2nd = 10 mm,
    every 3rd = 15 mm).

    Args:
        ax: Matplotlib axes.
        double_grid (dict): {"every_n", "color_shift", "major_linewidth", "major_alpha"}.
        base_color (str): Base grid color to shift.
        major_x_positions_arr (ndarray): X positions of ALL major grid lines (5 mm spacing).
        major_y_positions_arr (ndarray): Y positions of ALL major grid lines (5 mm spacing).
        x_start, y_start, x_end, y_end: Bounds for clipped drawing (None = full page).
        full_page (bool): If True, use axvline/axhline (faster for full-page grids).
    """
    overlay_color = _shift_color(base_color, double_grid["color_shift"])
    lw = double_grid["major_linewidth"]
    alpha = double_grid["major_alpha"]
    every_n = double_grid.get("every_n", 2)

    # Select only every N-th major line (0-indexed from grid origin)
    super_x = major_x_positions_arr[::every_n]
    super_y = major_y_positions_arr[::every_n]

    if full_page:
        for x in super_x:
            ax.axvline(x=x, color=overlay_color, linewidth=lw, alpha=alpha, antialiased=aa)
        for y in super_y:
            ax.axhline(y=y, color=overlay_color, linewidth=lw, alpha=alpha, antialiased=aa)
    else:
        for x in super_x:
            ax.plot([x, x], [y_start, y_end], color=overlay_color, linewidth=lw, alpha=alpha,
                    antialiased=aa)
        for y in super_y:
            ax.plot([x_start, x_end], [y, y], color=overlay_color, linewidth=lw, alpha=alpha,
                    antialiased=aa)


def draw_vertical_separator(ax, x_pos, style):
    """
    Draw a vertical separator line

    Args:
        ax (matplotlib.axes.Axes): Axes to draw on
        x_pos (float): X-position of separator in pixels
        style (str): Separator style - "none" (none), "solid" (solid), "dashed" (dotted), or "dotted" (dashed)
    """
    if style == "none":
        return
    if style == "solid":
        ax.axvline(x=x_pos, color='black', linewidth=1)
    elif style == "dashed":
        ax.axvline(x=x_pos, color='black', linestyle=':', linewidth=1)
    elif style == "dotted":
        ax.axvline(x=x_pos, color='black', linestyle='--', linewidth=1)


def draw_separation_styles(ax, sep_x, y_baseline, y_bottom_sep, y_top_sep, style, color):
    """
    Draw column separation lines with various styles

    Supports full-height separators and centered separators of various lengths (5mm, 10mm, 20mm, etc.)
    positioned around the signal baseline.

    Args:
        ax (matplotlib.axes.Axes): Axes to draw on
        sep_x (float): X-position of separator in pixels
        y_baseline (float): Signal baseline Y-position in pixels
        y_bottom_sep (float): Bottom Y-coordinate for full-height separators
        y_top_sep (float): Top Y-coordinate for full-height separators
        style (str): Separation style (e.g., "solid", "line_10mm", "double_line_3mm", etc.)
        color (str): Separator line color
    """
    if not style:
        return

    # Full-height separators
    elif style in ["solid", "dashed", "dotted"]:
        ax.vlines(
            x=sep_x,
            ymin=y_bottom_sep,
            ymax=y_top_sep,
            colors=color,
            linewidth=1,
            linestyles={
                'solid': '-',
                'dashed': ':',
                'dotted': '--'
            }.get(style, '-')
        )

    # Centered separators with specific lengths (centered on baseline)
    elif style == "line_10mm":
        length_px = 10 * MM_TO_PX
        ax.vlines(x=sep_x, ymin=y_baseline - length_px/2, ymax=y_baseline + length_px/2, colors=color, linewidth=1)

    elif style == "line_5mm":
        length_px = 5 * MM_TO_PX
        ax.vlines(x=sep_x, ymin=y_baseline - length_px/2, ymax=y_baseline + length_px/2, colors=color, linewidth=1)

    elif style == "line_20mm":
        length_px = 20 * MM_TO_PX
        ax.vlines(x=sep_x, ymin=y_baseline - length_px/2, ymax=y_baseline + length_px/2, colors=color, linewidth=1)

    elif style == "thick_line_3mm":
        length_px = 3 * MM_TO_PX
        ax.vlines(x=sep_x, ymin=y_baseline - length_px/2, ymax=y_baseline + length_px/2, colors=color, linewidth=2)

    elif style == "dashes_10mm":
        length_px = 10 * MM_TO_PX
        ax.vlines(x=sep_x, ymin=y_baseline - length_px/2, ymax=y_baseline + length_px/2, colors=color, linewidth=1, linestyles='--')

    elif style == "dashes_25mm":
        length_px = 25 * MM_TO_PX
        ax.vlines(x=sep_x, ymin=y_baseline - length_px/2, ymax=y_baseline + length_px/2, colors=color, linewidth=1, linestyles='--')

    elif style == "double_line_3mm":  # Two 3mm lines above/below baseline with 3mm gap
        length_px = 3 * MM_TO_PX
        gap_px = 3 * MM_TO_PX
        ax.vlines(x=sep_x, ymin=y_baseline + gap_px/2, ymax=y_baseline + gap_px/2 + length_px, colors=color, linewidth=1)
        ax.vlines(x=sep_x, ymin=y_baseline - gap_px/2 - length_px, ymax=y_baseline - gap_px/2, colors=color, linewidth=1)

    elif style == "quad_line_3mm":  # Four 3mm lines (2 pairs above/below baseline)
        length_px = 3 * MM_TO_PX
        gap_between_pairs = 3 * MM_TO_PX  # Gap between top/bottom pairs
        gap_within_pair = 1 * MM_TO_PX    # 1mm gap between parallel lines in each pair

        # Top pair (above baseline)
        y_top_start = y_baseline + gap_between_pairs/2
        y_top_end = y_top_start + length_px
        ax.vlines(x=sep_x - gap_within_pair/2, ymin=y_top_start, ymax=y_top_end, colors=color, linewidth=1)
        ax.vlines(x=sep_x + gap_within_pair/2, ymin=y_top_start, ymax=y_top_end, colors=color, linewidth=1)

        # Bottom pair (below baseline)
        y_bottom_end = y_baseline - gap_between_pairs/2
        y_bottom_start = y_bottom_end - length_px
        ax.vlines(x=sep_x - gap_within_pair/2, ymin=y_bottom_start, ymax=y_bottom_end, colors=color, linewidth=1)
        ax.vlines(x=sep_x + gap_within_pair/2, ymin=y_bottom_start, ymax=y_bottom_end, colors=color, linewidth=1)

    # Vectracor style — thick solid full-height line (#59)
    elif style == "solid_thick":
        ax.vlines(
            x=sep_x,
            ymin=y_bottom_sep,
            ymax=y_top_sep,
            colors=color,
            linewidth=2.0,
            linestyles='-'
        )
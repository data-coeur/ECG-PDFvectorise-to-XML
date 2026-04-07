"""
Unified mask generator from NPZ data.

Generates PNG masks from the unified NPZ format.
Works for both Pipeline 1 and Pipeline 2 data.

Mask types:
  - Grid major: intersections + horizontal lines + vertical lines (1px)
  - Grid minor: same for 1mm grid
  - Grid intersections: standalone intersection points only (no lines)
  - Signal per channel: 1px Bresenham lines or sample points
  - Label centers: 1px per label center
  - All signals combined

Blur options (default 0 = 1px exact):
  - mask_point_radius: pyramidal blur for grid intersection points (circular)
  - mask_signal_radius_x/y: pyramidal blur for signal points (elliptic)
  When radius > 0: linear decay from 255 at center to 0 at edge.
  Output: PNG uint8 (0-255). Center pixel always = 255.
"""

import os
import numpy as np
from PIL import Image, ImageDraw
import cv2
import logging

from shared.npz_schema import (
    SIGNAL_PREFIX, get_signal_keys, load_unified_npz,
    KEY_GRID_MAJOR_X, KEY_GRID_MAJOR_Y,
    KEY_GRID_MINOR_X, KEY_GRID_MINOR_Y,
    KEY_GRID_X_RANGE, KEY_GRID_Y_RANGE,
    KEY_GRID_MAJOR_5MM, KEY_GRID_MINOR_1MM,
    KEY_LABEL_CENTERS, KEY_LABEL_NAMES,
    KEY_MAP_FORWARD_X, KEY_MAP_FORWARD_Y,
    KEY_PAGE_WIDTH, KEY_PAGE_HEIGHT,
    KEY_APPLIED_AUGS,
)
from shared.map_utils import decode_map_float

logger = logging.getLogger(__name__)

KEY_MAP_INVERSE_X = 'map_inverse_x'
KEY_MAP_INVERSE_Y = 'map_inverse_y'


def generate_p2_masks_remap(p2_npz_path, p1_mask_dir, output_dir, options=None):
    """
    Generate P2 masks by warping P1 masks through the inverse map (cv2.remap).

    This produces smooth, anti-aliased masks that perfectly match the augmented
    image geometry — same transform, same interpolation.

    Args:
        p2_npz_path: path to P2 NPZ file (contains inverse map)
        p1_mask_dir: directory containing P1 mask PNGs
        output_dir: directory to save P2 mask PNGs
        options: dict with optional overrides (currently unused, reserved)

    Returns:
        dict of {mask_name: output_path}
    """
    data = load_unified_npz(str(p2_npz_path))
    os.makedirs(output_dir, exist_ok=True)

    p2_w = int(data[KEY_PAGE_WIDTH])
    p2_h = int(data[KEY_PAGE_HEIGHT])

    # Build P2-sized inverse map from the forward map.
    # Forward map is at P1 dims: fwd[y_p1, x_p1] = (x_p2, y_p2).
    # We need inverse at P2 dims: inv[y_p2, x_p2] = (x_p1, y_p1).
    # Strategy: scatter every P1 pixel to its P2 position, then fill gaps
    # with iterative dilation so neighboring pixels inherit correct values.
    enc_ver = int(data.get('map_encoding_version', 1))
    fwd_x = decode_map_float(data[KEY_MAP_FORWARD_X], encoding_version=enc_ver)
    fwd_y = decode_map_float(data[KEY_MAP_FORWARD_Y], encoding_version=enc_ver)
    p1_h, p1_w = fwd_x.shape

    inv_x = np.full((p2_h, p2_w), np.nan, dtype=np.float32)
    inv_y = np.full((p2_h, p2_w), np.nan, dtype=np.float32)

    # Scatter P1→P2
    yy, xx = np.mgrid[0:p1_h, 0:p1_w]
    dst_x = np.round(fwd_x).astype(np.int32).ravel()
    dst_y = np.round(fwd_y).astype(np.int32).ravel()
    src_x = xx.ravel().astype(np.float32)
    src_y = yy.ravel().astype(np.float32)
    valid = (dst_x >= 0) & (dst_x < p2_w) & (dst_y >= 0) & (dst_y < p2_h)
    inv_x[dst_y[valid], dst_x[valid]] = src_x[valid]
    inv_y[dst_y[valid], dst_x[valid]] = src_y[valid]

    # Fill gaps: iterative blur+merge (fast, preserves float precision)
    unfilled = np.isnan(inv_x)
    if np.any(unfilled):
        # Replace NaN with 0 for blurring, then iteratively fill
        inv_x_fill = np.where(unfilled, 0.0, inv_x)
        inv_y_fill = np.where(unfilled, 0.0, inv_y)
        weight = (~unfilled).astype(np.float32)
        kernel = np.ones((3, 3), dtype=np.float32)
        for _ in range(5):
            sum_x = cv2.filter2D(inv_x_fill, -1, kernel, borderType=cv2.BORDER_REPLICATE)
            sum_y = cv2.filter2D(inv_y_fill, -1, kernel, borderType=cv2.BORDER_REPLICATE)
            sum_w = cv2.filter2D(weight, -1, kernel, borderType=cv2.BORDER_REPLICATE)
            new_filled = (sum_w > 0) & unfilled
            if not np.any(new_filled):
                break
            inv_x_fill[new_filled] = sum_x[new_filled] / sum_w[new_filled]
            inv_y_fill[new_filled] = sum_y[new_filled] / sum_w[new_filled]
            weight[new_filled] = 1.0
            unfilled = unfilled & ~new_filled
        inv_x = inv_x_fill
        inv_y = inv_y_fill
    # Any remaining NaN → -1 (maps to border=0)
    inv_x = np.nan_to_num(inv_x, nan=-1.0)
    inv_y = np.nan_to_num(inv_y, nan=-1.0)

    results = {}

    # Warp each P1 mask PNG through the inverse map
    if not os.path.isdir(p1_mask_dir):
        logger.warning(f"P1 mask dir not found: {p1_mask_dir}")
        return results

    for mask_file in sorted(os.listdir(p1_mask_dir)):
        if not mask_file.endswith('.png'):
            continue
        # Skip multiclass (it's regenerated downstream from individual masks)
        if 'multiclass' in mask_file:
            continue

        p1_path = os.path.join(p1_mask_dir, mask_file)
        p1_arr = cv2.imread(p1_path, cv2.IMREAD_GRAYSCALE)
        if p1_arr is None:
            continue

        # cv2.remap: for each P2 pixel, fetch the P1 pixel at (inv_x, inv_y)
        # INTER_LINEAR gives smooth anti-aliased edges
        p2_arr = cv2.remap(p1_arr, inv_x, inv_y, cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_CONSTANT, borderValue=0)

        out_path = os.path.join(output_dir, mask_file)
        Image.fromarray(p2_arr).save(out_path, format='PNG', optimize=True,
                                     compress_level=9)
        results[mask_file] = out_path

    # Regenerate grid intersection points from NPZ coordinates (not remap).
    # 1px points don't survive bilinear remap (55%+ loss), so we render
    # directly from the P2-transformed coordinates stored in the NPZ.
    for key, fname in [(KEY_GRID_MAJOR_5MM, 'mask_grid_intersections.png')]:
        pts = data.get(key)
        if pts is not None and len(pts) > 0:
            # Also include minor intersections
            minor_pts = data.get(KEY_GRID_MINOR_1MM)
            if minor_pts is not None and len(minor_pts) > 0:
                pts = np.concatenate([pts, minor_pts], axis=0)
            mask_img = _render_points(pts, p2_w, p2_h)
            out_path = os.path.join(output_dir, fname)
            mask_img.save(out_path, format='PNG', optimize=True, compress_level=9)
            results[fname] = out_path

    # Generate combined masks that aren't in P1 but are expected
    # all_signals: OR of all per-lead signal masks
    sig_masks = [f for f in results if f.startswith('mask_signal_')]
    if sig_masks:
        combined = np.zeros((p2_h, p2_w), dtype=np.uint8)
        for sig_file in sig_masks:
            arr = cv2.imread(results[sig_file], cv2.IMREAD_GRAYSCALE)
            if arr is not None:
                combined = np.maximum(combined, arr)
        all_sig_path = os.path.join(output_dir, 'mask_all_signals.png')
        Image.fromarray(combined).save(all_sig_path, format='PNG', optimize=True,
                                       compress_level=9)
        results['mask_all_signals.png'] = all_sig_path

    # grid_combined: OR of major + minor
    major_path = results.get('mask_grid_major.png')
    minor_path = results.get('mask_grid_minor.png')
    if major_path and minor_path:
        major_arr = cv2.imread(major_path, cv2.IMREAD_GRAYSCALE)
        minor_arr = cv2.imread(minor_path, cv2.IMREAD_GRAYSCALE)
        if major_arr is not None and minor_arr is not None:
            comb_path = os.path.join(output_dir, 'mask_grid_combined.png')
            Image.fromarray(np.maximum(major_arr, minor_arr)).save(
                comb_path, format='PNG', optimize=True, compress_level=9)
            results['mask_grid_combined.png'] = comb_path

    logger.info(f"Generated {len(results)} P2 masks via remap in {output_dir}")
    return results


# Default mask generation options
DEFAULT_OPTIONS = {
    'signal_mode': 'lines',   # 'lines', 'points', or 'both'
    'grid_major': True,
    'grid_minor': True,
    'grid_interior': True,
    'grid_intersections': True,    # standalone intersection points mask (no lines)
    'signals': True,
    'labels': True,
    'all_signals': True,
    'grid_combined': True,         # combined major+minor grid mask
    # Blur radius for point masks (0 = 1px exact, >0 = pyramidal decay)
    'mask_point_radius': 0,        # grid intersections + label centers (circular)
    'mask_signal_radius_x': 0,     # signal sample points — x radius
    'mask_signal_radius_y': 0,     # signal sample points — y radius
    # Line widths for mask rendering (0 = use value from NPZ or default 1px)
    'mask_grid_line_width': 0,     # grid line width override (0 = 1px)
    'mask_signal_line_width': 0,   # signal line width override (0 = from NPZ)
    # Anti-aliasing: 'auto' = AA for P2 (geometric transforms), binary for P1
    # True = always AA, False = always binary
    'mask_antialiased': 'auto',
}


def generate_masks_from_npz(npz_path_or_data, output_dir, options=None):
    """
    Generate binary PNG masks from a unified NPZ file.

    Args:
        npz_path_or_data: path to .npz file, or pre-loaded dict
        output_dir: directory to save mask PNG files
        options: dict overriding DEFAULT_OPTIONS

    Returns:
        dict of {mask_name: output_path}
    """
    opts = dict(DEFAULT_OPTIONS)
    if options:
        opts.update(options)

    if isinstance(npz_path_or_data, (str, os.PathLike)):
        data = load_unified_npz(str(npz_path_or_data))
    else:
        data = npz_path_or_data

    os.makedirs(output_dir, exist_ok=True)

    width = int(data[KEY_PAGE_WIDTH])
    height = int(data[KEY_PAGE_HEIGHT])

    # Detect P2: check if forward map is non-identity
    is_p2 = KEY_APPLIED_AUGS in data
    fwd_x = fwd_y = None
    if is_p2 and KEY_MAP_FORWARD_X in data:
        # Forward map: P1→P2. Used to transform P1 grid/signal coordinates to P2 space.
        enc_ver = int(data.get('map_encoding_version', 1))
        fwd_x = decode_map_float(data[KEY_MAP_FORWARD_X], encoding_version=enc_ver)
        fwd_y = decode_map_float(data[KEY_MAP_FORWARD_Y], encoding_version=enc_ver)

    results = {}

    point_radius = opts.get('mask_point_radius', 0)
    sig_rx = opts.get('mask_signal_radius_x', 0)
    sig_ry = opts.get('mask_signal_radius_y', 0)

    # Anti-aliasing: resolve 'auto' based on pipeline
    aa_opt = opts.get('mask_antialiased', 'auto')
    use_aa = is_p2 if aa_opt == 'auto' else bool(aa_opt)

    # Grid line widths: sized to survive worst-case downscale (4.2:1).
    # At 3648→864 (smartphone), 5px→~1.2px, 2px→~0.5px (faint but present).
    grid_lw_override = int(opts.get('mask_grid_line_width', 0))
    grid_lw_major = grid_lw_override or 5
    grid_lw_minor = grid_lw_override or 2

    # Grid masks
    if opts['grid_major']:
        path = os.path.join(output_dir, 'mask_grid_major.png')
        _render_grid_mask(
            data[KEY_GRID_MAJOR_X], data[KEY_GRID_MAJOR_Y],
            data[KEY_GRID_X_RANGE], data[KEY_GRID_Y_RANGE],
            data.get(KEY_GRID_MAJOR_5MM),
            width, height, path, fwd_x, fwd_y,
            point_radius=point_radius, line_width=grid_lw_major, antialiased=use_aa)
        results['mask_grid_major.png'] = path

    if opts['grid_minor']:
        path = os.path.join(output_dir, 'mask_grid_minor.png')
        _render_grid_mask(
            data[KEY_GRID_MINOR_X], data[KEY_GRID_MINOR_Y],
            data[KEY_GRID_X_RANGE], data[KEY_GRID_Y_RANGE],
            data.get(KEY_GRID_MINOR_1MM),
            width, height, path, fwd_x, fwd_y,
            point_radius=point_radius, line_width=grid_lw_minor, antialiased=use_aa)
        results['mask_grid_minor.png'] = path

    # Grid interior mask (filled rectangle in P1, warped polygon in P2)
    if opts.get('grid_interior', True):
        path = os.path.join(output_dir, 'mask_grid_interior.png')
        # Compute grid bounding box from all line positions (major + minor)
        all_x = np.concatenate([data[KEY_GRID_MAJOR_X], data[KEY_GRID_MINOR_X]])
        all_y = np.concatenate([data[KEY_GRID_MAJOR_Y], data[KEY_GRID_MINOR_Y]])
        if len(all_x) > 0 and len(all_y) > 0:
            _render_grid_interior(
                float(all_x.min()), float(all_x.max()),
                float(all_y.min()), float(all_y.max()),
                width, height, path, fwd_x, fwd_y)
        else:
            Image.new('L', (width, height), 0).save(
                path, format='PNG', optimize=True, compress_level=9)
        results['mask_grid_interior.png'] = path

    # Combined grid mask (OR of major + minor)
    if opts['grid_combined'] and 'mask_grid_major.png' in results and 'mask_grid_minor.png' in results:
        combined_path = os.path.join(output_dir, 'mask_grid_combined.png')
        major_arr = np.array(Image.open(results['mask_grid_major.png']).convert('L'))
        minor_arr = np.array(Image.open(results['mask_grid_minor.png']).convert('L'))
        Image.fromarray(np.maximum(major_arr, minor_arr)).save(
            combined_path, format='PNG', optimize=True, compress_level=9)
        results['mask_grid_combined.png'] = combined_path

    # Grid intersection points only (no lines) — mirrors P1's mask_grid_only.png
    if opts.get('grid_intersections', True):
        intersections_path = os.path.join(output_dir, 'mask_grid_intersections.png')
        # Combine major (5mm) and minor (1mm) intersection points
        all_pts = []
        if data.get(KEY_GRID_MAJOR_5MM) is not None and len(data[KEY_GRID_MAJOR_5MM]) > 0:
            all_pts.append(data[KEY_GRID_MAJOR_5MM])
        if data.get(KEY_GRID_MINOR_1MM) is not None and len(data[KEY_GRID_MINOR_1MM]) > 0:
            all_pts.append(data[KEY_GRID_MINOR_1MM])

        if all_pts:
            pts = np.concatenate(all_pts, axis=0)
            # Transform through forward map for P2
            if fwd_x is not None:
                pts = _transform_points(pts, fwd_x, fwd_y, width, height)
            if point_radius > 0:
                mask = _render_points_blurred(pts - 0.5, width, height,
                                              point_radius, point_radius)
            else:
                mask = _render_points(pts, width, height)
            mask.save(intersections_path, format='PNG', optimize=True, compress_level=9)
        else:
            Image.new('L', (width, height), 0).save(
                intersections_path, format='PNG', optimize=True, compress_level=9)
        results['mask_grid_intersections.png'] = intersections_path

    # Signal masks
    if opts['signals']:
        signal_keys = get_signal_keys(data)
        all_signal_arr = np.zeros((height, width), dtype=np.uint8)
        # Signal line width: sized to survive worst-case downscale (4.2:1).
        # Minimum 5px so even a thin signal survives at smartphone resolution.
        sig_lw_override = int(opts.get('mask_signal_line_width', 0))
        config_width = int(data.get('signal_line_width_px', 1))
        line_width = sig_lw_override or max(config_width, 5)

        for sk in signal_keys:
            channel_name = sk[len(SIGNAL_PREFIX):]
            signal_data = data[sk]  # Nx3: (amp, x, y)
            coords = signal_data[:, 1:3]  # Nx2: (x, y)

            if opts['signal_mode'] in ('lines', 'both'):
                mask = _render_signal_lines(coords, width, height, line_width=line_width, antialiased=use_aa)
                path = os.path.join(output_dir, f'mask_signal_{channel_name}.png')
                mask.save(path, format='PNG', optimize=True, compress_level=9)
                results[f'mask_signal_{channel_name}.png'] = path
                all_signal_arr = np.maximum(all_signal_arr, np.array(mask))

            if opts['signal_mode'] in ('points', 'both'):
                if sig_rx > 0 or sig_ry > 0:
                    mask = _render_points_blurred(coords, width, height,
                                                  sig_rx, sig_ry)
                else:
                    mask = _render_points(coords, width, height)
                suffix = '_points' if opts['signal_mode'] == 'both' else ''
                path = os.path.join(output_dir, f'mask_signal_{channel_name}{suffix}.png')
                mask.save(path, format='PNG', optimize=True, compress_level=9)
                results[f'mask_signal_{channel_name}{suffix}.png'] = path
                if opts['signal_mode'] == 'points':
                    all_signal_arr = np.maximum(all_signal_arr, np.array(mask))

        if opts['all_signals']:
            path = os.path.join(output_dir, 'mask_all_signals.png')
            Image.fromarray(all_signal_arr).save(
                path, format='PNG', optimize=True, compress_level=9)
            results['mask_all_signals.png'] = path

    # Label centers mask
    if opts['labels'] and KEY_LABEL_CENTERS in data:
        coords = data[KEY_LABEL_CENTERS]
        if point_radius > 0:
            mask = _render_points_blurred(coords, width, height,
                                           point_radius, point_radius)
        else:
            mask = _render_points(coords, width, height)
        path = os.path.join(output_dir, 'mask_label_centers.png')
        mask.save(path, format='PNG', optimize=True, compress_level=9)
        results['mask_label_centers.png'] = path

    logger.info(f"Generated {len(results)} masks in {output_dir}")
    return results


# ─── Internal rendering functions ─────────────────────────────────────

def _transform_points(pts, fwd_x, fwd_y, width, height):
    """Transform Nx2 points from P1 space to P2 space via forward map lookup."""
    map_h, map_w = fwd_x.shape
    ix = np.clip(np.round(pts[:, 0]).astype(int), 0, map_w - 1)
    iy = np.clip(np.round(pts[:, 1]).astype(int), 0, map_h - 1)
    out_x = fwd_x[iy, ix]
    out_y = fwd_y[iy, ix]
    return np.column_stack([out_x, out_y])


def _render_points(coords, width, height):
    """Render Nx2 coordinates as 1px points.

    Uses int() floor to convert float coordinates to pixel indices.
    Grid/label coordinates include a +0.5 pixel-center offset, so
    floor maps them back to the correct pixel index.
    """
    mask = np.zeros((height, width), dtype=np.uint8)
    if coords.shape[0] == 0:
        return Image.fromarray(mask)

    x = coords[:, 0].astype(int)
    y = coords[:, 1].astype(int)
    valid = (x >= 0) & (x < width) & (y >= 0) & (y < height)
    mask[y[valid], x[valid]] = 255
    return Image.fromarray(mask)


def _render_points_blurred(coords, width, height, radius_x, radius_y):
    """Render Nx2 coordinates with pyramidal (linear) decay, sub-pixel centered.

    The blur cone is centered at the exact float coordinate.
    Floor pixel (same as _render_points at radius=0) always gets intensity=1.0.
    Decay is linear from 1.0 to 0 over `radius` normalized units beyond
    the floor pixel's distance from the float center.

    IMPORTANT: For grid/label coords that have a +0.5 pixel-center offset,
    callers should subtract 0.5 BEFORE calling this function so the blur
    centers on the integer pixel and is symmetric.

    Output: PIL Image uint8 (0-255).
    If both radii are 0, falls back to _render_points (1px exact).
    """
    if radius_x <= 0 and radius_y <= 0:
        return _render_points(coords, width, height)

    # Effective radii: at least 0.5 to avoid division by zero
    rx = max(radius_x, 0.5)
    ry = max(radius_y, 0.5)

    mask = np.zeros((height, width), dtype=np.float32)
    if coords.shape[0] == 0:
        return Image.fromarray(np.zeros((height, width), dtype=np.uint8))

    # Kernel window: +1 to account for sub-pixel offset
    kw = int(np.ceil(rx)) + 1
    kh = int(np.ceil(ry)) + 1

    for i in range(coords.shape[0]):
        # Float center (exact sub-pixel position)
        cx_f = float(coords[i, 0])
        cy_f = float(coords[i, 1])

        # Floor pixel (same as _render_points)
        cx_i = int(cx_f)
        cy_i = int(cy_f)

        # Pixel range to update (centered on floor pixel)
        px_min = max(0, cx_i - kw)
        px_max = min(width - 1, cx_i + kw)
        py_min = max(0, cy_i - kh)
        py_max = min(height - 1, cy_i + kh)

        if px_min > px_max or py_min > py_max:
            continue

        # Distance from float center to floor pixel (in normalized space)
        d_floor = np.sqrt(((cx_i - cx_f) / rx) ** 2 +
                          ((cy_i - cy_f) / ry) ** 2)

        # Distance from float center to each pixel in the window
        pxs = np.arange(px_min, px_max + 1, dtype=np.float32)
        pys = np.arange(py_min, py_max + 1, dtype=np.float32)
        dx = (pxs[np.newaxis, :] - cx_f) / rx  # (1, W_win)
        dy = (pys[:, np.newaxis] - cy_f) / ry  # (H_win, 1)
        d_norm = np.sqrt(dx * dx + dy * dy)     # (H_win, W_win)

        # Excess distance beyond the floor pixel's distance
        # Floor pixel: excess=0 → intensity=1.0
        # Pixels closer than floor: excess=0 → intensity=1.0 (capped)
        # Pixels further: linear decay from 1.0 to 0 over 1.0 normalized unit
        d_excess = np.maximum(0.0, d_norm - d_floor)
        intensity = np.maximum(0.0, 1.0 - d_excess)

        # Max-blend into the mask
        mask[py_min:py_max + 1, px_min:px_max + 1] = np.maximum(
            mask[py_min:py_max + 1, px_min:px_max + 1], intensity)

    # Convert to uint8: round(float * 255)
    result = np.round(mask * 255).astype(np.uint8)
    return Image.fromarray(result)


def _render_signal_lines(coords, width, height, line_width=1, antialiased=False):
    """
    Render signal trace as connected lines.

    When antialiased=False: PIL Bresenham (binary 0/255).
    When antialiased=True: cv2.LINE_AA (grayscale edges for smooth boundaries).

    Args:
        coords: Nx2 array of (x, y) pixel coordinates
        width: Image width
        height: Image height
        line_width: Line width in pixels (default 1)
        antialiased: Use anti-aliased rendering (default False)
    """
    if coords.shape[0] < 2:
        mask = Image.new('L', (width, height), 0)
        if coords.shape[0] == 1:
            return _render_points(coords, width, height)
        return mask

    if antialiased:
        arr = np.zeros((height, width), dtype=np.uint8)
        pts = np.round(coords).astype(np.int32)
        for i in range(len(pts) - 1):
            cv2.line(arr, (pts[i, 0], pts[i, 1]), (pts[i + 1, 0], pts[i + 1, 1]),
                     255, thickness=line_width, lineType=cv2.LINE_AA)
        return Image.fromarray(arr)
    else:
        mask = Image.new('L', (width, height), 0)
        draw = ImageDraw.Draw(mask)
        for i in range(coords.shape[0] - 1):
            x0, y0 = float(coords[i, 0]), float(coords[i, 1])
            x1, y1 = float(coords[i + 1, 0]), float(coords[i + 1, 1])
            draw.line([(x0, y0), (x1, y1)], fill=255, width=line_width)
        return mask


def _render_grid_mask(x_positions, y_positions, x_range, y_range,
                      intersections, width, height, save_path,
                      fwd_x=None, fwd_y=None, point_radius=0, line_width=1,
                      antialiased=False):
    """
    Render grid mask with intersections + horizontal + vertical lines.

    For P1 (fwd_x=None): draws straight lines directly.
    For P2 (fwd_x provided): transforms line points through forward map,
    then draws polylines.

    point_radius: 0 = 1px exact, >0 = pyramidal decay for intersection points.
    line_width: width of grid lines in pixels (default 1).
    antialiased: use cv2.LINE_AA for smooth edges (default False).
    """
    mask_arr = np.zeros((height, width), dtype=np.uint8)

    x_start, x_end = float(x_range[0]), float(x_range[1])
    y_start, y_end = float(y_range[0]), float(y_range[1])

    if fwd_x is None:
        # P1: straight lines
        _draw_grid_straight(mask_arr, x_positions, y_positions,
                            x_start, x_end, y_start, y_end, width, height,
                            line_width=line_width, antialiased=antialiased)
    else:
        # P2: transform through forward map
        _draw_grid_transformed(mask_arr, x_positions, y_positions,
                               x_start, x_end, y_start, y_end,
                               fwd_x, fwd_y, width, height,
                               line_width=line_width, antialiased=antialiased)

    # Draw intersections
    if intersections is not None and intersections.shape[0] > 0:
        if point_radius > 0:
            # Blurred pyramidal intersections
            # Subtract +0.5 pixel-center offset so blur centers on integer pixel
            grid_pts = intersections - 0.5
            blur_mask = _render_points_blurred(grid_pts, width, height,
                                               point_radius, point_radius)
            mask_arr = np.maximum(mask_arr, np.array(blur_mask))
        else:
            # 1px exact intersections — floor to match _render_points
            # (grid coords have +0.5 pixel-center offset, floor recovers pixel index)
            ix = intersections[:, 0].astype(int)
            iy = intersections[:, 1].astype(int)
            valid = (ix >= 0) & (ix < width) & (iy >= 0) & (iy < height)
            mask_arr[iy[valid], ix[valid]] = 255

    Image.fromarray(mask_arr).save(save_path, format='PNG', optimize=True, compress_level=9)


def _draw_grid_straight(mask_arr, x_positions, y_positions,
                        x_start, x_end, y_start, y_end, width, height,
                        line_width=1, antialiased=False):
    """Draw straight grid lines for P1 (identity map)."""
    y_s = max(0, int(round(y_start)))
    y_e = min(height - 1, int(round(y_end)))
    x_s = max(0, int(round(x_start)))
    x_e = min(width - 1, int(round(x_end)))
    line_type = cv2.LINE_AA if antialiased else cv2.LINE_8

    # Vertical lines
    for x_pos in x_positions:
        x = int(round(float(x_pos)))
        if 0 <= x < width:
            cv2.line(mask_arr, (x, y_s), (x, y_e), 255,
                     thickness=line_width, lineType=line_type)

    # Horizontal lines
    for y_pos in y_positions:
        y = int(round(float(y_pos)))
        if 0 <= y < height:
            cv2.line(mask_arr, (x_s, y), (x_e, y), 255,
                     thickness=line_width, lineType=line_type)


def _draw_grid_transformed(mask_arr, x_positions, y_positions,
                           x_start, x_end, y_start, y_end,
                           fwd_x, fwd_y, width, height, line_width=1,
                           antialiased=False):
    """
    Draw transformed grid lines for P2 using forward map lookup.

    For each grid line, generates dense points in P1 space,
    looks up their output positions via forward map,
    and draws the resulting polyline.
    """
    map_h, map_w = fwd_x.shape
    line_type = cv2.LINE_AA if antialiased else cv2.LINE_8

    # Vertical lines: for each x_pos, sample along y
    for x_pos in x_positions:
        xi = int(round(float(x_pos)))
        if xi < 0 or xi >= map_w:
            continue
        y_s = max(0, int(round(y_start)))
        y_e = min(map_h - 1, int(round(y_end)))
        if y_e <= y_s:
            continue

        # Lookup transformed positions
        ys = np.arange(y_s, y_e + 1)
        out_x = fwd_x[ys, xi]
        out_y = fwd_y[ys, xi]

        _draw_polyline_cv2(mask_arr, out_x, out_y, width, height,
                           line_width=line_width, line_type=line_type)

    # Horizontal lines: for each y_pos, sample along x
    for y_pos in y_positions:
        yi = int(round(float(y_pos)))
        if yi < 0 or yi >= map_h:
            continue
        x_s = max(0, int(round(x_start)))
        x_e = min(map_w - 1, int(round(x_end)))
        if x_e <= x_s:
            continue

        xs = np.arange(x_s, x_e + 1)
        out_x = fwd_x[yi, xs]
        out_y = fwd_y[yi, xs]

        _draw_polyline_cv2(mask_arr, out_x, out_y, width, height,
                           line_width=line_width, line_type=line_type)


def _draw_polyline_cv2(mask_arr, xs, ys, img_width, img_height,
                       line_width=1, line_type=cv2.LINE_8):
    """Draw a polyline from arrays of x, y coordinates using cv2 (supports AA)."""
    # Build polyline as Nx1x2 int32 array for cv2.polylines
    pts = np.column_stack([np.round(xs).astype(np.int32),
                           np.round(ys).astype(np.int32)])
    # Filter to segments at least partially inside the image
    valid = ((pts[:, 0] >= -img_width) & (pts[:, 0] < 2 * img_width) &
             (pts[:, 1] >= -img_height) & (pts[:, 1] < 2 * img_height))
    if not np.any(valid):
        return
    pts = pts.reshape((-1, 1, 2))
    cv2.polylines(mask_arr, [pts], isClosed=False, color=255,
                  thickness=line_width, lineType=line_type)


def _render_grid_interior(x_min, x_max, y_min, y_max,
                          width, height, save_path, fwd_x=None, fwd_y=None):
    """Render filled grid interior mask.

    P1: filled rectangle from grid bounding box.
    P2: sample the 4 edges densely through forward map, then fill the polygon.
    """
    mask = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(mask)

    if fwd_x is None:
        # P1: simple filled rectangle
        x0 = max(0, int(round(x_min)))
        y0 = max(0, int(round(y_min)))
        x1 = min(width - 1, int(round(x_max)))
        y1 = min(height - 1, int(round(y_max)))
        draw.rectangle([(x0, y0), (x1, y1)], fill=255)
    else:
        # P2: project grid boundary through forward map and fill polygon
        map_h, map_w = fwd_x.shape
        xi_min = max(0, int(round(x_min)))
        xi_max = min(map_w - 1, int(round(x_max)))
        yi_min = max(0, int(round(y_min)))
        yi_max = min(map_h - 1, int(round(y_max)))

        # Sample the 4 edges of the grid rectangle in P1 space
        # Top edge: y=yi_min, x from xi_min to xi_max
        top_xs = np.arange(xi_min, xi_max + 1)
        top_ox = fwd_x[yi_min, top_xs]
        top_oy = fwd_y[yi_min, top_xs]

        # Right edge: x=xi_max, y from yi_min to yi_max
        right_ys = np.arange(yi_min, yi_max + 1)
        right_ox = fwd_x[right_ys, xi_max]
        right_oy = fwd_y[right_ys, xi_max]

        # Bottom edge: y=yi_max, x from xi_max to xi_min (reversed)
        bot_xs = np.arange(xi_max, xi_min - 1, -1)
        bot_ox = fwd_x[yi_max, bot_xs]
        bot_oy = fwd_y[yi_max, bot_xs]

        # Left edge: x=xi_min, y from yi_max to yi_min (reversed)
        left_ys = np.arange(yi_max, yi_min - 1, -1)
        left_ox = fwd_x[left_ys, xi_min]
        left_oy = fwd_y[left_ys, xi_min]

        # Concatenate into closed polygon
        poly_x = np.concatenate([top_ox, right_ox[1:], bot_ox[1:], left_ox[1:]])
        poly_y = np.concatenate([top_oy, right_oy[1:], bot_oy[1:], left_oy[1:]])

        # Build polygon point list for Pillow
        poly_pts = [(float(px), float(py)) for px, py in zip(poly_x, poly_y)]
        if len(poly_pts) >= 3:
            draw.polygon(poly_pts, fill=255)

    mask.save(save_path, format='PNG', optimize=True, compress_level=9)

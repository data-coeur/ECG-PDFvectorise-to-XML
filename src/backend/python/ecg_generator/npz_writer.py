"""
NPZ output writer for Pipeline 1 (ECG generation).

Uses the unified NPZ schema from shared/npz_schema.py.
All coordinates are converted from matplotlib data space (y=0 at bottom)
to image space (y=0 at top) before saving.

Matplotlib coordinate mapping:
    figsize = (W + 0.5) / DPI ensures int(figsize * DPI) = W pixels exactly.
    The figure bbox is (W + 0.5) pixels wide, so transData has scale sx = (W+0.5)/W:
        display_x = x_data * sx,  display_y = y_data * sy
    Agg canvas row (y=0 at top): canvas_row = floor(H - y_data * sy)
    With BORDER_PAD=4 px transparent border: bordered pixel = canvas pixel + BORDER_PAD
        x_img = x_data * sx + 4
        y_img = H - y_data * sy + 4
"""

import json
import numpy as np
import os

from shared.npz_schema import save_unified_npz
from shared.map_utils import identity_maps_encoded

# Transparent border padding per side (px).
# Image structure: BORDER_PAD + canvas + 1 (edge grid) + BORDER_PAD
# Total addition per dimension: 2 * BORDER_PAD + 1
BORDER_PAD = 4


def save_pipeline1_npz(output_path, coord_data, config_dict, ecg_name,
                        layout=None, inverse_mapping=None):
    """
    Save Pipeline 1 NPZ in unified format.

    All coordinates are converted from matplotlib data space (y=0 at bottom)
    to image space (y=0 at top) before saving.

    Args:
        output_path: Path for the .npz file
        coord_data: CoordinateData object from rendering (matplotlib space)
        config_dict: ECG configuration dictionary
        ecg_name: Base name of the ECG (e.g., "ECG_031_01_p0")
        layout: 2D list of lead names as rendered (after nomenclature), optional
        inverse_mapping: dict mapping nomenclature names back to standard names, optional
    """
    data = {}

    # Original rendering dimensions (matplotlib canvas)
    render_w = config_dict.get('page_width_px', 3564)
    render_h = config_dict.get('page_height_px', 2520)

    # The P1 image has a symmetric border:
    #   BORDER_PAD px transparent + canvas + 1px edge grid + BORDER_PAD px transparent
    # The extra edge row/column duplicates the last canvas row/column so grid
    # lines at the boundary (which matplotlib can't render at canvas edge+1)
    # are present in the image. All coordinates shift by +BORDER_PAD.
    page_w = render_w + 2 * BORDER_PAD + 1
    page_h = render_h + 2 * BORDER_PAD + 1

    # Matplotlib display scale factors.
    # figsize = (W + 0.5) / DPI creates a figure bbox of (W + 0.5) pixels,
    # even though the Agg canvas has exactly W pixels. The data-to-display
    # transform uses the bbox size, so there's a scale of (W+0.5)/W.
    sx = (render_w + 0.5) / render_w
    sy = (render_h + 0.5) / render_h

    # === METADATA ===
    format_choice = config_dict.get('format_choice', '6x2')
    data['layout_type'] = np.array(format_choice, dtype='U32')
    data['speed_mm_per_s'] = np.float32(config_dict.get('speed_mm_per_s', 25.0))
    data['gain_mm_per_mV'] = np.float32(config_dict.get('gain_mm_per_mV', 10.0))
    data['page_width_px'] = np.int32(page_w)
    data['page_height_px'] = np.int32(page_h)
    data['sampling_rate_hz'] = np.int32(config_dict.get('sampling_rate_hz', 500))

    lead_nomenclatures = config_dict.get('lead_nomenclatures', {})
    data['nomenclature_periph'] = np.array(
        lead_nomenclatures.get('peripheriques', 'standard'), dtype='U32')
    data['nomenclature_precord'] = np.array(
        lead_nomenclatures.get('precordiales', 'standard'), dtype='U32')

    # Channel names as 2D grid matching the visual layout
    if layout is not None and inverse_mapping is not None:
        channel_grid = []
        for row in layout:
            grid_row = []
            for cell in row:
                original = inverse_mapping.get(cell, cell)
                grid_row.append(original)
            # Rhythm rows: ['II','II','II','II'] → ['II']
            if len(set(grid_row)) == 1 and len(grid_row) > 1:
                grid_row = [grid_row[0]]
            channel_grid.append(grid_row)
        data['channel_names'] = np.array(json.dumps(channel_grid), dtype='U1024')
    else:
        channel_names = list(coord_data.lead_coordinates.keys())
        data['channel_names'] = np.array(json.dumps([channel_names]), dtype='U1024')

    # === GRID GEOMETRY ===
    # Grid line positions: convert from matplotlib data space to image space
    # X: x_img = round(x_mpl * sx + BORDER_PAD)  (scale + border, rounded to integer)
    # Y: y_img = round(H - y_mpl * sy + BORDER_PAD)  (scale + flip + border, rounded)
    # Rounding to integer ensures int() and round() agree everywhere
    # (the sx/sy scale introduces sub-pixel offsets like 2460.988 → 2461).
    # Clip to content area [BORDER_PAD, page_dim-BORDER_PAD-1] — outer px are border.
    clip_lo_x = BORDER_PAD
    clip_hi_x = page_w - BORDER_PAD - 1
    clip_lo_y = BORDER_PAD
    clip_hi_y = page_h - BORDER_PAD - 1
    major_x_img = np.round(np.clip(
        np.round(np.array(coord_data.grid_major_x, dtype=np.float64)) * sx + BORDER_PAD,
        clip_lo_x, clip_hi_x)).astype(np.float32)
    major_y_img = np.round(np.clip(
        render_h - np.round(np.array(coord_data.grid_major_y, dtype=np.float64)) * sy + BORDER_PAD,
        clip_lo_y, clip_hi_y)).astype(np.float32)
    minor_x_img = np.round(np.clip(
        np.round(np.array(coord_data.grid_minor_x, dtype=np.float64)) * sx + BORDER_PAD,
        clip_lo_x, clip_hi_x)).astype(np.float32)
    minor_y_img = np.round(np.clip(
        render_h - np.round(np.array(coord_data.grid_minor_y, dtype=np.float64)) * sy + BORDER_PAD,
        clip_lo_y, clip_hi_y)).astype(np.float32)

    data['grid_major_x'] = major_x_img
    data['grid_major_y'] = major_y_img
    data['grid_minor_x'] = minor_x_img
    data['grid_minor_y'] = minor_y_img

    # Grid extent in image space (rounded to integer, clipped to content area)
    x_range_mpl = coord_data.grid_x_range  # (x_start, x_end) in mpl space
    y_range_mpl = coord_data.grid_y_range  # (y_start, y_end) in mpl space
    x_start_img = round(np.clip(np.round(x_range_mpl[0]) * sx + BORDER_PAD, clip_lo_x, clip_hi_x))
    x_end_img = round(np.clip(np.round(x_range_mpl[1]) * sx + BORDER_PAD, clip_lo_x, clip_hi_x))
    y_start_img = round(np.clip(render_h - np.round(y_range_mpl[1]) * sy + BORDER_PAD, clip_lo_y, clip_hi_y))
    y_end_img = round(np.clip(render_h - np.round(y_range_mpl[0]) * sy + BORDER_PAD, clip_lo_y, clip_hi_y))
    data['grid_x_range'] = np.array([x_start_img, x_end_img], dtype=np.float32)
    data['grid_y_range'] = np.array([y_start_img, y_end_img], dtype=np.float32)

    # Grid intersections (Nx2): cartesian product of line positions
    # +0.5 offset: coordinates represent pixel CENTERS (pixel i covers [i, i+1),
    # so its center is at i+0.5).  This ensures int() floor lands on the correct
    # pixel even after sub-pixel transforms like paper_deform.
    # Major 5mm
    if len(major_x_img) > 0 and len(major_y_img) > 0:
        mx, my = np.meshgrid(major_x_img + 0.5, major_y_img + 0.5)
        data['grid_major_5mm'] = np.column_stack([
            mx.ravel(), my.ravel()]).astype(np.float32)
    else:
        data['grid_major_5mm'] = np.zeros((0, 2), dtype=np.float32)

    # Minor 1mm (excluding major positions)
    all_x = np.concatenate([major_x_img, minor_x_img])
    all_y = np.concatenate([major_y_img, minor_y_img])
    if len(all_x) > 0 and len(all_y) > 0:
        ax_grid, ay_grid = np.meshgrid(all_x, all_y)
        all_intersections = np.column_stack([ax_grid.ravel(), ay_grid.ravel()])
        # Exclude pure-major intersections (where both x AND y are major)
        # Positions are already rounded to integers, so direct int comparison
        major_x_set = set(major_x_img.astype(int))
        major_y_set = set(major_y_img.astype(int))
        minor_mask = np.array([
            not (int(pt[0]) in major_x_set and int(pt[1]) in major_y_set)
            for pt in all_intersections
        ])
        # +0.5 for pixel center (same rationale as major)
        data['grid_minor_1mm'] = (all_intersections[minor_mask] + 0.5).astype(np.float32)
    else:
        data['grid_minor_1mm'] = np.zeros((0, 2), dtype=np.float32)

    # === SIGNALS ===
    # coord_data stores (x, y, amp_mV) in matplotlib data space
    # NPZ format: signal_* = Nx3 (amp_mV, x_img, y_img)
    # X: x * sx + BORDER_PAD;  Y: H - y * sy + BORDER_PAD
    for lead_name, points in coord_data.lead_coordinates.items():
        if not points:
            continue
        arr = np.array(points, dtype=np.float32)  # Nx3: (x_mpl, y_mpl, amp)
        x_img = arr[:, 0] * sx + BORDER_PAD
        y_img = render_h - arr[:, 1] * sy + BORDER_PAD
        amp = arr[:, 2]
        data[f'signal_{lead_name}'] = np.column_stack([amp, x_img, y_img]).astype(np.float32)

    # === LEAD TIME RANGES ===
    for lead_key, (t_start, t_end) in coord_data.lead_time_ranges.items():
        data[f'lead_{lead_key}_time_range'] = np.array([t_start, t_end], dtype=np.float32)

    # === SIGNAL LINE WIDTH ===
    data['signal_line_width_px'] = np.int32(coord_data.signal_line_width_px)

    # === LABELS ===
    label_names = []
    label_centers = []
    for lead_name, (lx, ly) in coord_data.label_centers.items():
        label_names.append(lead_name)
        label_centers.append([lx * sx + BORDER_PAD, render_h - ly * sy + BORDER_PAD])
    if label_centers:
        data['label_centers'] = np.array(label_centers, dtype=np.float32)
    else:
        data['label_centers'] = np.zeros((0, 2), dtype=np.float32)
    data['label_names'] = np.array(label_names, dtype='U32')

    # === LEAD LABELS (for mask generation) ===
    if coord_data.lead_label_positions:
        ll_data = []
        ll_texts = []
        ll_ha = []
        for x, y, text, fontsize, ha in coord_data.lead_label_positions:
            ll_data.append([x * sx + BORDER_PAD, render_h - y * sy + BORDER_PAD, fontsize])
            ll_texts.append(text)
            ll_ha.append(ha)
        data['lead_label_pos'] = np.array(ll_data, dtype=np.float32)
        data['lead_label_texts'] = np.array(ll_texts, dtype='U32')
        data['lead_label_ha'] = np.array(ll_ha, dtype='U16')

    # === REFERENCE PULSES ===
    for key, points in coord_data.reference_pulse_coords.items():
        if points and len(points) >= 2:
            arr = np.array(points, dtype=np.float32)
            x_img = arr[:, 0] * sx + BORDER_PAD
            y_img = render_h - arr[:, 1] * sy + BORDER_PAD
            data[f'ref_pulse_{key}'] = np.column_stack([x_img, y_img]).astype(np.float32)

    # === MEDICAL TEXT (for mask generation) ===
    if coord_data.medical_text_positions:
        mt_data = []
        mt_texts = []
        mt_ha = []
        mt_va = []
        for x, y, text, fontsize, ha, va in coord_data.medical_text_positions:
            mt_data.append([x * sx + BORDER_PAD, render_h - y * sy + BORDER_PAD, fontsize])
            mt_texts.append(text)
            mt_ha.append(ha)
            mt_va.append(va)
        data['medical_text_pos'] = np.array(mt_data, dtype=np.float32)
        data['medical_text_texts'] = np.array(mt_texts, dtype='U64')
        data['medical_text_ha'] = np.array(mt_ha, dtype='U16')
        data['medical_text_va'] = np.array(mt_va, dtype='U16')

    # === BLACK SQUARE (legacy single) ===
    if coord_data.black_square_bbox is not None:
        sq_x, sq_y, sq_w, sq_h = coord_data.black_square_bbox
        data['black_square_bbox'] = np.array([
            sq_x * sx + BORDER_PAD,
            render_h - (sq_y + sq_h) * sy + BORDER_PAD,
            sq_w * sx,
            sq_h * sy
        ], dtype=np.float32)

    # === BLACK SQUARES (#53, multiple) ===
    if getattr(coord_data, 'black_square_bboxes', []):
        bboxes = []
        for sq_x, sq_y, sq_w, sq_h in coord_data.black_square_bboxes:
            bboxes.append([
                sq_x * sx + BORDER_PAD,
                render_h - (sq_y + sq_h) * sy + BORDER_PAD,
                sq_w * sx,
                sq_h * sy
            ])
        data['black_square_bboxes'] = np.array(bboxes, dtype=np.float32)

    # === PAGE BOUNDARY ===
    if coord_data.page_boundary is not None:
        data['page_boundary'] = np.array(coord_data.page_boundary, dtype=np.int32)

    # === MAPS (identity for P1 — forward=inverse=identity, uint16 encoding v2) ===
    # Forward map: P1→P2. Inverse map: P2→P1. Both identity for P1.
    fwd_x, fwd_y, inv_x, inv_y = identity_maps_encoded(page_w, page_h)
    data['map_encoding_version'] = np.int32(2)
    data['map_forward_x'] = fwd_x
    data['map_forward_y'] = fwd_y
    data['map_inverse_x'] = inv_x
    data['map_inverse_y'] = inv_y

    # Save using unified schema
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    save_unified_npz(output_path, data)
    return output_path

"""
Main ECG generation functions

High-level functions that orchestrate the complete ECG image generation pipeline:
XML parsing, configuration, layout rendering, and mask generation.
"""

import os
import traceback

from ecg_generator.config.constants import (
    IMG_WIDTH_PX, IMG_HEIGHT_PX, MM_TO_PX, LAYOUT_TEMPLATES, TEXT_ZONE_MARGINS
)
from ecg_generator.config.manager import (
    random_config, save_config_to_json, validate_and_fix_config)
from ecg_generator.layout.manager import (
    apply_lead_order, apply_lead_nomenclatures, create_inverse_mapping)
from ecg_generator.layout.renderer import render_ecg_layout
from ecg_generator.layout.figure_utils import save_figure_standard
from ecg_generator.npz_writer import save_pipeline1_npz
from shared.mask_generator import generate_masks_from_npz
from ecg_generator.masks.binary_utils import (
    create_lead_labels_binary_mask, create_reference_pulse_binary_mask,
    create_medical_text_binary_mask, create_black_square_binary_mask,
    create_paper_boundary_binary_mask
)
from shared.multiclass_mask import generate_multiclass_mask


def calculate_layout_dimensions(config, n_rows, page_width_px=None, page_height_px=None):
    """
    Calculate layout dimensions based on grid layout style

    Args:
        config (dict): Configuration containing grid_layout_style
        n_rows (int): Number of ECG rows (leads)
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        dict: Calculated dimensions with keys:
            - grid_x_start: Left edge of grid in pixels
            - grid_y_start: Bottom edge of grid in pixels
            - grid_width: Grid width in pixels
            - grid_height: Grid height in pixels
            - margin_px: Margin size in pixels
            - max_vertical_spacing: Maximum vertical spacing in mm
    """
    # Extract dimensions from config or use parameters or fall back to A4
    if page_width_px is None:
        page_width_px = config.get("page_width_px", IMG_WIDTH_PX)
    if page_height_px is None:
        page_height_px = config.get("page_height_px", IMG_HEIGHT_PX)

    layout_style = config.get("grid_layout_style", "full_grid")
    grid_squares = config.get("grid_squares")  # None or {"squares_x", "squares_y", "align_x", "margin_left_mm"}
    major_px = 5 * MM_TO_PX  # 60px per 5mm square

    if layout_style == "full_grid":
        # full_grid: grid always covers entire page (no variable square count)
        grid_x_start = 0
        grid_y_start = 0
        grid_width = page_width_px
        grid_height = page_height_px

        return {
            "grid_x_start": grid_x_start,
            "grid_y_start": grid_y_start,
            "grid_width": grid_width,
            "grid_height": grid_height,
            "margin_px": 10 * MM_TO_PX,
            "max_vertical_spacing": 30  # mm
        }

    elif layout_style == "with_text_zones":
        # Grid centered with margins for text zones
        margin_left = TEXT_ZONE_MARGINS["left"] * MM_TO_PX
        margin_right = TEXT_ZONE_MARGINS["right"] * MM_TO_PX
        margin_top = TEXT_ZONE_MARGINS["top"] * MM_TO_PX
        margin_bottom = TEXT_ZONE_MARGINS["bottom"] * MM_TO_PX

        grid_width = int((page_width_px - margin_left - margin_right) // major_px) * major_px
        grid_height = int((page_height_px - margin_top - margin_bottom) // major_px) * major_px

        if grid_squares is not None:
            # Override with square count, but keep within text zone bounds
            # Snap to complete 5mm squares so dimensions match visual grid drawing
            sq_width = grid_squares["squares_x"] * major_px
            sq_height = grid_squares["squares_y"] * major_px
            grid_width = int(min(sq_width, grid_width) // major_px) * major_px
            grid_height = int(min(sq_height, grid_height) // major_px) * major_px

            # Compute actual text bottom from config to allow tighter placement.
            # Text starts at page_height - 10mm and each visible line takes 4mm.
            # The tallest column (patient info) has up to 6 fields.
            vis = config.get("_text_visibility")
            if vis is not None:
                n_patient_lines = sum(1 for v in vis.get("patient_info", {}).values() if v)
                n_cardiac_lines = sum(1 for v in vis.get("cardiac_measurements", {}).values() if v)
                max_text_lines = max(n_patient_lines, n_cardiac_lines)
                # text starts 10mm from top, 4mm per line, +2mm safety gap
                actual_text_height_mm = 10 + max_text_lines * 4 + 2
            else:
                # Speed/gain text only: ~8mm from top
                actual_text_height_mm = 8
            actual_top_margin = actual_text_height_mm * MM_TO_PX

            available_w = page_width_px - margin_left - margin_right
            available_h = page_height_px - actual_top_margin - margin_bottom

            # Horizontal alignment — grid can start from 0 (page left edge)
            align_x = grid_squares.get("align_x", "centered")
            if align_x == "left":
                grid_x_start = grid_squares.get("margin_left_mm", 0) * MM_TO_PX
                # Clamp so grid doesn't overflow right edge
                if grid_x_start + grid_width > page_width_px:
                    grid_x_start = page_width_px - grid_width
            else:  # centered
                grid_x_start = margin_left + (page_width_px - margin_left - margin_right - grid_width) / 2

            # Vertical alignment (y=0 is bottom of page in matplotlib coords)
            # "top" = grid pushed up (large grid_y_start)
            # "bottom" = grid pushed down (grid_y_start near margin_bottom)
            align_y = grid_squares.get("align_y", "centered")
            if align_y == "top":
                # Grid sits just below actual text bottom
                top_limit = page_height_px - actual_top_margin
                grid_y_start = top_limit - grid_height - grid_squares.get("margin_top_mm", 0) * MM_TO_PX
                # Clamp so grid doesn't go below bottom margin
                if grid_y_start < margin_bottom:
                    grid_y_start = margin_bottom
            elif align_y == "bottom":
                grid_y_start = margin_bottom
            else:  # centered
                grid_y_start = margin_bottom + (available_h - grid_height) / 2
        else:
            grid_x_start = margin_left
            grid_y_start = margin_bottom

        # Calculate maximum vertical spacing to prevent overflow
        interline_px = 4 * MM_TO_PX
        usable_height = grid_height - 2 * 10 * MM_TO_PX  # Internal margins
        max_row_height = usable_height / n_rows
        max_vertical_spacing = max_row_height / MM_TO_PX

        # Clamp to reasonable values: 10mm minimum, 25mm maximum
        max_vertical_spacing = min(max_vertical_spacing, 25)
        max_vertical_spacing = max(max_vertical_spacing, 10)

        return {
            "grid_x_start": grid_x_start,
            "grid_y_start": grid_y_start,
            "grid_width": grid_width,
            "grid_height": grid_height,
            "margin_px": 10 * MM_TO_PX,
            "max_vertical_spacing": max_vertical_spacing
        }

    else:
        # Fallback to full_grid for unknown styles
        return calculate_layout_dimensions({"grid_layout_style": "full_grid"}, n_rows)


def main_generate_random_image_with_noise(leads_data_noisy, source_path, save_path="ECG_random_A4.png", config=None, mask_folder=None, mask_type = "img", verbose=True, mask_options=None):
    """
    Generate ECG image with potentially noisy data and fixed configuration

    Main entry point for ECG generation pipeline. Handles layout configuration,
    signal rendering, and optional mask generation.

    Args:
        leads_data_noisy (dict): ECG lead data (with or without noise)
        source_path (str): Path to source data file (.xml, .npy, .npz)
        save_path (str): Path where image will be saved
        config (dict, optional): Fixed configuration to use (generates random if None)
        mask_folder (str, optional): Folder to save masks (no masks if None),
        mask_type (str): Type of mask to generate ("img" or "bin")
        verbose (bool): If True, print [INFO] messages; if False, suppress them

    Returns:
        tuple: (final_png_path, mask_paths)
            - final_png_path (str): Actual saved path (may differ if renamed due to size error)
            - mask_paths (list): List of generated mask paths (empty if mask_folder=None)
    """
    if config is None:
        config = random_config()

    config = validate_and_fix_config(config)

    if verbose:
        print(f"[INFO] Using configuration: {config['format_choice']}")

    # Get template and apply lead ordering and nomenclatures
    # For multi-page formats, use pre-extracted page layout from caller
    if "_internal_page_layout" in config:
        layout_template = config["_internal_page_layout"]
    else:
        # Map format_choice to layout template key (3x4_paramedic uses same layout as 3x4)
        format_key = config["format_choice"]
        if format_key == "3x4_paramedic":
            format_key = "3x4"
        layout_template = LAYOUT_TEMPLATES[format_key]
    rhythm_leads = config.get("rythm_leads", None)
    layout = apply_lead_order(layout_template, config["lead_order"], rhythm_leads)

    # Create inverse mapping to retrieve original lead names
    inverse_mapping = create_inverse_mapping(config["lead_nomenclatures"])

    layout = apply_lead_nomenclatures(layout, config["lead_nomenclatures"])
    n_rows = len(layout)
    n_cols = len(layout[0])

    # Extract page dimensions from config
    page_width_px = config.get("page_width_px", IMG_WIDTH_PX)
    page_height_px = config.get("page_height_px", IMG_HEIGHT_PX)

    # Calculate dimensions based on layout style
    dimensions = calculate_layout_dimensions(config, n_rows, page_width_px, page_height_px)

    # Adjust spacing constraints for with_text_zones layout
    if config.get("grid_layout_style") == "with_text_zones":
        config["vertical_spacing_mm"] = min(config["vertical_spacing_mm"], dimensions["max_vertical_spacing"])
        if "horizontal_spacing_mm" in config:
            config["horizontal_spacing_mm"] = min(config["horizontal_spacing_mm"], 7)  # max 7mm to prevent overflow

    # Render ECG layout with coordinate tracking
    fig, ax, coord_data = render_ecg_layout(leads_data_noisy, layout, config, dimensions, inverse_mapping,
                                           page_width_px=page_width_px, page_height_px=page_height_px)

    # Save image with standardized dimensions
    final_png_path, is_correct_size, width, height = save_figure_standard(fig, save_path, transparent=False,
                                                                          expected_width_px=page_width_px,
                                                                          expected_height_px=page_height_px,
                                                                          coord_data=coord_data)

    if verbose:
        if is_correct_size:
            print(f"[INFO] Image generated and saved to {final_png_path}")
        else:
            print(f"[INFO] Image generated with size error ({width}x{height}) at {final_png_path}")

    # Save configuration + source name to JSON (update path to match renamed PNG if needed)
    json_path = os.path.splitext(final_png_path)[0] + ".json"
    save_config_to_json(config, source_path, json_path, verbose=verbose)

    # Save Pipeline 1 NPZ (coordinate data + metadata)
    npz_path = None
    try:
        npz_dir = os.path.join(os.path.dirname(os.path.dirname(final_png_path)), "npz")
        os.makedirs(npz_dir, exist_ok=True)
        ecg_name = os.path.splitext(os.path.basename(final_png_path))[0]
        npz_path = os.path.join(npz_dir, f"{ecg_name}.npz")
        save_pipeline1_npz(npz_path, coord_data, config, ecg_name,
                           layout=layout, inverse_mapping=inverse_mapping)
        if verbose:
            print(f"[INFO] Pipeline 1 NPZ saved: {npz_path}")
    except Exception as e:
        if verbose:
            print(f"[WARN] NPZ save failed: {e}")
            traceback.print_exc()

    # Generate masks from NPZ if requested
    mask_paths = []
    if mask_folder is not None and npz_path is not None:
        try:
            results = generate_masks_from_npz(npz_path, mask_folder, options=mask_options)
            mask_paths = list(results.values())
            if verbose:
                print(f"[INFO] {len(mask_paths)} masks generated in {mask_folder}")
        except Exception as e:
            if verbose:
                print(f"[WARN] Mask generation failed: {e}")
                traceback.print_exc()

    # Generate additional masks directly from coord_data (text/geometry masks)
    if mask_folder is not None and coord_data is not None:
        try:
            # Use bordered dimensions (+9) to match NPZ-based masks
            # Structure: BORDER_PAD(4) + canvas + 1(edge grid) + BORDER_PAD(4)
            render_w = config.get('page_width_px', None)
            render_h = config.get('page_height_px', None)
            page_w = render_w + 9 if render_w is not None else None
            page_h = render_h + 9 if render_h is not None else None
            mask_tp = mask_options.get('mask_type', 'img') if mask_options else 'img'

            if coord_data.lead_label_positions:
                p = os.path.join(mask_folder, "mask_lead_labels.png")
                mask_paths.append(create_lead_labels_binary_mask(coord_data, p, page_w, page_h, mask_tp))

            if coord_data.reference_pulse_coords:
                p = os.path.join(mask_folder, "mask_reference_pulse.png")
                mask_paths.append(create_reference_pulse_binary_mask(coord_data, p, page_w, page_h, mask_tp))

            if coord_data.medical_text_positions:
                p = os.path.join(mask_folder, "mask_medical_text.png")
                mask_paths.append(create_medical_text_binary_mask(coord_data, p, page_w, page_h, mask_tp))

            if coord_data.black_square_bbox is not None or getattr(coord_data, 'black_square_bboxes', []):
                p = os.path.join(mask_folder, "mask_black_square.png")
                mask_paths.append(create_black_square_binary_mask(coord_data, p, page_w, page_h, mask_tp))

            if coord_data.page_boundary is not None:
                p = os.path.join(mask_folder, "mask_paper_boundary.png")
                mask_paths.append(create_paper_boundary_binary_mask(coord_data, p, page_w, page_h, mask_tp))
        except Exception as e:
            if verbose:
                print(f"[WARN] Additional mask generation failed: {e}")
                traceback.print_exc()

    # Generate multi-class segmentation mask
    if mask_folder is not None and mask_paths:
        try:
            mc_path = os.path.join(mask_folder, "multiclass_mask.npz")
            generate_multiclass_mask(mask_folder, mc_path)
            mask_paths.append(mc_path)
            if verbose:
                print(f"[INFO] Multi-class mask saved to {mc_path}")
        except Exception as e:
            if verbose:
                print(f"[WARN] Multi-class mask generation failed: {e}")

    return final_png_path, mask_paths



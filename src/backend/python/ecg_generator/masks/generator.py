"""
Mask generation functions for ECG images
Creates up to 32 mask types: 12 standard leads + 12 extra leads + global signal + grid_only + grid_line + lead_labels + reference_pulse + medical_text + black_square + paper_boundary
Binary masks optimized for AI training: background = 0 (black), signal = 255 (white)
"""

import os
from ecg_generator.masks.binary_utils import (
    create_individual_lead_binary_mask, create_global_signal_binary_mask,
    create_grid_binary_mask, create_grid_line_binary_mask,
    create_lead_labels_binary_mask, create_reference_pulse_binary_mask,
    create_medical_text_binary_mask, create_black_square_binary_mask,
    create_paper_boundary_binary_mask
)
from ecg_generator.config.constants import GRID_LINE_MASK_CONFIG


def get_all_lead_names():
    """
    Return list of all 24 leads (12 standard + 12 extra)

    Returns:
        list: List of lead names (e.g., ['I', 'II', ..., 'I_extra', 'II_extra', ...])
    """
    standard_leads = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
    extra_leads = [f'{lead}_extra' for lead in standard_leads]
    return standard_leads + extra_leads


def generate_all_masks(leads_data_noisy, layout, config, dimensions, inverse_mapping, mask_folder, coord_data, page_width_px=None, page_height_px=None, mask_type="img"):
    """
    Generate up to 32 binary masks for an ECG image using exact coordinates from the main image

    Creates binary masks optimized for AI training: background = 0 (black), signal = 255 (white)
    Mask types: 24 individual leads (12 standard + 12 extra) + all_signals + grid_only + grid_line
    + lead_labels + reference_pulse + medical_text + black_square + paper_boundary

    Args:
        leads_data_noisy (dict): ECG lead data (unused, kept for compatibility)
        layout (list): Lead layout (unused, kept for compatibility)
        config (dict): Configuration containing rhythm_leads information
        dimensions (dict): Calculated dimensions (unused, kept for compatibility)
        inverse_mapping (dict): Lead name mapping (unused, kept for compatibility)
        mask_folder (str): Folder path to save all masks for this image
        coord_data (CoordinateData): Object with exact pixel coordinates from main image generation
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        list: List of 27 paths to generated binary mask PNG files
    """
    os.makedirs(mask_folder, exist_ok=True)

    mask_paths = []

    # Generate 24 individual lead masks (12 standard + 12 extra)
    all_leads = get_all_lead_names()
    for lead_name in all_leads:
        mask_path = os.path.join(mask_folder, f"mask_{lead_name}.png")
        final_path = create_individual_lead_mask_from_coords(coord_data, lead_name, mask_path, page_width_px, page_height_px, mask_type)
        mask_paths.append(final_path)

    # Generate combined all_signals mask
    signal_mask_path = os.path.join(mask_folder, "mask_all_signals.png")
    final_signal_path = create_global_signal_mask_from_coords(coord_data, signal_mask_path, page_width_px, page_height_px, mask_type)
    mask_paths.append(final_signal_path)

    # Generate grid intersection points mask
    grid_mask_path = os.path.join(mask_folder, "mask_grid_only.png")
    final_grid_path = create_grid_mask_from_coords(coord_data, grid_mask_path, page_width_px, page_height_px, mask_type)
    mask_paths.append(final_grid_path)

    # Generate grid line mask (complete grid lines, not just intersection points)
    if GRID_LINE_MASK_CONFIG["enabled"]:
        grid_line_mask_path = os.path.join(mask_folder, "mask_grid_line.png")
        final_grid_line_path = create_grid_line_mask_from_coords(config, dimensions, grid_line_mask_path, page_width_px, page_height_px, mask_type)
        mask_paths.append(final_grid_line_path)

    # Generate lead labels mask
    if coord_data.lead_label_positions:
        labels_mask_path = os.path.join(mask_folder, "mask_lead_labels.png")
        final_labels_path = create_lead_labels_binary_mask(coord_data, labels_mask_path, page_width_px, page_height_px, mask_type)
        mask_paths.append(final_labels_path)

    # Generate reference pulse mask
    if coord_data.reference_pulse_coords:
        pulse_mask_path = os.path.join(mask_folder, "mask_reference_pulse.png")
        final_pulse_path = create_reference_pulse_binary_mask(coord_data, pulse_mask_path, page_width_px, page_height_px, mask_type)
        mask_paths.append(final_pulse_path)

    # Generate medical text mask
    if coord_data.medical_text_positions:
        med_text_mask_path = os.path.join(mask_folder, "mask_medical_text.png")
        final_med_text_path = create_medical_text_binary_mask(coord_data, med_text_mask_path, page_width_px, page_height_px, mask_type)
        mask_paths.append(final_med_text_path)

    # Generate black calibration square mask
    if coord_data.black_square_bbox is not None:
        square_mask_path = os.path.join(mask_folder, "mask_black_square.png")
        final_square_path = create_black_square_binary_mask(coord_data, square_mask_path, page_width_px, page_height_px, mask_type)
        mask_paths.append(final_square_path)

    # Generate paper boundary mask
    if coord_data.page_boundary is not None:
        boundary_mask_path = os.path.join(mask_folder, "mask_paper_boundary.png")
        final_boundary_path = create_paper_boundary_binary_mask(coord_data, boundary_mask_path, page_width_px, page_height_px, mask_type)
        mask_paths.append(final_boundary_path)

    return mask_paths


def create_individual_lead_mask_from_coords(coord_data, lead_name, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """
    Create binary mask for individual lead using stored coordinates

    Args:
        coord_data (CoordinateData): Object with stored signal coordinates
        lead_name (str): Name of the lead to extract (e.g., 'I', 'II', 'V1', 'II_extra')
        save_path (str): Path to save the mask PNG file
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        str: Actual path where mask was saved (may differ if size error occurred)
    """
    final_path = create_individual_lead_binary_mask(coord_data, lead_name, save_path,
                                                    page_width_px=page_width_px, page_height_px=page_height_px, mask_type=mask_type)
    return final_path


def create_global_signal_mask_from_coords(coord_data, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """
    Create binary mask containing all ECG signals combined (all leads merged)

    Args:
        coord_data (CoordinateData): Object with stored signal coordinates
        save_path (str): Path to save the mask PNG file
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        str: Actual path where mask was saved (may differ if size error occurred)
    """
    final_path = create_global_signal_binary_mask(coord_data, save_path,
                                                  page_width_px=page_width_px, page_height_px=page_height_px, mask_type=mask_type)
    return final_path


def create_grid_mask_from_coords(coord_data, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """
    Create binary mask for grid intersection points only

    Args:
        coord_data (CoordinateData): Object with grid intersection coordinates
        save_path (str): Path to save the mask PNG file
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        str: Actual path where mask was saved (may differ if size error occurred)
    """
    final_path = create_grid_binary_mask(coord_data, save_path,
                                        page_width_px=page_width_px, page_height_px=page_height_px, mask_type=mask_type)
    return final_path


def create_grid_line_mask_from_coords(config, dimensions, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """
    Create binary mask with complete grid lines using config parameters

    Args:
        config (dict): Configuration containing grid_style and grid_layout_style
        dimensions (dict): Dimensions with text zone margins
        save_path (str): Path to save the mask PNG file
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        str: Actual path where mask was saved (may differ if size error occurred)
    """
    final_path = create_grid_line_binary_mask(config, dimensions, save_path,
                                              page_width_px=page_width_px, page_height_px=page_height_px, mask_type=mask_type)
    return final_path
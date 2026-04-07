"""
Binary mask utilities for ECG image generation optimized for AI training
Creates binary masks using stored coordinates + Matplotlib rendering (no flipping)
Background = 0 (black), Signal = 255 (white), dtype=uint8, no anti-aliasing
"""

import matplotlib.pyplot as plt
from PIL import Image, ImageDraw
import numpy as np
from ecg_generator.config.constants import (
    DPI, A4_WIDTH_MM, A4_HEIGHT_MM, MM_TO_INCH, IMG_WIDTH_PX, IMG_HEIGHT_PX,
    MM_TO_PX
)


def _px_to_linewidth(px):
    """Convert desired pixel width to matplotlib linewidth (points)."""
    return px * 72.0 / DPI
from ecg_generator.layout.figure_utils import create_standard_figure


def figure_to_numpy(fig):
    fig.canvas.draw()
    raw = fig.canvas.buffer_rgba()
    w, h = fig.canvas.get_width_height()
    return np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 4)

def numpy_to_binary(arr, threshold=128):
    gray = 0.299*arr[:,:,0] + 0.587*arr[:,:,1] + 0.114*arr[:,:,2]
    return (gray > threshold).astype(np.uint8)


def create_individual_lead_binary_mask(coord_data, lead_name, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """
    Create binary mask for a specific lead using stored coordinates + Matplotlib rendering

    Args:
        coord_data (CoordinateData): Object with stored signal coordinates
        lead_name (str): Name of the lead to extract (e.g., "II", "V1", "II_extra")
        save_path (str): Path to save the mask PNG file
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        str: Actual path where mask was saved (may differ if size error occurred)
    """
    # Create figure with black background
    fig, ax = create_standard_figure(transparent=False, page_width_px=page_width_px, page_height_px=page_height_px)
    ax.set_facecolor('black')
    fig.patch.set_facecolor('black')

    # Render signal using stored coordinates
    if lead_name.endswith('_extra'):
        # Extra leads: stored as single continuous path
        if lead_name in coord_data.lead_coordinates:
            signal_points = coord_data.lead_coordinates[lead_name]
            if signal_points and len(signal_points) >= 2:
                x_coords = [p[0] for p in signal_points]
                y_coords = [p[1] for p in signal_points]
                ax.plot(x_coords, y_coords, color='white', linewidth=_px_to_linewidth(coord_data.signal_line_width_px), antialiased=False)
    else:
        # Standard leads: combine all segments (e.g., "II_seg0", "II_seg1", etc.)
        for coord_key in sorted(coord_data.lead_coordinates.keys()):
            if coord_key.startswith(f"{lead_name}_seg"):
                signal_points = coord_data.lead_coordinates[coord_key]
                if signal_points and len(signal_points) >= 2:
                    x_coords = [p[0] for p in signal_points]
                    y_coords = [p[1] for p in signal_points]
                    ax.plot(x_coords, y_coords, color='white', linewidth=_px_to_linewidth(coord_data.signal_line_width_px), antialiased=False)

    if mask_type == "bin":
        arr = figure_to_numpy(fig)
        arr = numpy_to_binary(arr) 
        arr = np.array(arr,dtype=bool)
        np.savez_compressed(save_path.split(".")[0] + ".npz", arr=arr)


    if mask_type == "img":
        fig.savefig(
            save_path,
            dpi=DPI,
            bbox_inches='tight',
            pad_inches=0,
            transparent=False
        )
    plt.close(fig)

    # Validate image size
    from ecg_generator.validation.image import validate_and_rename_if_needed
    exp_width = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    exp_height = page_height_px if page_height_px is not None else IMG_HEIGHT_PX
    final_path, is_correct, width, height = validate_and_rename_if_needed(save_path, exp_width, exp_height)

    return final_path


def create_global_signal_binary_mask(coord_data, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """
    Create binary mask containing all ECG signals (all leads combined)

    Args:
        coord_data (CoordinateData): Object with stored signal coordinates
        save_path (str): Path to save the mask PNG file
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        str: Actual path where mask was saved (may differ if size error occurred)
    """
    # Create figure with black background
    fig, ax = create_standard_figure(transparent=False, page_width_px=page_width_px, page_height_px=page_height_px)
    ax.set_facecolor('black')
    fig.patch.set_facecolor('black')

    # Render all signals using stored coordinates
    for lead_name, signal_points in coord_data.lead_coordinates.items():
        if signal_points and len(signal_points) >= 2:
            x_coords = [p[0] for p in signal_points]
            y_coords = [p[1] for p in signal_points]
            ax.plot(x_coords, y_coords, color='white', linewidth=_px_to_linewidth(coord_data.signal_line_width_px), antialiased=False)

    if mask_type == "bin":
        arr = figure_to_numpy(fig)
        arr = numpy_to_binary(arr)
        arr = np.array(arr,dtype=bool)
        np.savez_compressed(save_path.split(".")[0] + ".npz", arr=arr)
    # Save using same method as main image (no numpy conversion, no flipping)
    if mask_type == "img":
        fig.savefig(
            save_path,
            dpi=DPI,
            bbox_inches='tight',
            pad_inches=0,
            transparent=False
        )
    plt.close(fig)

    # Validate image size
    from ecg_generator.validation.image import validate_and_rename_if_needed
    exp_width = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    exp_height = page_height_px if page_height_px is not None else IMG_HEIGHT_PX
    final_path, is_correct, width, height = validate_and_rename_if_needed(save_path, exp_width, exp_height)

    return final_path


def create_grid_binary_mask(coord_data, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
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
    # Create blank black image using PIL (simple for dots)
    from PIL import Image, ImageDraw

    width_px = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    height_px = page_height_px if page_height_px is not None else IMG_HEIGHT_PX

    mask_image = Image.new('L', (width_px, height_px), color=0)
    draw = ImageDraw.Draw(mask_image)

    # Draw grid intersection points
    # coord_data.grid_intersections are in matplotlib data space.
    # Apply the same figsize scale factor as the Agg renderer:
    #   display_x = x * (W + 0.5) / W,  display_y = y * (H + 0.5) / H
    # Then flip Y for image space: y_image = H - round(y * sy)
    if coord_data.grid_intersections:
        point_size = 1
        sx = (width_px + 0.5) / width_px
        sy = (height_px + 0.5) / height_px
        for x, y in coord_data.grid_intersections:
            x_int = max(0, min(width_px - 1, int(round(x * sx))))
            y_int = max(0, min(height_px - 1, height_px - int(round(y * sy))))

            # Draw as filled ellipse
            left = x_int - point_size
            top = y_int - point_size
            right = x_int + point_size
            bottom = y_int + point_size
            draw.ellipse([left, top, right, bottom], fill=255)

    # Save directly
    if mask_type == "bin":
        mask_arr = np.array(mask_image)
        mask_arr = np.array(mask_arr//255,dtype=bool)
        np.savez_compressed(save_path.split(".")[0] + ".npz", arr=mask_arr)

    if mask_type == "img":
        mask_image.save(save_path, 'PNG', optimize=False, compress_level=0)
    # Validate image size
    from ecg_generator.validation.image import validate_and_rename_if_needed
    final_path, is_correct, width, height = validate_and_rename_if_needed(save_path, width_px, height_px)

    return final_path


def create_grid_line_binary_mask(config, dimensions, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """
    Create binary mask with complete grid lines (not just intersection points)

    This mask represents the actual grid lines as they appear in the ECG image,
    matching the grid style (solid/dashed/dotted/points) based on configuration.

    Renders grid using matplotlib (same as main ECG) then converts to binary mask.

    Args:
        config (dict): Configuration dict containing grid_style, grid_layout_style
        dimensions (dict): Grid zone dimensions with keys: grid_x_start, grid_y_start, grid_width, grid_height
        save_path (str): Output path for the mask PNG
        page_width_px (int, optional): Custom page width in pixels
        page_height_px (int, optional): Custom page height in pixels

    Returns:
        str: Path to saved mask file (may differ if size error occurred)
    """
    from ecg_generator.config.constants import GRID_LINE_MASK_CONFIG
    import numpy as np
    import io

    # Extract parameters from config
    major_style, minor_style = config["grid_style"]
    grid_layout_style = config.get("grid_layout_style", "full_grid")
    line_density = GRID_LINE_MASK_CONFIG["line_density"]
    line_style = GRID_LINE_MASK_CONFIG["line_style"]

    # Override styles if continuous_only mode
    if line_style == "continuous_only":
        major_style = "solid"
        minor_style = "solid"

    # Create figure with white background (grid will be black, then we invert)
    fig, ax = create_standard_figure(transparent=False, page_width_px=page_width_px, page_height_px=page_height_px)
    ax.set_facecolor('white')
    fig.patch.set_facecolor('white')

    # Render grid manually to have precise control over major/minor line rendering
    # This avoids the bug in grid.py where dotted/dashed minor lines don't skip major positions
    width_px = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    height_px = page_height_px if page_height_px is not None else IMG_HEIGHT_PX

    # Calculate grid boundaries
    if grid_layout_style == "with_text_zones":
        x_start = dimensions.get("grid_x_start", 0)
        y_start = dimensions.get("grid_y_start", 0)
        width = dimensions.get("grid_width", width_px)
        height = dimensions.get("grid_height", height_px)
    else:
        x_start = 0
        y_start = 0
        width = width_px
        height = height_px

    x_end = x_start + width
    y_end = y_start + height

    minor_px = 1 * MM_TO_PX
    major_px = 5 * MM_TO_PX

    # Calculate major line positions to avoid overlapping
    major_x_positions = set(np.round(np.arange(x_start, x_end, major_px)).astype(int))
    major_y_positions = set(np.round(np.arange(y_start, y_end, major_px)).astype(int))

    # Draw minor grid lines if requested
    if line_density == "all_lines":
        if minor_style == "solid":
            for x in np.arange(x_start, x_end, minor_px):
                if int(np.round(x)) not in major_x_positions:
                    ax.plot([x, x], [y_start, y_end], color='black', linewidth=0.2, alpha=0.4, antialiased=False)
            for y in np.arange(y_start, y_end, minor_px):
                if int(np.round(y)) not in major_y_positions:
                    ax.plot([x_start, x_end], [y, y], color='black', linewidth=0.2, alpha=0.4, antialiased=False)
        elif minor_style == "dashed":
            for x in np.arange(x_start, x_end, minor_px):
                if int(np.round(x)) not in major_x_positions:
                    ax.plot([x, x], [y_start, y_end], color='black', linewidth=0.2, alpha=0.4,
                           linestyle=':', antialiased=False)
            for y in np.arange(y_start, y_end, minor_px):
                if int(np.round(y)) not in major_y_positions:
                    ax.plot([x_start, x_end], [y, y], color='black', linewidth=0.2, alpha=0.4,
                           linestyle=':', antialiased=False)
        elif minor_style == "dotted":
            for x in np.arange(x_start, x_end, minor_px):
                if int(np.round(x)) not in major_x_positions:
                    ax.plot([x, x], [y_start, y_end], color='black', linewidth=0.2, alpha=0.4,
                           linestyle='--', antialiased=False)
            for y in np.arange(y_start, y_end, minor_px):
                if int(np.round(y)) not in major_y_positions:
                    ax.plot([x_start, x_end], [y, y], color='black', linewidth=0.2, alpha=0.4,
                           linestyle='--', antialiased=False)
        elif minor_style == "dots":
            for x in np.arange(x_start, x_end, minor_px):
                for y in np.arange(y_start, y_end, minor_px):
                    x_int = int(np.round(x))
                    y_int = int(np.round(y))
                    if x_int not in major_x_positions and y_int not in major_y_positions:
                        ax.plot(x, y, 'o', color='black', markersize=1.0, alpha=1.0,
                               markerfacecolor='black', markeredgewidth=0, antialiased=False)

    # Draw major grid lines
    if major_style == "solid":
        for x in np.arange(x_start, x_end, major_px):
            ax.plot([x, x], [y_start, y_end], color='black', linewidth=0.6, antialiased=False)
        for y in np.arange(y_start, y_end, major_px):
            ax.plot([x_start, x_end], [y, y], color='black', linewidth=0.6, antialiased=False)
    elif major_style == "dashed":
        for x in np.arange(x_start, x_end, major_px):
            ax.plot([x, x], [y_start, y_end], color='black', linewidth=0.6, linestyle=':', antialiased=False)
        for y in np.arange(y_start, y_end, major_px):
            ax.plot([x_start, x_end], [y, y], color='black', linewidth=0.6, linestyle=':', antialiased=False)
    elif major_style == "dotted":
        for x in np.arange(x_start, x_end, major_px):
            ax.plot([x, x], [y_start, y_end], color='black', linewidth=0.6, linestyle='--', antialiased=False)
        for y in np.arange(y_start, y_end, major_px):
            ax.plot([x_start, x_end], [y, y], color='black', linewidth=0.6, linestyle='--', antialiased=False)
    elif major_style == "dots":
        for x in np.arange(x_start, x_end, major_px):
            for y in np.arange(y_start, y_end, major_px):
                ax.plot(x, y, 'o', color='black', markersize=2.5, alpha=1.0,
                       markerfacecolor='black', markeredgewidth=0, antialiased=False)

    # Save to buffer
    


    if mask_type == "bin":
        arr = figure_to_numpy(fig)
        arr = numpy_to_binary(arr)
        arr = np.array(arr,dtype=bool)
        np.savez_compressed(save_path.split(".")[0] + ".npz", arr=arr)
    # Save using same method as main image (no numpy conversion, no flipping)
    if mask_type == "img":
        buf = io.BytesIO()
        fig.savefig(
            buf,
            format='png',
            dpi=DPI,
            pad_inches=0,
            facecolor='white'
        )
        

        # Load image from buffer
        buf.seek(0)
        img = Image.open(buf).convert('L')

        # Convert to numpy array
        img_array = np.array(img)

        # Invert: white background (255) -> black (0), black grid lines (0) -> white (255)
        img_array = 255 - img_array

        # Apply threshold to ensure binary mask (handle any anti-aliasing artifacts)
        # Anything not pure white (255) in original becomes white (255) in mask
        img_array = np.where(img_array > 10, 255, 0).astype(np.uint8)

        # Convert back to PIL image
        mask_image = Image.fromarray(img_array, mode='L')

        # Save the mask
        mask_image.save(save_path, 'PNG', optimize=False, compress_level=0)
    plt.close(fig)

    # Validate image size
    from ecg_generator.validation.image import validate_and_rename_if_needed
    final_path, is_correct, width_val, height_val = validate_and_rename_if_needed(save_path, width_px, height_px)

    return final_path


def _render_text_mask_with_matplotlib(text_items, width_px, height_px, save_path, mask_type="img"):
    """Render text onto a binary mask using matplotlib for pixel-perfect font matching.

    Uses the same matplotlib rendering engine as the ECG image to guarantee
    identical font metrics, kerning, and glyph shapes.

    Args:
        text_items: List of dicts with keys: x, y, text, fontsize, ha, va, weight
        width_px: Mask width in pixels
        height_px: Mask height in pixels
        save_path: Output path for mask PNG
        mask_type: "img" for PNG, "bin" for compressed numpy

    Returns:
        str: Path where mask was saved
    """
    import io

    fig, ax = create_standard_figure(page_width_px=width_px, page_height_px=height_px)
    fig.patch.set_facecolor('black')
    ax.set_facecolor('black')

    for item in text_items:
        ax.text(
            item['x'], item['y'], item['text'],
            fontsize=item['fontsize'],
            ha=item.get('ha', 'left'),
            va=item.get('va', 'bottom'),
            color='white',
            weight=item.get('weight', 'normal')
        )

    # Render to buffer
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=DPI, facecolor='black', pad_inches=0)
    plt.close(fig)

    # Load as grayscale PIL and threshold to binary
    buf.seek(0)
    mask_image = Image.open(buf).convert('L')
    # Matplotlib may produce ±1px due to float rounding; resize to exact target
    if mask_image.size != (width_px, height_px):
        mask_image = mask_image.resize((width_px, height_px), Image.NEAREST)
    mask_image = mask_image.point(lambda p: 255 if p > 128 else 0)

    if mask_type == "bin":
        mask_arr = np.array(mask_image)
        mask_arr = np.array(mask_arr // 255, dtype=bool)
        np.savez_compressed(save_path.split(".")[0] + ".npz", arr=mask_arr)

    if mask_type == "img":
        mask_image.save(save_path, 'PNG', optimize=False, compress_level=0)

    from ecg_generator.validation.image import validate_and_rename_if_needed
    final_path, is_correct, width, height = validate_and_rename_if_needed(save_path, width_px, height_px)
    return final_path


def create_lead_labels_binary_mask(coord_data, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """Create binary mask for lead label text positions using matplotlib.

    Args:
        coord_data: CoordinateData with lead_label_positions
        save_path: Output path for mask PNG
        page_width_px: Custom page width (default: A4)
        page_height_px: Custom page height (default: A4)
        mask_type: "img" for PNG, "bin" for compressed numpy

    Returns:
        str: Path where mask was saved
    """
    width_px = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    height_px = page_height_px if page_height_px is not None else IMG_HEIGHT_PX

    text_items = [
        {'x': x, 'y': y, 'text': text, 'fontsize': fontsize_pt, 'ha': ha, 'va': 'bottom', 'weight': 'bold'}
        for x, y, text, fontsize_pt, ha in coord_data.lead_label_positions
    ]

    return _render_text_mask_with_matplotlib(text_items, width_px, height_px, save_path, mask_type)


def create_reference_pulse_binary_mask(coord_data, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """Create binary mask for reference/calibration pulses using PIL.

    Args:
        coord_data: CoordinateData with reference_pulse_coords
        save_path: Output path for mask PNG
        page_width_px: Custom page width (default: A4)
        page_height_px: Custom page height (default: A4)
        mask_type: "img" for PNG, "bin" for compressed numpy

    Returns:
        str: Path where mask was saved
    """
    width_px = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    height_px = page_height_px if page_height_px is not None else IMG_HEIGHT_PX

    mask_image = Image.new('L', (width_px, height_px), color=0)
    draw = ImageDraw.Draw(mask_image)

    for key, points in coord_data.reference_pulse_coords.items():
        if not points or len(points) < 2:
            continue
        pil_points = [
            (int(round(p[0])), height_px - 1 - int(round(p[1])))
            for p in points
        ]
        draw.line(pil_points, fill=255, width=2)

    if mask_type == "bin":
        mask_arr = np.array(mask_image)
        mask_arr = np.array(mask_arr // 255, dtype=bool)
        np.savez_compressed(save_path.split(".")[0] + ".npz", arr=mask_arr)

    if mask_type == "img":
        mask_image.save(save_path, 'PNG', optimize=False, compress_level=0)

    from ecg_generator.validation.image import validate_and_rename_if_needed
    final_path, is_correct, width, height = validate_and_rename_if_needed(save_path, width_px, height_px)
    return final_path


def create_medical_text_binary_mask(coord_data, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """Create binary mask for medical text overlays using matplotlib.

    Args:
        coord_data: CoordinateData with medical_text_positions
        save_path: Output path for mask PNG
        page_width_px: Custom page width (default: A4)
        page_height_px: Custom page height (default: A4)
        mask_type: "img" for PNG, "bin" for compressed numpy

    Returns:
        str: Path where mask was saved
    """
    width_px = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    height_px = page_height_px if page_height_px is not None else IMG_HEIGHT_PX

    text_items = [
        {'x': x, 'y': y, 'text': text, 'fontsize': fontsize, 'ha': ha, 'va': va, 'weight': 'normal'}
        for x, y, text, fontsize, ha, va in coord_data.medical_text_positions
    ]

    return _render_text_mask_with_matplotlib(text_items, width_px, height_px, save_path, mask_type)


def create_black_square_binary_mask(coord_data, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """Create binary mask for the black calibration square using PIL.

    Args:
        coord_data: CoordinateData with black_square_bbox
        save_path: Output path for mask PNG
        page_width_px: Custom page width (default: A4)
        page_height_px: Custom page height (default: A4)
        mask_type: "img" for PNG, "bin" for compressed numpy

    Returns:
        str: Path where mask was saved
    """
    width_px = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    height_px = page_height_px if page_height_px is not None else IMG_HEIGHT_PX

    mask_image = Image.new('L', (width_px, height_px), color=0)
    draw = ImageDraw.Draw(mask_image)

    # Draw legacy single square
    if coord_data.black_square_bbox is not None:
        sq_x, sq_y, sq_w, sq_h = coord_data.black_square_bbox
        # Flip Y coordinate (matplotlib bottom-left -> PIL top-left)
        pil_top = height_px - 1 - int(round(sq_y + sq_h))
        pil_bottom = height_px - 1 - int(round(sq_y))
        pil_left = int(round(sq_x))
        pil_right = int(round(sq_x + sq_w))
        draw.rectangle([pil_left, pil_top, pil_right, pil_bottom], fill=255)

    # Draw additional squares (#53)
    for sq_x, sq_y, sq_w, sq_h in getattr(coord_data, 'black_square_bboxes', []):
        pil_top = height_px - 1 - int(round(sq_y + sq_h))
        pil_bottom = height_px - 1 - int(round(sq_y))
        pil_left = int(round(sq_x))
        pil_right = int(round(sq_x + sq_w))
        draw.rectangle([pil_left, pil_top, pil_right, pil_bottom], fill=255)

    if mask_type == "bin":
        mask_arr = np.array(mask_image)
        mask_arr = np.array(mask_arr // 255, dtype=bool)
        np.savez_compressed(save_path.split(".")[0] + ".npz", arr=mask_arr)

    if mask_type == "img":
        mask_image.save(save_path, 'PNG', optimize=False, compress_level=0)

    from ecg_generator.validation.image import validate_and_rename_if_needed
    final_path, is_correct, width, height = validate_and_rename_if_needed(save_path, width_px, height_px)
    return final_path


def create_paper_boundary_binary_mask(coord_data, save_path, page_width_px=None, page_height_px=None, mask_type="img"):
    """Create binary mask for the paper boundary (page edges) using PIL.

    Draws a white border rectangle at the page edges (outline only, 3px width).

    Args:
        coord_data: CoordinateData with page_boundary
        save_path: Output path for mask PNG
        page_width_px: Custom page width (default: A4)
        page_height_px: Custom page height (default: A4)
        mask_type: "img" for PNG, "bin" for compressed numpy

    Returns:
        str: Path where mask was saved
    """
    width_px = page_width_px if page_width_px is not None else IMG_WIDTH_PX
    height_px = page_height_px if page_height_px is not None else IMG_HEIGHT_PX

    mask_image = Image.new('L', (width_px, height_px), color=0)
    draw = ImageDraw.Draw(mask_image)

    # Draw border rectangle (outline only)
    border_width = 3
    draw.rectangle([0, 0, width_px - 1, height_px - 1], outline=255, width=border_width)

    if mask_type == "bin":
        mask_arr = np.array(mask_image)
        mask_arr = np.array(mask_arr // 255, dtype=bool)
        np.savez_compressed(save_path.split(".")[0] + ".npz", arr=mask_arr)

    if mask_type == "img":
        mask_image.save(save_path, 'PNG', optimize=False, compress_level=0)

    from ecg_generator.validation.image import validate_and_rename_if_needed
    final_path, is_correct, width, height = validate_and_rename_if_needed(save_path, width_px, height_px)
    return final_path


def validate_binary_mask(mask_array):
    """
    Validate that a mask array is properly binary (only 0 and 255 values)

    Args:
        mask_array (np.ndarray): Mask array to validate

    Returns:
        bool: True if mask contains only 0 and/or 255 values, False if other values exist
    """
    unique_values = np.unique(mask_array)
    return len(unique_values) <= 2 and np.all(np.isin(unique_values, [0, 255]))


def get_mask_statistics(mask_array):
    """
    Get statistics about a binary mask for debugging and validation

    Args:
        mask_array (np.ndarray): Binary mask array to analyze

    Returns:
        dict: Statistics dictionary containing:
            - total_pixels: Total number of pixels in mask
            - signal_pixels: Number of white pixels (255)
            - background_pixels: Number of black pixels (0)
            - other_pixels: Number of pixels with values other than 0 or 255
            - signal_percentage: Percentage of signal pixels relative to total
            - is_binary: True if mask contains only 0 and 255 values
            - unique_values: List of all unique pixel values in mask
    """
    total_pixels = mask_array.size
    signal_pixels = np.sum(mask_array == 255)
    background_pixels = np.sum(mask_array == 0)
    other_pixels = total_pixels - signal_pixels - background_pixels

    return {
        'total_pixels': total_pixels,
        'signal_pixels': signal_pixels,
        'background_pixels': background_pixels,
        'other_pixels': other_pixels,
        'signal_percentage': (signal_pixels / total_pixels) * 100,
        'is_binary': other_pixels == 0,
        'unique_values': np.unique(mask_array).tolist()
    }

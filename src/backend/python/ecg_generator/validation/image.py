"""
Image validation utilities for ECG dataset generation

Validates that generated images match expected A4 landscape dimensions (3507x2480 pixels at 300 DPI).
Images with incorrect dimensions are automatically renamed with SIZE_ERROR prefix for easier debugging.
"""

import os
from PIL import Image
from ecg_generator.config.constants import IMG_WIDTH_PX, IMG_HEIGHT_PX


def verify_image_size(image_path, expected_width=IMG_WIDTH_PX, expected_height=IMG_HEIGHT_PX):
    """
    Verify that an image has the expected dimensions

    Args:
        image_path (str): Path to the image file to validate
        expected_width (int): Expected width in pixels (default: 3507)
        expected_height (int): Expected height in pixels (default: 2480)

    Returns:
        tuple: (is_correct_size, actual_width, actual_height)
            - is_correct_size (bool): True if dimensions match expected values
            - actual_width (int): Actual image width in pixels
            - actual_height (int): Actual image height in pixels

    Raises:
        FileNotFoundError: If image file doesn't exist
        IOError: If image cannot be opened or read
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image file not found: {image_path}")

    try:
        with Image.open(image_path) as img:
            actual_width, actual_height = img.size
            is_correct = (actual_width == expected_width and actual_height == expected_height)
            return is_correct, actual_width, actual_height
    except Exception as e:
        raise IOError(f"Failed to open or read image {image_path}: {e}")


def rename_with_size_error_prefix(original_path, actual_width, actual_height):
    """
    Rename a file with SIZE_ERROR prefix to indicate incorrect dimensions

    This makes it easy to identify and debug images that didn't render at the correct size.
    Preserves page index (_pN) if present in the filename.

    Args:
        original_path (str): Original file path
        actual_width (int): Actual image width in pixels
        actual_height (int): Actual image height in pixels

    Returns:
        str: New file path with format: SIZE_ERROR_WIDTHxHEIGHT_original_filename.ext
             Example: SIZE_ERROR_3500x2480_ECG_001_01_p0.png
    """
    directory = os.path.dirname(original_path)
    filename = os.path.basename(original_path)

    # Preserve page index if present (e.g., _p0, _p1)
    # Split on _p to detect page index, then reassemble correctly
    if "_p" in filename:
        # Extract page suffix and reattach after SIZE_ERROR prefix
        name_without_ext, ext = os.path.splitext(filename)
        parts = name_without_ext.rsplit("_p", 1)
        if len(parts) == 2:
            base_name, page_suffix = parts
            new_filename = f"SIZE_ERROR_{actual_width}x{actual_height}_{base_name}_p{page_suffix}{ext}"
        else:
            # Fallback if split didn't work as expected
            new_filename = f"SIZE_ERROR_{actual_width}x{actual_height}_{filename}"
    else:
        # No page index, use standard naming
        new_filename = f"SIZE_ERROR_{actual_width}x{actual_height}_{filename}"

    new_path = os.path.join(directory, new_filename)

    if os.path.exists(original_path):
        os.rename(original_path, new_path)

    return new_path


def validate_and_rename_if_needed(image_path, expected_width=IMG_WIDTH_PX, expected_height=IMG_HEIGHT_PX):
    """
    Validate image size and rename with SIZE_ERROR prefix if incorrect

    This is the main entry point for image validation. It checks dimensions and
    automatically handles renaming for size errors with warning messages.

    Args:
        image_path (str): Path to the image file to validate
        expected_width (int): Expected width in pixels (default: 3507)
        expected_height (int): Expected height in pixels (default: 2480)

    Returns:
        tuple: (final_path, is_correct_size, actual_width, actual_height)
            - final_path (str): Path to file (may differ from input if renamed)
            - is_correct_size (bool): True if dimensions match expected values
            - actual_width (int): Actual image width in pixels
            - actual_height (int): Actual image height in pixels
    """
    try:
        is_correct, actual_width, actual_height = verify_image_size(
            image_path, expected_width, expected_height
        )

        if not is_correct:
            new_path = rename_with_size_error_prefix(image_path, actual_width, actual_height)
            print(f"[WARNING] Size error detected: Expected {expected_width}x{expected_height}, "
                  f"got {actual_width}x{actual_height}")
            print(f"[WARNING] File renamed: {os.path.basename(image_path)} -> {os.path.basename(new_path)}")
            return new_path, is_correct, actual_width, actual_height

        return image_path, is_correct, actual_width, actual_height

    except (FileNotFoundError, IOError) as e:
        print(f"[ERROR] Image validation failed: {e}")
        return image_path, False, 0, 0  # Return original path with error indicators

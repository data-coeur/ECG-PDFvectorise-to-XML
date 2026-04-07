"""Output validation for ECG generation."""

from .image import verify_image_size, rename_with_size_error_prefix, validate_and_rename_if_needed

__all__ = [
    'verify_image_size',
    'rename_with_size_error_prefix',
    'validate_and_rename_if_needed',
]

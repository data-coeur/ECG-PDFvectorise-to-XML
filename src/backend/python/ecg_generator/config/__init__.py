"""Configuration system for ECG generation."""

from .constants import *
from .manager import validate_and_fix_config

__all__ = [
    'validate_and_fix_config',
]

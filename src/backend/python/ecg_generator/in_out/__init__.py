"""Input/Output operations for ECG generation."""

from .xml_parser import load_ecg_from_xml
from .data_source import create_data_source

__all__ = [
    'load_ecg_from_xml',
    'create_data_source',
]

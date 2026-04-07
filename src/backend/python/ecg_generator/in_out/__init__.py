"""Input/Output operations for ECG generation."""

from .xml_parser import load_ecg_from_xml, load_ecg_data
from .csv_writer import DatasetCSVWriter
from .performance_logger import PerformanceLogger, TimingContext
from .data_source import (
    ECGDataSource,
    XMLSource,
    HDF5Source,
    create_data_source,
    get_input_sources,
    SUPPORTED_EXTENSIONS,
)

__all__ = [
    # Legacy exports (backward compatibility)
    'load_ecg_from_xml',
    'load_ecg_data',
    # New data source abstraction
    'ECGDataSource',
    'XMLSource',
    'HDF5Source',
    'create_data_source',
    'get_input_sources',
    'SUPPORTED_EXTENSIONS',
    # Other utilities
    'DatasetCSVWriter',
    'PerformanceLogger',
    'TimingContext',
]

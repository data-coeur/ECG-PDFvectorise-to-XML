"""
ECG Data Source — XML-only.

Loads a single ECG from one XML file. The upstream package also supported HDF5,
WFDB, CSV, and NumPy sources; only XML is exercised by this repo, so everything
else has been removed.
"""

import os
from typing import Dict, Iterator, Optional, Tuple

import numpy as np

from .xml_parser import load_ecg_from_xml


class XMLSource:
    """Single ECG from an XML file. ECG ID is the filename stem."""

    def __init__(self, file_path: str):
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"XML file not found: {file_path}")
        self._file_path = file_path
        self._ecg_id = os.path.splitext(os.path.basename(file_path))[0]
        self._leads_data: Optional[Dict[str, np.ndarray]] = None

    def __iter__(self) -> Iterator[Tuple[str, Dict[str, np.ndarray]]]:
        if self._leads_data is None:
            self._leads_data = load_ecg_from_xml(self._file_path)
        yield (self._ecg_id, self._leads_data)

    def __len__(self) -> int:
        return 1

    @property
    def source_path(self) -> str:
        return self._file_path


def create_data_source(file_path: str) -> XMLSource:
    """Return an XMLSource for the given file; fail loudly on any other extension."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    ext = os.path.splitext(file_path)[1].lower()
    if ext != ".xml":
        raise ValueError(f"Unsupported file format: {ext}. Only .xml is supported.")
    return XMLSource(file_path)

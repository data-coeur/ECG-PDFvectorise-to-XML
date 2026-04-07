"""
ECG Data Source Abstraction Module

Provides a unified interface for loading ECG data from various sources:
- XML files (single ECG per file)
- HDF5 files (batch ECGs with multiple records)
- WFDB / PhysioNet format (.hea/.dat)
- CSV files (header = lead names, rows = mV values)
- NumPy files (.npy / .npz)

The abstraction decouples ECG identity from file names, allowing proper
handling of batch files where one file contains multiple ECGs.
"""

from abc import ABC, abstractmethod
from typing import Iterator, Tuple, Dict, List, Optional
import csv as _csv
import numpy as np
import os
import glob
import warnings
import h5py

from .xml_parser import load_ecg_from_xml


# Standard 12-lead ECG order
STANDARD_LEAD_ORDER = ["I", "II", "III", "aVR", "aVL", "aVF",
                       "V1", "V2", "V3", "V4", "V5", "V6"]

# Supported file extensions (used for directory scanning)
SUPPORTED_EXTENSIONS = ['.xml', '.hdf5', '.h5', '.hea', '.csv', '.npy', '.npz']

# Target sampling rate for the pipeline (Hz)
TARGET_SAMPLING_RATE = 500

# HDF5 lead name mapping: hdf5_key -> standard_name
HDF5_LEAD_MAPPING = {
    'lead_i': 'I',
    'lead_ii': 'II',
    'lead_iii': 'III',
    'lead_avr': 'aVR',
    'lead_avl': 'aVL',
    'lead_avf': 'aVF',
    'lead_v1': 'V1',
    'lead_v2': 'V2',
    'lead_v3': 'V3',
    'lead_v4': 'V4',
    'lead_v5': 'V5',
    'lead_v6': 'V6',
}

# Lead name mapping for WFDB / CSV / general use: common variants -> standard
LEAD_NAME_MAPPING = {
    'i': 'I', 'I': 'I',
    'ii': 'II', 'II': 'II',
    'iii': 'III', 'III': 'III',
    'avr': 'aVR', 'aVR': 'aVR', 'AVR': 'aVR', 'avR': 'aVR',
    'avl': 'aVL', 'aVL': 'aVL', 'AVL': 'aVL', 'avL': 'aVL',
    'avf': 'aVF', 'aVF': 'aVF', 'AVF': 'aVF', 'avF': 'aVF',
    'v1': 'V1', 'V1': 'V1',
    'v2': 'V2', 'V2': 'V2',
    'v3': 'V3', 'V3': 'V3',
    'v4': 'V4', 'V4': 'V4',
    'v5': 'V5', 'V5': 'V5',
    'v6': 'V6', 'V6': 'V6',
}


def _import_wfdb():
    """Lazily import wfdb, raising a clear error if not installed."""
    try:
        import wfdb
        return wfdb
    except ImportError:
        raise ImportError(
            "The 'wfdb' package is required for WFDB (.hea/.dat) support. "
            "Install it with: pip install wfdb"
        )


def _resample_signal(signal_array: np.ndarray, original_fs: float,
                     target_fs: float = TARGET_SAMPLING_RATE) -> np.ndarray:
    """Resample a 1D signal from original_fs to target_fs."""
    if abs(original_fs - target_fs) < 0.5:
        return signal_array
    from scipy.signal import resample
    num_samples = int(len(signal_array) * target_fs / original_fs)
    return resample(signal_array, num_samples).astype(np.float64)


class ECGDataSource(ABC):
    """
    Abstract base class for ECG data sources.

    A data source yields (ecg_id, leads_data) tuples where:
    - ecg_id: Unique identifier for the ECG (used for naming output files)
    - leads_data: Dict mapping lead names to numpy arrays in mV
    """

    @abstractmethod
    def __iter__(self) -> Iterator[Tuple[str, Dict[str, np.ndarray]]]:
        """Yield (ecg_id, leads_data) tuples"""
        pass

    @abstractmethod
    def __len__(self) -> int:
        """Return total number of ECGs in this source"""
        pass

    @property
    @abstractmethod
    def source_path(self) -> str:
        """Return the original source file path"""
        pass

    def get_source_info(self) -> dict:
        """Return metadata about the source for logging/debugging"""
        return {
            'source_path': self.source_path,
            'count': len(self),
            'type': self.__class__.__name__
        }


class XMLSource(ECGDataSource):
    """
    Single ECG from XML file.

    ECG ID is derived from the filename stem.
    """

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


class HDF5Source(ECGDataSource):
    """
    Multiple ECGs from HDF5 file.

    ECG IDs come from the 'id' field in the HDF5 file.
    Leads are mapped from HDF5 keys (lead_i, lead_avr, etc.) to standard names (I, aVR, etc.).

    Supports optional slicing to process a subset of ECGs.
    Uses batch reads for performance (contiguous slices instead of row-by-row).
    """

    _READ_BATCH = 256  # rows per batch read — balances memory (~123MB) vs h5py overhead

    def __init__(self, file_path: str, start_index: int = 0, count: Optional[int] = None):
        """
        Args:
            file_path: Path to .hdf5 or .h5 file
            start_index: Index of first ECG to yield (default: 0)
            count: Number of ECGs to yield (default: all from start_index)
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"HDF5 file not found: {file_path}")

        self._file_path = file_path
        self._start_index = start_index
        self._count = count
        self._n_ecgs: Optional[int] = None
        self._h5file = None

    def _get_n_ecgs(self) -> int:
        """Get total number of ECGs in file (cached)"""
        if self._n_ecgs is None:
            with h5py.File(self._file_path, 'r') as f:
                self._n_ecgs = f['id'].shape[0]
        return self._n_ecgs

    def __iter__(self) -> Iterator[Tuple[str, Dict[str, np.ndarray]]]:

        n_total = self._get_n_ecgs()
        end_index = n_total
        if self._count is not None:
            end_index = min(self._start_index + self._count, n_total)

        with h5py.File(self._file_path, 'r') as f:
            ids_ds = f['id']
            lead_datasets = {k: f[k] for k in HDF5_LEAD_MAPPING}

            for batch_start in range(self._start_index, end_index, self._READ_BATCH):
                batch_end = min(batch_start + self._READ_BATCH, end_index)

                # One contiguous slice per dataset (13 reads per batch, not 13×batch_size)
                ids_batch = ids_ds[batch_start:batch_end]
                leads_batch = {
                    std: lead_datasets[h5k][batch_start:batch_end, :].astype(np.float64)
                    for h5k, std in HDF5_LEAD_MAPPING.items()
                }

                for local_i in range(batch_end - batch_start):
                    ecg_id = ids_batch[local_i]
                    if isinstance(ecg_id, bytes):
                        ecg_id = ecg_id.decode('utf-8')
                    yield (ecg_id, {name: leads_batch[name][local_i] for name in leads_batch})

    def iter_ids(self, start: Optional[int] = None, count: Optional[int] = None) -> Iterator[str]:
        """Yield ECG IDs without loading signal data (fast, for dry-run/csv-only).

        Args:
            start: Starting index (default: self._start_index)
            count: Number of IDs to yield (default: all from start)
        """
        s = start if start is not None else self._start_index
        n_total = self._get_n_ecgs()
        e = n_total if count is None else min(s + count, n_total)
        with h5py.File(self._file_path, 'r') as f:
            ids = f['id'][s:e]  # single contiguous read
            for ecg_id in ids:
                yield ecg_id.decode('utf-8') if isinstance(ecg_id, bytes) else ecg_id

    def __len__(self) -> int:
        n_total = self._get_n_ecgs()

        if self._count is not None:
            return min(self._count, n_total - self._start_index)
        return n_total - self._start_index

    @property
    def source_path(self) -> str:
        return self._file_path

    def get_source_info(self) -> dict:
        """Extended info for HDF5 sources"""
        info = super().get_source_info()
        info['start_index'] = self._start_index
        info['total_in_file'] = self._get_n_ecgs()
        if self._count is not None:
            info['requested_count'] = self._count
        return info


class WFDBSource(ECGDataSource):
    """
    ECG data from WFDB / PhysioNet format (.hea + .dat files).

    Supports PhysioNet databases (PTB-XL, MIMIC-IV-ECG, etc.).
    Signals are read as physical units and converted to mV.
    Non-500 Hz signals are resampled automatically.
    """

    def __init__(self, path: str):
        """
        Args:
            path: Path to a .hea file (single record) or directory of .hea files.
        """
        if os.path.isfile(path):
            if not path.endswith('.hea'):
                raise ValueError(f"WFDB source expects .hea file, got: {path}")
            self._dir_path = os.path.dirname(path) or '.'
            self._record_names = [os.path.splitext(os.path.basename(path))[0]]
        elif os.path.isdir(path):
            self._dir_path = path
            self._record_names = None  # discovered lazily
        else:
            raise FileNotFoundError(f"WFDB path not found: {path}")
        self._path = path

    def _get_record_names(self) -> List[str]:
        if self._record_names is None:
            hea_files = sorted(glob.glob(os.path.join(self._dir_path, "*.hea")))
            if not hea_files:
                raise ValueError(f"No .hea files found in: {self._dir_path}")
            self._record_names = [
                os.path.splitext(os.path.basename(f))[0] for f in hea_files
            ]
        return self._record_names

    def __iter__(self) -> Iterator[Tuple[str, Dict[str, np.ndarray]]]:
        wfdb = _import_wfdb()
        for record_name in self._get_record_names():
            record_path = os.path.join(self._dir_path, record_name)
            try:
                record = wfdb.rdrecord(record_path)
            except Exception as e:
                warnings.warn(f"Failed to read WFDB record {record_name}: {e}")
                continue

            leads_data = {}
            for col_idx, sig_name in enumerate(record.sig_name):
                standard = LEAD_NAME_MAPPING.get(sig_name.strip())
                if standard is None:
                    continue
                signal = record.p_signal[:, col_idx].astype(np.float64)
                # Unit conversion: uV -> mV
                unit = (record.units[col_idx] if record.units else '').lower()
                if unit in ('uv', 'microvolt', 'microvolts'):
                    signal = signal / 1000.0
                # Resample to 500 Hz if needed
                if record.fs and record.fs != TARGET_SAMPLING_RATE:
                    signal = _resample_signal(signal, record.fs)
                leads_data[standard] = signal

            if not leads_data:
                warnings.warn(
                    f"WFDB record {record_name}: no recognizable leads "
                    f"(signal names: {record.sig_name})"
                )
                continue
            yield (record_name, leads_data)

    def __len__(self) -> int:
        return len(self._get_record_names())

    @property
    def source_path(self) -> str:
        return self._path


class CSVSource(ECGDataSource):
    """
    Single ECG from a CSV file.

    Expected format: header row with lead names, data rows with mV values.
    One file = one ECG. ECG ID derived from filename.

    Example::

        I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6
        0.1,0.2,0.1,-0.15,0.0,0.15,...
    """

    def __init__(self, file_path: str):
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"CSV file not found: {file_path}")
        self._file_path = file_path
        self._ecg_id = os.path.splitext(os.path.basename(file_path))[0]

    def __iter__(self) -> Iterator[Tuple[str, Dict[str, np.ndarray]]]:
        with open(self._file_path, 'r', newline='') as f:
            reader = _csv.reader(f)
            header = [h.strip() for h in next(reader)]
            rows = [[float(v.strip()) for v in row] for row in reader]

        if not rows:
            warnings.warn(f"CSV file {self._file_path} has no data rows")
            return

        data = np.array(rows, dtype=np.float64)
        leads_data = {}
        for col_idx, col_name in enumerate(header):
            standard = LEAD_NAME_MAPPING.get(col_name, col_name)
            if standard in STANDARD_LEAD_ORDER:
                leads_data[standard] = data[:, col_idx]

        if not leads_data:
            warnings.warn(
                f"CSV {self._file_path}: no recognizable lead columns. "
                f"Header: {header}"
            )
            return

        yield (self._ecg_id, leads_data)

    def __len__(self) -> int:
        return 1

    @property
    def source_path(self) -> str:
        return self._file_path


class NumpySource(ECGDataSource):
    """
    Single ECG from a NumPy file (.npy or .npz).

    .npy: 2D array — auto-detects (12, N) vs (N, 12).
    .npz: tries lead-named keys first, then 'signals' + optional 'leads' array.
    Values must be in millivolts. One file = one ECG.
    """

    def __init__(self, file_path: str):
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"NumPy file not found: {file_path}")
        self._file_path = file_path
        self._ecg_id = os.path.splitext(os.path.basename(file_path))[0]

    def __iter__(self) -> Iterator[Tuple[str, Dict[str, np.ndarray]]]:
        ext = os.path.splitext(self._file_path)[1].lower()
        if ext == '.npy':
            leads_data = self._load_npy()
        else:
            leads_data = self._load_npz()
        if leads_data:
            yield (self._ecg_id, leads_data)

    def _load_npy(self) -> Dict[str, np.ndarray]:
        arr = np.load(self._file_path)
        if arr.ndim != 2:
            raise ValueError(f".npy must be 2D, got shape {arr.shape}")
        # Determine orientation
        if arr.shape[0] == 12 and arr.shape[1] != 12:
            signals = arr
        elif arr.shape[1] == 12 and arr.shape[0] != 12:
            signals = arr.T
        elif arr.shape[0] == 12:
            signals = arr
        else:
            raise ValueError(
                f".npy must have 12 along one axis (12-lead ECG), got {arr.shape}"
            )
        return {
            name: signals[i].astype(np.float64)
            for i, name in enumerate(STANDARD_LEAD_ORDER) if i < signals.shape[0]
        }

    def _load_npz(self) -> Dict[str, np.ndarray]:
        data = np.load(self._file_path)
        # Try lead-named keys
        leads_data = {}
        for key in data.files:
            standard = LEAD_NAME_MAPPING.get(key, key)
            if standard in STANDARD_LEAD_ORDER:
                leads_data[standard] = data[key].astype(np.float64)
        if leads_data:
            return leads_data
        # Fallback: 'signals' array + optional 'leads'
        if 'signals' not in data.files:
            raise ValueError(
                f".npz has no recognizable keys. "
                f"Expected lead names or 'signals'. Got: {data.files}"
            )
        signals = data['signals']
        lead_names = (
            [str(l) for l in data['leads']] if 'leads' in data.files
            else STANDARD_LEAD_ORDER
        )
        if signals.ndim != 2:
            raise ValueError(f"'signals' must be 2D, got {signals.shape}")
        if signals.shape[0] == len(lead_names):
            for i, name in enumerate(lead_names):
                std = LEAD_NAME_MAPPING.get(name, name)
                if std in STANDARD_LEAD_ORDER:
                    leads_data[std] = signals[i].astype(np.float64)
        elif signals.shape[1] == len(lead_names):
            for i, name in enumerate(lead_names):
                std = LEAD_NAME_MAPPING.get(name, name)
                if std in STANDARD_LEAD_ORDER:
                    leads_data[std] = signals[:, i].astype(np.float64)
        return leads_data

    def __len__(self) -> int:
        return 1

    @property
    def source_path(self) -> str:
        return self._file_path


def create_data_source(file_path: str, **kwargs) -> ECGDataSource:
    """
    Factory function to create appropriate ECGDataSource based on file format.

    Automatically detects format from file extension:
    - XML (.xml) -> XMLSource
    - HDF5 (.hdf5, .h5) -> HDF5Source
    - WFDB (.hea) -> WFDBSource
    - CSV (.csv) -> CSVSource
    - NumPy (.npy, .npz) -> NumpySource

    Args:
        file_path: Path to ECG data file
        **kwargs: Additional arguments (e.g. start_index, count for HDF5)

    Returns:
        ECGDataSource instance
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    ext = os.path.splitext(file_path)[1].lower()

    if ext == '.xml':
        return XMLSource(file_path)
    elif ext in ['.hdf5', '.h5']:
        return HDF5Source(file_path, **kwargs)
    elif ext == '.hea':
        return WFDBSource(file_path)
    elif ext == '.dat':
        hea_path = os.path.splitext(file_path)[0] + '.hea'
        if os.path.exists(hea_path):
            return WFDBSource(hea_path)
        raise ValueError(f"WFDB .dat file requires companion .hea: {hea_path}")
    elif ext == '.csv':
        return CSVSource(file_path)
    elif ext in ['.npy', '.npz']:
        return NumpySource(file_path)
    else:
        raise ValueError(
            f"Unsupported file format: {ext}. "
            f"Supported formats: {', '.join(SUPPORTED_EXTENSIONS)}"
        )


def get_input_sources(input_path: str, mode: str = "random",
                      single_source: Optional[str] = None,
                      single_index: int = 0) -> List[ECGDataSource]:
    """
    Get list of ECG data sources to process based on mode and options.

    This replaces the old get_input_files() function with a more flexible
    data source abstraction that properly handles HDF5 batch files.

    Args:
        input_path: Input directory or file path
        mode: "random" (all files) or "single" (one file/ECG)
        single_source: Specific file path for single mode
        single_index: Index of file to select in single mode (if directory),
                      or index of ECG within HDF5 file

    Returns:
        List of ECGDataSource instances

    Raises:
        FileNotFoundError: If files/directory don't exist
        ValueError: If format is unsupported or no files found
        IndexError: If single_index is out of range
    """
    def is_supported_file(filepath: str) -> bool:
        return os.path.splitext(filepath)[1].lower() in SUPPORTED_EXTENSIONS

    # Single mode with explicit source file
    if mode == "single" and single_source:
        if not os.path.exists(single_source):
            raise FileNotFoundError(f"Single source file not found: {single_source}")
        if not is_supported_file(single_source):
            raise ValueError(f"Unsupported file format: {single_source}")

        ext = os.path.splitext(single_source)[1].lower()

        # For HDF5 files in single mode, use single_index to select one ECG
        if ext in ['.hdf5', '.h5']:
            return [HDF5Source(single_source, start_index=single_index, count=1)]
        else:
            return [create_data_source(single_source)]

    # Get list of files to process
    if os.path.isdir(input_path):
        all_files = []
        for ext in SUPPORTED_EXTENSIONS:
            all_files.extend(glob.glob(os.path.join(input_path, f"*{ext}")))

        files = sorted(all_files)

        if not files:
            raise ValueError(
                f"No ECG files found in directory: {input_path}. "
                f"Supported formats: {', '.join(SUPPORTED_EXTENSIONS)}"
            )
    else:
        # Single file provided as input_path
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Input file not found: {input_path}")
        if not is_supported_file(input_path):
            raise ValueError(f"Unsupported file format: {input_path}")
        files = [input_path]

    # Apply single mode filtering if needed (for directory with multiple files)
    if mode == "single" and os.path.isdir(input_path):
        if single_index >= len(files):
            raise IndexError(
                f"Single index {single_index} out of range (0-{len(files)-1})"
            )
        files = [files[single_index]]

    # Create data sources for all files
    return [create_data_source(f) for f in files]


def distribute_offset_limit(sources: List[ECGDataSource], offset: int = 0,
                            limit: Optional[int] = None) -> List[tuple]:
    """
    Distribute global offset/limit across multiple sources without loading data.

    Uses each source's __len__() to compute per-source (local_start, local_count)
    slicing parameters. For HDF5Source, len() only reads dataset shape metadata.

    Args:
        sources: List of ECGDataSource instances
        offset: Number of ECGs to skip globally
        limit: Maximum number of ECGs to yield globally (None = all)

    Returns:
        List of (source, local_start, local_count) tuples.
        Sources fully skipped by offset are omitted.
    """
    result = []
    remaining_skip = offset
    remaining_take = limit

    for source in sources:
        n = len(source)
        if remaining_skip >= n:
            remaining_skip -= n
            continue
        local_start = remaining_skip
        remaining_skip = 0
        available = n - local_start
        local_count = min(available, remaining_take) if remaining_take is not None else available
        if remaining_take is not None:
            remaining_take -= local_count
        if local_count > 0:
            result.append((source, local_start, local_count))
        if remaining_take is not None and remaining_take <= 0:
            break
    return result


def iter_sources_sliced(source_slices: List[tuple]) -> Iterator[Tuple['ECGDataSource', str, Dict[str, np.ndarray]]]:
    """
    Lazily yield (source, ecg_id, leads_data) from pre-computed source slices.

    For HDF5Source, creates a sub-view with the exact start_index/count to avoid
    reading data outside the requested range. Other sources are iterated with
    skip/take logic.

    Args:
        source_slices: Output of distribute_offset_limit()

    Yields:
        (source, ecg_id, leads_data) tuples
    """
    for source, local_start, local_count in source_slices:
        if isinstance(source, HDF5Source):
            sub = HDF5Source(
                source._file_path,
                start_index=source._start_index + local_start,
                count=local_count
            )
            for ecg_id, leads_data in sub:
                yield (sub, ecg_id, leads_data)
        else:
            for i, (ecg_id, leads_data) in enumerate(source):
                if i < local_start:
                    continue
                if i >= local_start + local_count:
                    break
                yield (source, ecg_id, leads_data)

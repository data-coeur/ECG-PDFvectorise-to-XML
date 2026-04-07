"""
Unified NPZ schema for ECG Pipeline 1 and Pipeline 2.

Same structure for both pipelines. All coordinates in output (image) space
except grid line positions which are in P1 reference space.

Coordinate convention: y=0 at top (image space), x=0 at left.
"""

import os
import numpy as np
import logging

logger = logging.getLogger(__name__)

# ─── Key name constants ───────────────────────────────────────────────

# Metadata
KEY_LAYOUT_TYPE = 'layout_type'
KEY_CHANNEL_NAMES = 'channel_names'
KEY_SPEED = 'speed_mm_per_s'
KEY_GAIN = 'gain_mm_per_mV'
KEY_PAGE_WIDTH = 'page_width_px'
KEY_PAGE_HEIGHT = 'page_height_px'
KEY_NOMENCLATURE_PERIPH = 'nomenclature_periph'
KEY_NOMENCLATURE_PRECORD = 'nomenclature_precord'
KEY_SAMPLING_RATE = 'sampling_rate_hz'

# Grid geometry (1D positions in P1 reference space)
KEY_GRID_MAJOR_X = 'grid_major_x'
KEY_GRID_MAJOR_Y = 'grid_major_y'
KEY_GRID_MINOR_X = 'grid_minor_x'
KEY_GRID_MINOR_Y = 'grid_minor_y'
KEY_GRID_X_RANGE = 'grid_x_range'
KEY_GRID_Y_RANGE = 'grid_y_range'

# Grid intersections (Nx2 in output space)
KEY_GRID_MAJOR_5MM = 'grid_major_5mm'
KEY_GRID_MINOR_1MM = 'grid_minor_1mm'

# Labels
KEY_LABEL_CENTERS = 'label_centers'
KEY_LABEL_NAMES = 'label_names'

# Maps (uint16 absolute coordinates, encoding v2)
# Forward map: P1→P2 (source→dest). map_forward[y_p1, x_p1] = coord_p2
# Inverse map: P2→P1 (dest→source, cv2.remap). map_inverse[y_p2, x_p2] = coord_p1
KEY_MAP_FORWARD_X = 'map_forward_x'
KEY_MAP_FORWARD_Y = 'map_forward_y'
KEY_MAP_INVERSE_X = 'map_inverse_x'
KEY_MAP_INVERSE_Y = 'map_inverse_y'
KEY_MAP_ENCODING_VERSION = 'map_encoding_version'
# Encoding versions: 1 = int16 * 4 (legacy), 2 = uint16 * (coord+200) * 16 (current)

# P2-only metadata (optional)
KEY_AUG_BRANCH = 'augmentation_branch'
KEY_AUG_SEED = 'augmentation_seed'
KEY_APPLIED_AUGS = 'applied_augmentations'
KEY_OUTPUT_PRESET = 'output_preset'

# Signal prefix
SIGNAL_PREFIX = 'signal_'


# ─── Required keys ────────────────────────────────────────────────────

REQUIRED_METADATA_KEYS = [
    KEY_LAYOUT_TYPE, KEY_CHANNEL_NAMES, KEY_SPEED, KEY_GAIN,
    KEY_PAGE_WIDTH, KEY_PAGE_HEIGHT,
    KEY_NOMENCLATURE_PERIPH, KEY_NOMENCLATURE_PRECORD,
]

REQUIRED_GRID_KEYS = [
    KEY_GRID_MAJOR_X, KEY_GRID_MAJOR_Y,
    KEY_GRID_MINOR_X, KEY_GRID_MINOR_Y,
    KEY_GRID_X_RANGE, KEY_GRID_Y_RANGE,
    KEY_GRID_MAJOR_5MM, KEY_GRID_MINOR_1MM,
]

REQUIRED_MAP_KEYS = [
    KEY_MAP_FORWARD_X, KEY_MAP_FORWARD_Y,
    KEY_MAP_INVERSE_X, KEY_MAP_INVERSE_Y,
]


# ─── Save / Load ──────────────────────────────────────────────────────

def save_unified_npz(path, data_dict):
    """
    Save ECG data in unified NPZ format.

    Args:
        path: output .npz file path
        data_dict: dict with all required keys + signal arrays

    Validates required keys before saving.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)

    # Validate required keys
    missing = []
    for key in REQUIRED_METADATA_KEYS + REQUIRED_GRID_KEYS + REQUIRED_MAP_KEYS:
        if key not in data_dict:
            missing.append(key)

    # Check at least one signal key
    signal_keys = [k for k in data_dict if k.startswith(SIGNAL_PREFIX)]
    if not signal_keys:
        missing.append('signal_* (at least one)')

    if KEY_LABEL_CENTERS not in data_dict:
        missing.append(KEY_LABEL_CENTERS)
    if KEY_LABEL_NAMES not in data_dict:
        missing.append(KEY_LABEL_NAMES)

    if missing:
        logger.warning(f"NPZ missing keys: {missing}")

    np.savez_compressed(path, **data_dict)
    logger.info(f"Saved unified NPZ: {path} ({len(data_dict)} keys, "
                f"{os.path.getsize(path) / 1024 / 1024:.1f} MB)")
    return path


def load_unified_npz(path):
    """
    Load ECG data from unified NPZ format.

    Args:
        path: .npz file path

    Returns:
        dict with all stored arrays/values
    """
    import zipfile
    try:
        raw = np.load(path, allow_pickle=True)
    except (zipfile.BadZipFile, ValueError, OSError) as e:
        raise IOError(f"Corrupted or truncated NPZ file: {path} — {e}") from e
    data = {}
    for key in raw.files:
        val = raw[key]
        # Unwrap 0-d arrays (scalars stored by numpy)
        if isinstance(val, np.ndarray) and val.ndim == 0:
            data[key] = val.item()
        else:
            data[key] = val
    return data


def get_signal_keys(data):
    """Return sorted list of signal_* keys from NPZ data dict.

    Filters out non-array entries like signal_line_width_px,
    and legacy resampled variants (signal_*_resampled_*).
    """
    import numpy as np
    return sorted(
        k for k in data
        if k.startswith(SIGNAL_PREFIX)
        and '_resampled_' not in k
        and isinstance(data[k], np.ndarray)
        and data[k].ndim == 2
    )


def is_p2_npz(data):
    """Check if NPZ is from Pipeline 2 (has augmentation metadata)."""
    return KEY_APPLIED_AUGS in data


def validate_npz(data):
    """
    Validate NPZ data dict has correct structure.

    Returns:
        (is_valid, list_of_issues)
    """
    issues = []

    for key in REQUIRED_METADATA_KEYS:
        if key not in data:
            issues.append(f"Missing metadata: {key}")

    for key in REQUIRED_GRID_KEYS:
        if key not in data:
            issues.append(f"Missing grid: {key}")

    for key in REQUIRED_MAP_KEYS:
        if key not in data:
            issues.append(f"Missing map: {key}")
        elif key in data:
            arr = data[key]
            if not isinstance(arr, np.ndarray) or arr.dtype not in (np.int16, np.uint16):
                issues.append(f"{key}: expected int16/uint16, got {getattr(arr, 'dtype', type(arr))}")

    signal_keys = get_signal_keys(data)
    if not signal_keys:
        issues.append("No signal_* keys found")
    for sk in signal_keys:
        arr = data[sk]
        if not isinstance(arr, np.ndarray) or arr.ndim != 2 or arr.shape[1] != 3:
            issues.append(f"{sk}: expected Nx3, got shape {getattr(arr, 'shape', '?')}")

    if KEY_GRID_MAJOR_5MM in data:
        arr = data[KEY_GRID_MAJOR_5MM]
        if arr.ndim != 2 or arr.shape[1] != 2:
            issues.append(f"{KEY_GRID_MAJOR_5MM}: expected Nx2, got {arr.shape}")

    if KEY_LABEL_CENTERS not in data:
        issues.append(f"Missing {KEY_LABEL_CENTERS}")
    if KEY_LABEL_NAMES not in data:
        issues.append(f"Missing {KEY_LABEL_NAMES}")

    return len(issues) == 0, issues

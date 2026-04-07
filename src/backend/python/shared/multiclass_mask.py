"""
Multi-channel grayscale segmentation mask generation.

Combines existing mask PNGs into a single .npy with shape (H, W, N_classes).
Each channel holds the grayscale intensity (0-255) for that class, preserving
soft boundaries from anti-aliased rendering and INTER_AREA downscaling.

Channel mapping (20 channels):
    0 = Background (inverse of all other channels combined)
    1 = Grid (major + minor combined)
    2-13 = 12 leads: I, II, III, aVR, aVL, aVF, V1-V6
    14 = Reference pulse
    15 = Lead labels
    16 = Medical text
    17 = Black square
    18 = Etiquette (P2 only)
    19 = Handwriting (P2 only)

Overlapping classes (e.g., grid + signal at same pixel) each retain their
grayscale values independently — no priority overwrite.
"""

import os
import re
import numpy as np
from PIL import Image


# Lead name → channel index
LEAD_CLASS_MAP = {
    'I': 2, 'II': 3, 'III': 4,
    'aVR': 5, 'aVL': 6, 'aVF': 7,
    'V1': 8, 'V2': 9, 'V3': 10,
    'V4': 11, 'V5': 12, 'V6': 13,
}

# Number of channels
NUM_CLASSES = 20

# Regex to strip segment/extra suffix from channel name
_SUFFIX_RE = re.compile(r'(_seg\d+|_extra)$')


def _base_lead_name(channel_name):
    """Strip segment/extra suffix to get base lead name."""
    return _SUFFIX_RE.sub('', channel_name)


def _read_grayscale(path):
    """Read mask PNG as uint8 grayscale array (0-255)."""
    return np.array(Image.open(path).convert('L'))


def generate_multiclass_mask(mask_dir, output_path, annotation_dir=None):
    """
    Generate multi-channel grayscale segmentation mask from existing mask PNGs.

    Each class gets its own channel with full grayscale values (0-255).
    Overlapping classes retain independent values (no priority overwrite).
    Channel 0 (background) = 255 where no other class has content, 0 elsewhere.

    Works for both P1 and P2. P2-specific masks (etiquette, handwriting)
    are included only if they exist in annotation_dir (or mask_dir).

    Args:
        mask_dir: Directory containing mask PNGs (grid, signal, text, etc.)
        output_path: Path to save .npy mask (H, W, 20) uint8
        annotation_dir: Optional directory with P2 annotation masks.

    Returns:
        str: Path to saved .npy file
    """
    # Get image dimensions from any existing mask
    mask_files = sorted(f for f in os.listdir(mask_dir) if f.endswith('.png'))
    if not mask_files:
        raise ValueError(f"No mask PNGs found in {mask_dir}")

    ref_img = Image.open(os.path.join(mask_dir, mask_files[0]))
    width, height = ref_img.size
    ref_img.close()

    mask = np.zeros((height, width, NUM_CLASSES), dtype=np.uint8)

    # 1. Grid (channel 1) — use combined if available, otherwise max(major, minor)
    grid_combined = os.path.join(mask_dir, 'mask_grid_combined.png')
    grid_major = os.path.join(mask_dir, 'mask_grid_major.png')
    grid_minor = os.path.join(mask_dir, 'mask_grid_minor.png')
    if os.path.exists(grid_combined):
        mask[:, :, 1] = _read_grayscale(grid_combined)
    else:
        if os.path.exists(grid_major):
            mask[:, :, 1] = np.maximum(mask[:, :, 1], _read_grayscale(grid_major))
        if os.path.exists(grid_minor):
            mask[:, :, 1] = np.maximum(mask[:, :, 1], _read_grayscale(grid_minor))

    # 2. Lead labels (channel 15)
    lead_labels_path = os.path.join(mask_dir, 'mask_lead_labels.png')
    if os.path.exists(lead_labels_path):
        mask[:, :, 15] = _read_grayscale(lead_labels_path)

    # 3. Medical text (channel 16)
    medical_text_path = os.path.join(mask_dir, 'mask_medical_text.png')
    if os.path.exists(medical_text_path):
        mask[:, :, 16] = _read_grayscale(medical_text_path)

    # 4. Black square (channel 17)
    black_square_path = os.path.join(mask_dir, 'mask_black_square.png')
    if os.path.exists(black_square_path):
        mask[:, :, 17] = _read_grayscale(black_square_path)

    # 5. Reference pulse (channel 14)
    ref_pulse_path = os.path.join(mask_dir, 'mask_reference_pulse.png')
    if os.path.exists(ref_pulse_path):
        mask[:, :, 14] = _read_grayscale(ref_pulse_path)

    # 6. Signal leads (channels 2-13) — max across segments/extras per lead
    for fname in sorted(mask_files):
        if not fname.startswith('mask_signal_') or fname == 'mask_signal_all.png':
            continue
        channel_name = fname[len('mask_signal_'):-len('.png')]
        base_lead = _base_lead_name(channel_name)
        class_id = LEAD_CLASS_MAP.get(base_lead)
        if class_id is None:
            continue
        fpath = os.path.join(mask_dir, fname)
        arr = _read_grayscale(fpath)
        mask[:, :, class_id] = np.maximum(mask[:, :, class_id], arr)

    # 7. Etiquette (channel 18) — P2 only
    annot_dirs = [d for d in [annotation_dir, mask_dir] if d is not None]
    for d in annot_dirs:
        etiquette_path = os.path.join(d, 'mask_etiquette.png')
        if os.path.exists(etiquette_path):
            mask[:, :, 18] = _read_grayscale(etiquette_path)
            break

    # 8. Handwriting (channel 19) — P2 only
    for d in annot_dirs:
        handwriting_path = os.path.join(d, 'mask_handwriting.png')
        if os.path.exists(handwriting_path):
            mask[:, :, 19] = _read_grayscale(handwriting_path)
            break

    # 0. Background (channel 0) — 255 where no foreground class has content
    foreground_max = mask[:, :, 1:].max(axis=2)
    mask[:, :, 0] = np.where(foreground_max > 0, 0, 255).astype(np.uint8)

    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    # Use compressed format — (H,W,20) uint8 is ~191 MB uncompressed but ~5-15 MB compressed
    if output_path.endswith('.npz'):
        np.savez_compressed(output_path, mask=mask)
    else:
        # Legacy .npy path — switch extension to .npz
        npz_path = output_path.replace('.npy', '.npz')
        np.savez_compressed(npz_path, mask=mask)
        output_path = npz_path
    return output_path

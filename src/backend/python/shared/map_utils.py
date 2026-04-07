"""
Forward/inverse coordinate maps for ECG pipeline.

CV Terminology:
  Forward map: P1→P2 (source→destination).
    map_forward[y_p1, x_p1] = coord_p2
    "Where does each P1 pixel land in P2?"

  Inverse map: P2→P1 (destination→source, used by cv2.remap).
    map_inverse[y_p2, x_p2] = coord_p1
    "Where does each P2 pixel come from in P1?"

  cv2.remap(P1_image, inverse_x, inverse_y) → P2_image
  cv2.remap(P2_image, forward_x, forward_y) → P1_image

Maps store ABSOLUTE coordinates (not displacements).
Encoding: uint16, stored = round((coord + COORD_OFFSET) * COORD_SCALE).
  Precision: 0.0625 px. Range: [-200, +3895.9] px.
  Retrocompatible: map_encoding_version=1 uses old int16*4 encoding.

P1: identity maps (forward_x[y,x] = x, forward_y[y,x] = y).
P2: composite of all augmentations.

Inverse computed via Chen et al. 2008 fixed-point iteration
(Medical Physics, "A simple fixed-point approach to invert a deformation field").
"""

import numpy as np
import cv2
import logging

logger = logging.getLogger(__name__)

# uint16 encoding: stored = round((coord + COORD_OFFSET) * COORD_SCALE)
# Precision: 1/16 = 0.0625 px. Range: [-200.0, +3895.9375] px.
COORD_SCALE = 16
COORD_OFFSET = 200.0

# Legacy int16 encoding (map_encoding_version=1): stored = round(coord * 4)
_LEGACY_COORD_SCALE = 4


def encode_map_uint16(coord_map_float):
    """
    Encode float32 coordinate map to uint16.

    Formula: stored = round((coord + COORD_OFFSET) * COORD_SCALE)
    Precision: 0.0625 px. Range: [-200, +3895.9] px.
    """
    return np.clip(
        np.round((coord_map_float + COORD_OFFSET) * COORD_SCALE), 0, 65535
    ).astype(np.uint16)


# Keep old name as alias for backward compatibility in external code
encode_map_int16 = encode_map_uint16


def decode_map_float(encoded_map, encoding_version=2):
    """
    Decode coordinate map to float32 (retrocompatible).

    Args:
        encoded_map: uint16 or int16 array (H, W)
        encoding_version: 1 = legacy int16*4, 2 = uint16*(coord+200)*16

    Forward map: P1→P2. map_forward[y_p1, x_p1] = coord_p2
    Inverse map: P2→P1. map_inverse[y_p2, x_p2] = coord_p1
    """
    if encoding_version == 1:
        # Legacy: int16, stored = round(coord * 4), precision 0.25 px
        return encoded_map.astype(np.float32) / _LEGACY_COORD_SCALE
    else:
        # Current: uint16, stored = round((coord + 200) * 16), precision 0.0625 px
        return encoded_map.astype(np.float32) / COORD_SCALE - COORD_OFFSET


def identity_maps_encoded(width, height):
    """
    Create identity maps for Pipeline 1 (no augmentation).
    Forward map = inverse map = identity (P1 coords = P2 coords).

    Returns:
        (forward_x, forward_y, inverse_x, inverse_y) all uint16 (H, W)
    """
    yy, xx = np.mgrid[0:height, 0:width]
    fx = encode_map_uint16(xx.astype(np.float32))
    fy = encode_map_uint16(yy.astype(np.float32))
    return fx, fy, fx.copy(), fy.copy()


# Keep old name as alias
identity_maps_int16 = identity_maps_encoded


def _fix_forward_map_borders(fwd, margin=50):
    """
    Fix forward map border artifacts caused by Newton iteration divergence
    in the displacement transform near image edges.

    Detects non-monotonic columns/rows near borders and replaces them
    with linear extrapolation from the clean interior.

    Args:
        fwd: (H, W) float32 forward map (one axis: x or y)
        margin: how many border pixels to check and fix
    """
    h, w = fwd.shape
    m = min(margin, w // 4, h // 4)

    # Fix left/right columns using row-wise linear extrapolation from interior
    # Use two anchor columns from the clean interior to extrapolate
    a1, a2 = m, m + 1  # anchor columns (known good)
    slope = fwd[:, a2] - fwd[:, a1]  # per-row slope
    for c in range(a1):
        fwd[:, c] = fwd[:, a1] + slope * (c - a1)

    a1, a2 = w - m - 2, w - m - 1  # anchor columns from right
    slope = fwd[:, a2] - fwd[:, a1]
    for c in range(w - m, w):
        fwd[:, c] = fwd[:, a2] + slope * (c - a2)

    # Fix top/bottom rows using column-wise linear extrapolation from interior
    a1, a2 = m, m + 1
    slope = fwd[a2, :] - fwd[a1, :]
    for r in range(a1):
        fwd[r, :] = fwd[a1, :] + slope * (r - a1)

    a1, a2 = h - m - 2, h - m - 1
    slope = fwd[a2, :] - fwd[a1, :]
    for r in range(h - m, h):
        fwd[r, :] = fwd[a2, :] + slope * (r - a2)

    return fwd


def compute_composite_forward_map(transforms, width, height, apply_fn=None):
    """
    Compute dense forward map (absolute coordinates) by applying the
    full transform chain to every pixel of a meshgrid.

    Forward map: P1→P2 (source→destination).
    forward_x[y_p1, x_p1] = P2 x-coordinate where P1 pixel (x_p1, y_p1) lands.

    Args:
        transforms: list of transform dicts (from coordinate_transformer.build_transform_chain)
        width, height: P1 image dimensions
        apply_fn: function(coords_Nx2, transforms) -> coords_Nx2
                  (defaults to coordinate_transformer.apply_transform_chain)

    Returns:
        (forward_x, forward_y) float32 arrays (H, W)
    """
    if apply_fn is None:
        from DataAugmentation.core.coordinate_transformer import apply_transform_chain
        apply_fn = apply_transform_chain

    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    coords = np.stack([xx.ravel(), yy.ravel()], axis=1)  # (H*W, 2)

    logger.info(f"Computing forward map for {width}x{height} ({coords.shape[0]} pixels)...")
    transformed = apply_fn(coords, transforms)

    forward_x = transformed[:, 0].reshape(height, width)
    forward_y = transformed[:, 1].reshape(height, width)

    # Fix border artifacts from Newton divergence in displacement transforms
    # that lack a direct forward map (e.g., crumple mode).
    # When fwd_dx/fwd_dy are available, the forward lookup is exact.
    needs_border_fix = any(
        t.get('type') == 'displacement' and t.get('fwd_dx') is None
        for t in transforms if isinstance(t, dict))
    if needs_border_fix:
        _fix_forward_map_borders(forward_x)
        _fix_forward_map_borders(forward_y)

    return forward_x, forward_y


def compute_inverse_map_chen2008(forward_x, forward_y, n_iter=10):
    """
    Compute inverse map from forward map using Chen et al. 2008 fixed-point iteration.

    Forward map: P1→P2. forward_x[y_p1, x_p1] = P2 x-coordinate.
    Inverse map: P2→P1. inverse_x[y_p2, x_p2] = P1 x-coordinate.

    The inverse map is what cv2.remap() needs:
      cv2.remap(P1_image, inverse_x, inverse_y) → P2_image

    Method:
        1. Convert to displacements: d_F = forward - identity
        2. Iterate: d_I^{k+1}(y) = -d_F(y + d_I^k(y))
        3. Convert back: inverse = identity + d_I

    All computation in float32. Quantize to uint16 AFTER calling this.

    Args:
        forward_x, forward_y: float32 (H, W) absolute coordinate maps
        n_iter: number of fixed-point iterations (default 10)

    Returns:
        (inverse_x, inverse_y) float32 (H, W) absolute coordinate maps
    """
    h, w = forward_x.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    # Convert to displacements
    fwd_dx = forward_x - xx
    fwd_dy = forward_y - yy

    # Chen fixed-point iteration
    inv_dx = -fwd_dx.copy()
    inv_dy = -fwd_dy.copy()

    logger.info(f"Computing inverse map (Chen et al. 2008, {n_iter} iterations)...")
    for i in range(n_iter):
        # Estimated source position: y + d_I(y)
        sx = np.clip(xx + inv_dx, 0, w - 1)
        sy = np.clip(yy + inv_dy, 0, h - 1)

        # Bilinear interpolation of d_F at source position
        inv_dx = -cv2.remap(fwd_dx, sx, sy, cv2.INTER_LINEAR,
                            borderMode=cv2.BORDER_REPLICATE)
        inv_dy = -cv2.remap(fwd_dy, sx, sy, cv2.INTER_LINEAR,
                            borderMode=cv2.BORDER_REPLICATE)

    # Convert back to absolute coordinates
    inverse_x = xx + inv_dx
    inverse_y = yy + inv_dy

    # Log convergence quality
    residual_x = cv2.remap(forward_x, inverse_x, inverse_y, cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_REPLICATE) - xx
    residual_y = cv2.remap(forward_y, inverse_x, inverse_y, cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_REPLICATE) - yy
    max_err = max(np.abs(residual_x).max(), np.abs(residual_y).max())
    mean_err = (np.abs(residual_x).mean() + np.abs(residual_y).mean()) / 2
    logger.info(f"  Inverse map convergence: max_error={max_err:.3f}px, mean_error={mean_err:.4f}px")

    return inverse_x, inverse_y


def compute_p2_maps_encoded(transforms, width, height, apply_fn=None, n_iter=10):
    """
    Compute forward and inverse maps for Pipeline 2, encoded as uint16.

    Forward map: P1→P2 (source→dest). map_forward[y_p1, x_p1] = coord_p2
    Inverse map: P2→P1 (dest→source). map_inverse[y_p2, x_p2] = coord_p1

    Args:
        transforms: transform chain from coordinate_transformer.build_transform_chain()
        width, height: P1 image dimensions
        apply_fn: transform function (optional)
        n_iter: Chen iterations

    Returns:
        (fwd_x, fwd_y, inv_x, inv_y) all uint16 (H, W)
    """
    forward_x, forward_y = compute_composite_forward_map(
        transforms, width, height, apply_fn)

    inverse_x, inverse_y = compute_inverse_map_chen2008(
        forward_x, forward_y, n_iter=n_iter)

    return (encode_map_uint16(forward_x), encode_map_uint16(forward_y),
            encode_map_uint16(inverse_x), encode_map_uint16(inverse_y))


# Keep old name as alias
compute_p2_maps_int16 = compute_p2_maps_encoded

"""
Figure utilities for consistent ECG image and mask generation

Provides standardized matplotlib figure creation and coordinate tracking to ensure
pixel-perfect alignment between main ECG images and their corresponding masks.
All figures use exact A4 landscape dimensions (297x210mm at 300 DPI = 3507x2480 pixels).
"""

import os
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from PIL import Image as PILImage, ImageDraw

from ecg_generator.config.constants import DPI, IMG_WIDTH_PX, IMG_HEIGHT_PX, MM_TO_PX
from ecg_generator.rendering.font_manager import get_pil_font
from ecg_generator.validation.image import validate_and_rename_if_needed


def create_standard_figure(transparent=False, page_width_px=None, page_height_px=None):
    """
    Create a standardized matplotlib figure with configurable dimensions

    Used for both main ECG images and masks to ensure pixel-perfect alignment.
    Coordinate system: origin (0,0) at bottom-left, matching standard ECG conventions.

    Args:
        transparent (bool): If True, create transparent background (used for mask generation)
        page_width_px (int, optional): Custom page width in pixels (default: A4 width)
        page_height_px (int, optional): Custom page height in pixels (default: A4 height)

    Returns:
        tuple: (fig, ax) - matplotlib Figure and Axes objects configured for ECG rendering
    """
    # Use custom dimensions or fall back to A4
    if page_width_px is not None and page_height_px is not None:
        width_px = page_width_px
        height_px = page_height_px
    else:
        width_px = IMG_WIDTH_PX
        height_px = IMG_HEIGHT_PX

    # Calculate figsize in inches from target pixels
    # Add 0.5 to ensure matplotlib rounds up to the target pixel count
    width_inches = (width_px + 0.5) / DPI
    height_inches = (height_px + 0.5) / DPI

    fig = plt.figure(figsize=(width_inches, height_inches), dpi=DPI)

    # Axes cover entire figure (no margins)
    ax = fig.add_axes([0, 0, 1, 1])

    # Set pixel limits
    ax.set_xlim(0, width_px)
    ax.set_ylim(0, height_px)
    ax.set_axis_off()

    if transparent:
        fig.patch.set_alpha(0)

    return fig, ax


def _render_deferred_texts(pil_img, deferred_texts, render_w, render_h):
    """Render deferred text items onto a PIL image.

    Converts matplotlib data-space coordinates (y=0 at bottom) to PIL image
    space (y=0 at top) and draws text using PIL's FreeType renderer.

    Args:
        pil_img: PIL Image to draw on (modified in-place)
        deferred_texts: List of text item dicts from CoordinateData.deferred_texts
        render_w: Matplotlib canvas width in pixels
        render_h: Matplotlib canvas height in pixels
    """
    if not deferred_texts:
        return

    draw = ImageDraw.Draw(pil_img)

    # Scale factors from matplotlib data-space to pixel-space
    sx = (render_w + 0.5) / render_w
    sy = (render_h + 0.5) / render_h

    for item in deferred_texts:
        font = get_pil_font(item['font_family'], item['size_px'],
                            bold=item['bold'], italic=item['italic'],
                            lang=item.get('lang'))

        # Convert matplotlib data coords to image coords
        x_img = round(item['x'] * sx)
        y_img = render_h - round(item['y'] * sy)  # Flip Y

        # Get text bounding box for alignment
        bbox = font.getbbox(item['text'])
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

        # Apply horizontal alignment
        if item['ha'] == 'center':
            x_img -= text_w // 2
        elif item['ha'] == 'right':
            x_img -= text_w

        # Apply vertical alignment
        if item['va'] == 'bottom':
            y_img -= text_h
        elif item['va'] == 'center':
            y_img -= text_h // 2
        # 'top' and 'baseline': y_img stays as-is

        color = item['color']
        if len(color) == 3:
            color = color + (255,)  # Add alpha

        draw.text((x_img, y_img), item['text'], fill=color, font=font)


def save_figure_standard(fig, save_path, transparent=False, expected_width_px=None, expected_height_px=None, coord_data=None):
    """
    Save figure with standardized parameters to ensure consistent dimensions

    Automatically validates output image size and renames file with SIZE_ERROR prefix
    if dimensions don't match expected dimensions. If coord_data contains deferred text
    items, renders them with PIL after matplotlib save for faster font rendering.

    Args:
        fig (matplotlib.figure.Figure): Figure object to save
        save_path (str): Path where image will be saved
        transparent (bool): If True, save with transparent background (for masks)
        expected_width_px (int, optional): Expected width for validation (default: A4 width)
        expected_height_px (int, optional): Expected height for validation (default: A4 height)
        coord_data (CoordinateData, optional): Coordinate data with deferred texts

    Returns:
        tuple: (final_path, is_correct_size, actual_width, actual_height)
            - final_path (str): Actual saved path (may differ if renamed due to size error)
            - is_correct_size (bool): True if image dimensions are correct
            - actual_width (int): Actual image width in pixels
            - actual_height (int): Actual image height in pixels
    """
    # Save as WebP lossless directly.  matplotlib's default WebP encoder is
    # lossy — pil_kwargs={'lossless': True} forces Pillow to use VP8L (lossless).
    # For non-WebP paths (e.g. masks saved as PNG), no extra kwargs needed.
    save_kwargs = dict(dpi=DPI, pad_inches=0, transparent=transparent)
    if save_path.lower().endswith('.webp'):
        save_kwargs['pil_kwargs'] = {'lossless': True}
    fig.savefig(save_path, **save_kwargs)
    plt.close(fig)

    # Render anti-aliased grid lines (#91).
    # matplotlib cannot AA perfectly vertical/horizontal lines, so we draw them
    # in post-processing directly on the pixel array.
    # Even thickness (2px, 4px): center pixels at 100% + 1px edge at 50% each side.
    # Odd thickness (1px, 3px): solid pixels, no AA spread.
    aa_lines = coord_data.aa_grid_lines if coord_data else []
    if aa_lines:
        import numpy as np
        pil_img = PILImage.open(save_path).convert('RGBA')
        arr = np.array(pil_img).astype(np.float32)
        img_h, img_w = arr.shape[:2]
        # Save original content (signal, labels, text) to restore on top of grid.
        # Content pixels are darker than the light background (white + faint minor grid).
        original = arr.copy()
        content_mask = original[:, :, :3].mean(axis=2) < 200
        for line in aa_lines:
            x1, y1 = line['x1'], line['y1']
            x2, y2 = line['x2'], line['y2']
            alpha = line['alpha']
            b, g, r = line['color_bgr']
            color = np.array([r, g, b, 255], dtype=np.float32)
            thick = line['thickness_px']
            # Even thickness N: (N-1) center pixels at 100% + 1 edge pixel at 50% each side
            # e.g. 2px → [50%, 100%, 50%], 4px → [50%, 100%, 100%, 100%, 50%]
            # Odd thickness N: N center pixels at 100%, no AA edges
            # e.g. 1px → [100%], 3px → [100%, 100%, 100%]
            n_center = thick - 1 if thick % 2 == 0 else thick
            has_edges = (thick % 2 == 0)
            is_vertical = (x1 == x2)
            if is_vertical:
                pos = int(round(x1))
                half = n_center // 2
                c0 = pos - half
                c1 = pos + half
                for c in range(max(0, c0), min(img_w, c1 + 1)):
                    arr[:, c] = arr[:, c] * (1 - alpha) + color * alpha
                if has_edges:
                    ea = alpha * 0.5
                    if c0 - 1 >= 0:
                        arr[:, c0 - 1] = arr[:, c0 - 1] * (1 - ea) + color * ea
                    if c1 + 1 < img_w:
                        arr[:, c1 + 1] = arr[:, c1 + 1] * (1 - ea) + color * ea
            else:  # horizontal
                pos = img_h - int(round(y1))  # matplotlib y→image y
                half = n_center // 2
                r0 = pos - half
                r1 = pos + half
                for r_idx in range(max(0, r0), min(img_h, r1 + 1)):
                    arr[r_idx, :] = arr[r_idx, :] * (1 - alpha) + color * alpha
                if has_edges:
                    ea = alpha * 0.5
                    if r0 - 1 >= 0:
                        arr[r0 - 1, :] = arr[r0 - 1, :] * (1 - ea) + color * ea
                    if r1 + 1 < img_h:
                        arr[r1 + 1, :] = arr[r1 + 1, :] * (1 - ea) + color * ea
        # Restore content pixels (signal, labels) on top of grid lines
        arr[content_mask] = original[content_mask]
        pil_img = PILImage.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        if save_path.lower().endswith('.webp'):
            pil_img.save(save_path, 'WEBP', lossless=True)
        else:
            pil_img.save(save_path)

    # Use custom dimensions for validation or fall back to A4
    exp_width = expected_width_px if expected_width_px is not None else IMG_WIDTH_PX
    exp_height = expected_height_px if expected_height_px is not None else IMG_HEIGHT_PX

    # Render deferred texts (lead labels, speed/gain) with PIL for fast font rendering
    deferred_texts = coord_data.deferred_texts if coord_data else []
    if deferred_texts and not transparent:
        pil_img = PILImage.open(save_path).convert('RGBA')
        _render_deferred_texts(pil_img, deferred_texts, exp_width, exp_height)
        if save_path.lower().endswith('.webp'):
            pil_img.save(save_path, 'WEBP', lossless=True)
        else:
            pil_img.save(save_path)

    final_path, is_correct, width, height = validate_and_rename_if_needed(save_path, exp_width, exp_height)

    # Add border for displacement field stability (paper_deform Newton iteration).
    # Both width and height get +2*BORDER_PAD+1:
    #   BORDER_PAD px transparent + canvas + 1px edge grid + BORDER_PAD px transparent
    # Extra column: matplotlib clips axvline at x=width_px (xlim boundary),
    # so the edge grid line is absent from the canvas.  We copy the grid
    # pattern from the nearest minor line (12px = 1mm earlier) to provide
    # visually correct grid content at the page edge.
    # Extra row: y=0 and y=height_px ARE renderable by matplotlib, so the
    # bottom/top edge grid lines exist on the canvas — just copy the last row.
    BORDER_PAD = 4
    if not transparent:
        pil_img = PILImage.open(final_path).convert('RGBA')
        orig_w, orig_h = pil_img.size
        total_w = orig_w + 2 * BORDER_PAD + 1
        total_h = orig_h + 2 * BORDER_PAD + 1
        padded = PILImage.new('RGBA', (total_w, total_h), (0, 0, 0, 0))
        padded.paste(pil_img, (BORDER_PAD, BORDER_PAD))

        # Extra column: copy grid pattern from 12px (1mm) before right edge
        minor_px = int(MM_TO_PX)  # 12
        src_col = orig_w - minor_px  # last renderable minor column in canvas
        if src_col > 0:
            src_strip = padded.crop((BORDER_PAD + src_col, 0, BORDER_PAD + src_col + 1, total_h))
            padded.paste(src_strip, (BORDER_PAD + orig_w, 0))
        else:
            right_col = padded.crop((BORDER_PAD + orig_w - 1, 0, BORDER_PAD + orig_w, total_h))
            padded.paste(right_col, (BORDER_PAD + orig_w, 0))

        # Extra row: copy bottom canvas row (grid lines at y=0 are rendered)
        bottom_row = padded.crop((0, BORDER_PAD + orig_h - 1, total_w, BORDER_PAD + orig_h))
        padded.paste(bottom_row, (0, BORDER_PAD + orig_h))

        webp_path = os.path.splitext(final_path)[0] + '.webp'
        padded.save(webp_path, 'WEBP', lossless=True)
        if os.path.abspath(final_path) != os.path.abspath(webp_path):
            os.remove(final_path)
        final_path = webp_path

    return final_path, is_correct, width, height


class CoordinateData:
    """
    Container for coordinate data captured during ECG image generation.

    Stores exact pixel coordinates of all rendered elements (signals, grid points, etc.)
    to enable pixel-perfect binary mask generation. Coordinates are captured during
    the main rendering pass and reused for mask creation and NPZ export.

    All coordinates in matplotlib data space (y=0 at bottom).
    Converted to image space (y=0 at top) by the NPZ writer.

    Attributes:
        grid_intersections (list): (x, y) tuples for major grid intersection points
        lead_coordinates (dict): lead_name -> list of (x, y, amp_mV) signal points
        lead_positions (dict): lead_name -> (x_min, y_min, x_max, y_max)
        grid_major_x (list): X positions of vertical major lines (5mm)
        grid_major_y (list): Y positions of horizontal major lines (5mm)
        grid_minor_x (list): X positions of vertical minor lines (1mm, excl. major)
        grid_minor_y (list): Y positions of horizontal minor lines (1mm, excl. major)
        grid_x_range (tuple): (x_start, x_end) grid extent
        grid_y_range (tuple): (y_start, y_end) grid extent
    """
    def __init__(self):
        self.grid_intersections = []
        self.lead_coordinates = {}
        self.lead_positions = {}
        self.label_centers = {}  # lead_name -> (x, y) in matplotlib data space
        # Additional mask coordinates
        self.lead_label_positions = []  # [(x, y, text, fontsize_pt, ha), ...]
        self.reference_pulse_coords = {}  # key -> [(x, y), ...]
        self.medical_text_positions = []  # [(x, y, text, fontsize, ha, va), ...]
        self.black_square_bbox = None  # (x, y, w, h) or None — legacy single square
        self.black_square_bboxes = []  # [(x, y, w, h), ...] — multiple squares (#53)
        self.page_boundary = None  # (width_px, height_px) or None
        # Deferred text items rendered by PIL after matplotlib save
        # Each item: {x, y, text, size_px, color, font_family, bold, italic, ha, va, category}
        self.deferred_texts = []
        # Grid line positions
        self.grid_major_x = []
        self.grid_major_y = []
        self.grid_minor_x = []
        self.grid_minor_y = []
        self.grid_x_range = (0.0, 0.0)
        self.grid_y_range = (0.0, 0.0)
        # Lead time windows: lead_key -> (start_s, end_s)
        self.lead_time_ranges = {}
        # Signal line width (pixels), set from config during rendering
        self.signal_line_width_px = 1
        # AA grid lines: drawn via cv2 after matplotlib save (#91)
        # Each entry: {'x1': float, 'y1': float, 'x2': float, 'y2': float,
        #              'color_bgr': (b,g,r), 'thickness_px': int, 'alpha': float}
        self.aa_grid_lines = []

    def add_grid_intersection(self, x, y):
        """Record a grid intersection point coordinate."""
        self.grid_intersections.append((x, y))

    def set_grid_line_positions(self, major_x, major_y, minor_x, minor_y,
                                x_range, y_range):
        """
        Store grid line positions for NPZ export and mask generation.

        Args:
            major_x: array/list of X positions for vertical major lines
            major_y: array/list of Y positions for horizontal major lines
            minor_x: array/list of X positions for vertical minor lines (excl. major)
            minor_y: array/list of Y positions for horizontal minor lines (excl. major)
            x_range: (x_start, x_end) horizontal extent of grid
            y_range: (y_start, y_end) vertical extent of grid
        """
        self.grid_major_x = list(major_x)
        self.grid_major_y = list(major_y)
        self.grid_minor_x = list(minor_x)
        self.grid_minor_y = list(minor_y)
        self.grid_x_range = tuple(x_range)
        self.grid_y_range = tuple(y_range)

    def add_lead_signal_point(self, lead_name, x, y, amplitude_mV=0.0):
        """
        Record a point along an ECG signal waveform.

        Args:
            lead_name (str): Lead identifier (e.g., "I", "II_seg0", "V1_extra")
            x (float): X-coordinate in pixels (matplotlib data space)
            y (float): Y-coordinate in pixels (matplotlib data space)
            amplitude_mV (float): Signal amplitude in millivolts
        """
        if lead_name not in self.lead_coordinates:
            self.lead_coordinates[lead_name] = []
        self.lead_coordinates[lead_name].append((x, y, amplitude_mV))

    def set_lead_bounding_box(self, lead_name, x_min, y_min, x_max, y_max):
        """Define the rectangular rendering area for a lead."""
        self.lead_positions[lead_name] = (x_min, y_min, x_max, y_max)

    def add_label_center(self, lead_name, x, y):
        """Record the anchor position of a lead label text (refined to bbox center later)."""
        self.label_centers[lead_name] = (x, y)

    def refine_label_centers_from_bbox(self, fig, ax):
        """
        Replace anchor-based label centers with estimated text bounding box centers.

        For PIL-rendered deferred texts, computes centers using PIL font metrics.
        Falls back to matplotlib text objects for any non-deferred text.
        Must be called after rendering but before fig is closed.
        """
        if not self.label_centers:
            return

        # First try to refine from deferred texts using PIL font metrics
        if self.deferred_texts:
            matched = set()
            for item in self.deferred_texts:
                if item['category'] != 'label':
                    continue
                for lead_name, (lx, ly) in self.label_centers.items():
                    if lead_name in matched:
                        continue
                    if abs(item['x'] - lx) < 1 and abs(item['y'] - ly) < 1:
                        font = get_pil_font(item['font_family'], item['size_px'],
                                            bold=item['bold'], italic=item['italic'])
                        bbox = font.getbbox(item['text'])
                        text_w = bbox[2] - bbox[0]
                        text_h = bbox[3] - bbox[1]
                        # Compute center in matplotlib data space
                        cx = item['x']
                        if item['ha'] == 'center':
                            pass  # x is already center
                        elif item['ha'] == 'left':
                            cx = item['x'] + text_w / 2
                        elif item['ha'] == 'right':
                            cx = item['x'] - text_w / 2
                        cy = item['y'] + text_h / 2  # va='bottom', so y is at bottom
                        self.label_centers[lead_name] = (float(cx), float(cy))
                        matched.add(lead_name)
                        break

        # Fall back to matplotlib text objects for any remaining unmatched labels
        renderer = fig.canvas.get_renderer()
        inv_transform = ax.transData.inverted()
        matched_mpl = set()
        for text_obj in ax.texts:
            pos = text_obj.get_position()  # data coordinates
            for lead_name, (lx, ly) in self.label_centers.items():
                if lead_name in matched_mpl:
                    continue
                if abs(pos[0] - lx) < 1 and abs(pos[1] - ly) < 1:
                    try:
                        bbox = text_obj.get_window_extent(renderer)
                        center_disp = [(bbox.x0 + bbox.x1) / 2, (bbox.y0 + bbox.y1) / 2]
                        center_data = inv_transform.transform(center_disp)
                        self.label_centers[lead_name] = (float(center_data[0]), float(center_data[1]))
                        matched_mpl.add(lead_name)
                    except Exception:
                        pass
                    break

    def add_lead_label(self, x, y, text, fontsize_pt, ha='left'):
        """Record a lead label text position for mask generation."""
        self.lead_label_positions.append((x, y, text, fontsize_pt, ha))

    def add_reference_pulse_point(self, key, x, y):
        """Record a reference pulse coordinate point."""
        if key not in self.reference_pulse_coords:
            self.reference_pulse_coords[key] = []
        self.reference_pulse_coords[key].append((x, y))

    def add_medical_text(self, x, y, text, fontsize, ha='left', va='bottom'):
        """Record a medical text position for mask generation."""
        self.medical_text_positions.append((x, y, text, fontsize, ha, va))

    def set_black_square(self, x, y, w, h):
        """Record the black calibration square bounding box (legacy single)."""
        self.black_square_bbox = (x, y, w, h)

    def add_black_square(self, x, y, w, h):
        """Record an additional black square bounding box (#53)."""
        self.black_square_bboxes.append((x, y, w, h))

    def set_page_boundary(self, width_px, height_px):
        """Record the page boundary dimensions."""
        self.page_boundary = (width_px, height_px)

    def add_deferred_text(self, x, y, text, size_px, color=(0, 0, 0),
                          font_family="DejaVuSans", bold=False, italic=False,
                          ha='left', va='bottom', category='label', lang=None):
        """Queue a text item for PIL rendering after matplotlib save.

        Coordinates are in matplotlib data space (y=0 at bottom).

        Args:
            x, y: Position in matplotlib data space (pixels)
            text: String to render
            size_px: Font size in pixels
            color: RGB tuple (0-255) or matplotlib color string
            font_family: Font family name (key from font_manager.FONT_FAMILIES)
            bold: Use bold variant
            italic: Use italic variant
            ha: Horizontal alignment ('left', 'center', 'right')
            va: Vertical alignment ('top', 'center', 'bottom', 'baseline')
            category: Text category ('label', 'speed_gain', 'medical')
            lang: Language code for multilingual font selection (None = default)
        """
        # Convert matplotlib color strings to RGB tuples
        if isinstance(color, str):
            rgb = mcolors.to_rgb(color)
            color = tuple(int(c * 255) for c in rgb)
        self.deferred_texts.append({
            'x': x, 'y': y, 'text': text, 'size_px': int(size_px),
            'color': color, 'font_family': font_family,
            'bold': bold, 'italic': italic,
            'ha': ha, 'va': va, 'category': category, 'lang': lang,
        })
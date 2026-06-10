"""
Figure utilities: matplotlib figure creation and the PIL deferred-text pass.
"""

import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from PIL import ImageDraw

from ecg_generator.config.constants import DPI, IMG_WIDTH_PX, IMG_HEIGHT_PX
from ecg_generator.rendering.font_manager import get_pil_font


def create_standard_figure(transparent=False, page_width_px=None, page_height_px=None, background_color=None):
    """
    Create a standardized matplotlib figure with configurable dimensions

    Used for both main ECG images and masks to ensure pixel-perfect alignment.
    Coordinate system: origin (0,0) at bottom-left, matching standard ECG conventions.

    Args:
        transparent (bool): If True, create transparent background (used for mask generation)
        page_width_px (int, optional): Custom page width in pixels (default: A4 width)
        page_height_px (int, optional): Custom page height in pixels (default: A4 height)
        background_color (str, optional): Paper background color. When None, matplotlib's
            default (white) is used -- preserves existing behavior. Ignored when
            ``transparent=True`` so mask rendering stays unaffected.

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
    elif background_color is not None:
        fig.patch.set_facecolor(background_color)
        ax.set_facecolor(background_color)

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

        # Get text bounding box for alignment (#104)
        # bbox = (left, top, right, bottom) relative to the draw origin.
        # We must account for non-zero offsets (common with italic fonts)
        # to ensure text at the same nominal position aligns visually.
        bbox = font.getbbox(item['text'])

        # Apply horizontal alignment (compensate for bbox[0] offset)
        if item['ha'] == 'center':
            x_img -= (bbox[0] + bbox[2]) // 2
        elif item['ha'] == 'right':
            x_img -= bbox[2]
        elif item['ha'] == 'left':
            x_img -= bbox[0]

        # Apply vertical alignment (compensate for bbox[1] offset)
        if item['va'] == 'bottom':
            y_img -= bbox[3]
        elif item['va'] == 'center':
            y_img -= (bbox[1] + bbox[3]) // 2
        elif item['va'] == 'top':
            y_img -= bbox[1]
        # 'baseline': y_img stays as-is (origin = baseline)

        color = item['color']
        if len(color) == 3:
            color = color + (255,)  # Add alpha

        draw.text((x_img, y_img), item['text'], fill=color, font=font)


def _render_deferred_texts_mpl(ax, deferred_texts, dpi=DPI):
    """Draw the deferred text items as VECTOR matplotlib text (for PDF output).

    Mirrors `_render_deferred_texts` but uses ``ax.text`` in data space (which
    equals pixel space here, origin bottom-left) instead of rasterizing with PIL,
    so labels stay vector/selectable in the saved PDF. Coordinates, alignment and
    size come straight from the same `deferred_texts` items used by the PIL pass.
    """
    for item in deferred_texts:
        c = item['color']
        color = tuple(v / 255 for v in c[:3]) if isinstance(c, (tuple, list)) else c
        ax.text(
            item['x'], item['y'], item['text'],
            fontsize=item['size_px'] * 72.0 / dpi,
            color=color,
            ha=item['ha'], va=item['va'],
            fontweight='bold' if item.get('bold') else 'normal',
            fontstyle='italic' if item.get('italic') else 'normal',
            clip_on=False, zorder=5,
        )


class CoordinateData:
    """Collects text items to be rendered by PIL after the matplotlib save.

    Originally a grab-bag of coordinate trackers for mask generation (signal
    points, grid intersections, label bboxes, page boundary, etc.). Mask
    generation is gone, so only the PIL deferred-text queue remains.
    """

    def __init__(self):
        # Each item: {x, y, text, size_px, color, font_family, bold, italic, ha, va, category, lang}
        self.deferred_texts = []

    def add_deferred_text(self, x, y, text, size_px, color=(0, 0, 0),
                          font_family="DejaVuSans", bold=False, italic=False,
                          ha='left', va='bottom', category='label', lang=None):
        """Queue a text item for PIL rendering after matplotlib save.

        Coordinates are in matplotlib data space (y=0 at bottom).
        """
        if isinstance(color, str):
            rgb = mcolors.to_rgb(color)
            color = tuple(int(c * 255) for c in rgb)
        self.deferred_texts.append({
            'x': x, 'y': y, 'text': text, 'size_px': int(size_px),
            'color': color, 'font_family': font_family,
            'bold': bold, 'italic': italic,
            'ha': ha, 'va': va, 'category': category, 'lang': lang,
        })
"""Visual rendering components for ECG generation."""

from .signal import calculate_text_position, render_signal_with_pulse, render_extra_line_signal
from .grid import generate_ecg_grid_background, generate_ecg_grid_background_clipped, draw_separation_styles
from .noise import add_noise_to_leads

__all__ = [
    'calculate_text_position',
    'render_signal_with_pulse',
    'render_extra_line_signal',
    'generate_ecg_grid_background',
    'generate_ecg_grid_background_clipped',
    'draw_separation_styles',
    'add_noise_to_leads',
]

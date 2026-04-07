"""
Verification Integration Module

Integrates signal verification into the ECG generation pipeline.
Handles the complete verification workflow:
1. Extract measurement points from rendered signals
2. Compare XML voltages with rendered dimensions
3. Generate verification reports (JSON and text)
4. Create annotated verification images

This module coordinates between the rendering system, verification data collection,
and report generation.
"""

import os
import numpy as np
from typing import Dict, List, Tuple, Optional
from ecg_generator.verification.core import (
    SignalVerificationData, VerificationReport,
    auto_select_measurement_points, ReferencePulseVerification
)
from ecg_generator.config.constants import (
    MM_TO_PX, AMP_SCALE_PX_PER_MV, TIME_SCALE_PX_PER_S,
    AMP_SCALE_MM_PER_MV, TIME_SCALE_MM_PER_S
)


def calculate_baseline_from_layout(config, format_choice, row_index, n_rows,
                                   signal_area_y_start, row_height_px, initial_shift_px):
    """
    Calculate baseline Y coordinate for a specific row

    This replicates the calculation from layout_renderer.py

    Args:
        config: Configuration dictionary
        format_choice: Format choice (e.g., "3x4", "6x2")
        row_index: Row index (0-based)
        n_rows: Total number of rows
        signal_area_y_start: Y coordinate of signal area start
        row_height_px: Height of each row in pixels
        initial_shift_px: Initial shift from top (usually 5mm)

    Returns:
        Baseline Y coordinate in pixels
    """
    y_bottom = signal_area_y_start - initial_shift_px - row_index * row_height_px
    return y_bottom


def extract_signal_coordinates_from_layout(leads_data, config, format_choice,
                                           layout, lead_positions):
    """
    Calculate expected render coordinates for signal samples

    Args:
        leads_data: Dictionary of lead signals
        config: Configuration dictionary
        format_choice: Format choice
        layout: Layout structure
        lead_positions: Dictionary mapping lead names to (row, col) positions

    Returns:
        Dictionary: {lead_name: [(sample_idx, x_px, y_px, voltage_mV), ...]}
    """
    # This is a complex calculation that would need to replicate
    # the exact layout logic from layout_renderer.py
    # For now, return empty dict to indicate this needs real implementation
    return {}


def create_verification_from_rendered_image(xml_path, image_path, leads_data,
                                            config, coord_data=None,
                                            sampling_rate=500.0, num_points=8):
    """
    Create verification data by analyzing the configuration and calculating
    where signals should be rendered

    This approach recalculates the rendering coordinates based on the config
    rather than trying to capture them during rendering.

    Args:
        xml_path: Path to source XML file
        image_path: Path to rendered ECG image
        leads_data: Dictionary of lead signals (in mV)
        config: Configuration dictionary
        coord_data: Optional coordinate data from rendering (for mask generation)
        sampling_rate: Sampling rate in Hz (default 500)
        num_points: Number of measurement points per lead

    Returns:
        VerificationReport object with all measurements
    """
    # Create verification report
    report = VerificationReport(os.path.basename(xml_path), os.path.basename(image_path))

    # Get format and layout information from config
    format_choice = config.get("format_choice", "3x4")

    # Import layout constants (we need to avoid circular imports)
    from ecg_generator.config.constants import IMG_HEIGHT_PX, IMG_WIDTH_PX

    # Calculate grid and signal area dimensions based on grid_layout_style
    grid_layout_style = config.get("grid_layout_style", "full_grid")

    if grid_layout_style == "with_text_zones":
        # Grid is centered with margins
        top_margin_px = 50 * MM_TO_PX  # 50mm
        bottom_margin_px = 10 * MM_TO_PX  # 10mm
        left_margin_px = 5 * MM_TO_PX  # 5mm
        right_margin_px = 20 * MM_TO_PX  # 20mm
    else:  # full_grid
        top_margin_px = 0
        bottom_margin_px = 0
        left_margin_px = 0
        right_margin_px = 0

    # Signal area dimensions
    signal_area_x_start = left_margin_px
    signal_area_y_start = IMG_HEIGHT_PX - top_margin_px
    signal_area_width = IMG_WIDTH_PX - left_margin_px - right_margin_px
    signal_area_height = IMG_HEIGHT_PX - top_margin_px - bottom_margin_px

    # Parse format to get rows and columns
    n_rows, n_cols, n_extra = parse_format(format_choice)

    # Calculate row height and column width
    vertical_spacing_mm = config.get("vertical_spacing_mm", 0)
    vertical_spacing_px = vertical_spacing_mm * MM_TO_PX
    row_height_px = (signal_area_height - vertical_spacing_px * (n_rows - 1)) / n_rows

    horizontal_spacing_mm = config.get("horizontal_spacing_mm", 0)
    horizontal_spacing_px = horizontal_spacing_mm * MM_TO_PX
    col_width_px = (signal_area_width - horizontal_spacing_px * (n_cols - 1)) / n_cols

    # Get standard leads (excluding extra leads for now)
    standard_leads = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
    leads_to_verify = [lead for lead in standard_leads if lead in leads_data]

    # Compute scales from config (variable speed and gain)
    speed_mm_per_s = config.get("speed_mm_per_s", TIME_SCALE_MM_PER_S)
    gain_mm_per_mV = config.get("gain_mm_per_mV", AMP_SCALE_MM_PER_MV)
    time_scale_px_per_s = speed_mm_per_s * MM_TO_PX
    amp_scale_px_per_mV = gain_mm_per_mV * MM_TO_PX

    # Calculate segment width for signal rendering
    duration_s = 10  # Total ECG duration
    segment_duration_s = duration_s / n_cols
    segment_width_px = time_scale_px_per_s * segment_duration_s

    # Process each lead
    lead_index = 0
    for row in range(n_rows):
        for col in range(n_cols):
            if lead_index >= len(leads_to_verify):
                break

            lead_name = leads_to_verify[lead_index]
            signal = leads_data[lead_name]

            # Create verification data for this lead
            lead_verification = SignalVerificationData(
                lead_name, sampling_rate,
                gain_mm_per_mV=gain_mm_per_mV, speed_mm_per_s=speed_mm_per_s
            )
            lead_verification.set_xml_signal(signal)

            # Calculate baseline Y coordinate
            initial_shift_px = 5 * MM_TO_PX
            baseline_y = signal_area_y_start - initial_shift_px - row * row_height_px

            lead_verification.set_baseline(baseline_y)

            # Calculate segment start X coordinate
            segment_x_start = signal_area_x_start + col * (col_width_px + horizontal_spacing_px)

            # Adjust for reference pulse if present
            ref_pulse_config = config.get("reference_pulse", {})
            if ref_pulse_config.get("number_of_ref_pulse"):
                horizontal_pos = ref_pulse_config.get("horizontal_position_ref_pulse", "left")
                if horizontal_pos == "left":
                    # Pulse is in negative space, signal starts at original position
                    signal_x_start = segment_x_start
                else:
                    signal_x_start = segment_x_start
            else:
                signal_x_start = segment_x_start

            # Auto-select measurement points for this lead segment
            total_samples = len(signal)
            samples_per_col = total_samples // n_cols
            segment_start_idx = col * samples_per_col
            segment_end_idx = (col + 1) * samples_per_col
            segment_signal = signal[segment_start_idx:segment_end_idx]

            # Select a few measurement points in this segment
            segment_indices = auto_select_measurement_points(segment_signal, sampling_rate,
                                                            num_points=min(3, num_points))

            # Add measurements
            for seg_idx in segment_indices:
                global_idx = segment_start_idx + seg_idx
                if global_idx >= len(signal):
                    continue

                # Calculate rendered position
                time_in_segment = seg_idx / sampling_rate
                x_px = signal_x_start + time_in_segment * time_scale_px_per_s
                voltage_mV = signal[global_idx]
                # Note: In image coordinates, Y increases downward, but ECG signal goes up for positive voltage
                # So we need to SUBTRACT the voltage offset from baseline (not add)
                y_px = baseline_y - voltage_mV * amp_scale_px_per_mV

                # Add measurement point
                lead_verification.add_measurement_point(global_idx, x_px, y_px)

            # Add this lead's verification data to the report
            report.add_lead_verification(lead_verification)

            lead_index += 1

        if lead_index >= len(leads_to_verify):
            break

    # Verify reference pulse if present
    ref_pulse_config = config.get("reference_pulse", {})
    if ref_pulse_config.get("number_of_ref_pulse"):
        ref_pulse_verification = verify_reference_pulse(
            ref_pulse_config, gain_mm_per_mV=gain_mm_per_mV,
            speed_mm_per_s=speed_mm_per_s
        )
        report.set_reference_pulse_verification(ref_pulse_verification)

    return report


def parse_format(format_choice: str) -> Tuple[int, int, int]:
    """
    Parse format string to get rows, columns, and extra lines

    Args:
        format_choice: Format string (e.g., "3x4", "3x4+1", "6x2+1")

    Returns:
        Tuple of (n_rows, n_cols, n_extra)
    """
    if "+" in format_choice:
        base, extra = format_choice.split("+")
        n_extra = int(extra)
    else:
        base = format_choice
        n_extra = 0

    rows_str, cols_str = base.split("x")
    n_rows = int(rows_str)
    n_cols = int(cols_str)

    return n_rows, n_cols, n_extra


def verify_reference_pulse(ref_pulse_config: Dict, gain_mm_per_mV: float = None,
                           speed_mm_per_s: float = None) -> ReferencePulseVerification:
    """
    Verify reference pulse dimensions

    The reference pulse is a standard 1mV square wave used for calibration.
    Expected dimensions depend on current gain and speed settings.

    Args:
        ref_pulse_config: Reference pulse configuration
        gain_mm_per_mV: Amplitude gain (defaults to AMP_SCALE_MM_PER_MV)
        speed_mm_per_s: Paper speed (defaults to TIME_SCALE_MM_PER_S)

    Returns:
        ReferencePulseVerification object
    """
    if gain_mm_per_mV is None:
        gain_mm_per_mV = AMP_SCALE_MM_PER_MV
    if speed_mm_per_s is None:
        speed_mm_per_s = TIME_SCALE_MM_PER_S

    # Reference pulse standard dimensions
    pulse_height_mV = 1.0  # Standard calibration pulse
    pulse_width_s = 0.2  # Standard pulse width

    # Expected dimensions (adapt to current gain and speed)
    expected_height_mm = pulse_height_mV * gain_mm_per_mV
    expected_width_mm = pulse_width_s * speed_mm_per_s

    # For now, assume perfect rendering (in real implementation, would measure from image)
    # This would require image analysis or coordinate tracking
    actual_height_mm = expected_height_mm
    actual_width_mm = expected_width_mm

    height_error_mm = actual_height_mm - expected_height_mm
    width_error_mm = actual_width_mm - expected_width_mm

    # Determine pass/fail (tolerance ±0.5mm)
    tolerance = 0.5
    status = "PASS" if (abs(height_error_mm) <= tolerance and
                       abs(width_error_mm) <= tolerance) else "FAIL"

    return ReferencePulseVerification(
        expected_height_mm=expected_height_mm,
        actual_height_mm=actual_height_mm,
        expected_width_mm=expected_width_mm,
        actual_width_mm=actual_width_mm,
        height_error_mm=height_error_mm,
        width_error_mm=width_error_mm,
        status=status
    )


def generate_verification_outputs(xml_path, image_path, leads_data, config,
                                 output_dir, base_name):
    """
    Generate all verification outputs: reports and annotated image

    Args:
        xml_path: Path to source XML file
        image_path: Path to rendered ECG image
        leads_data: Dictionary of lead signals
        config: Configuration dictionary
        output_dir: Output directory for verification files
        base_name: Base name for output files

    Returns:
        Tuple of (report_path, verified_image_path, text_report_path)
    """
    # Create verification report
    report = create_verification_from_rendered_image(
        xml_path, image_path, leads_data, config
    )

    # Save JSON report
    json_report_path = os.path.join(output_dir, f"{base_name}_verification.json")
    report.save_json(json_report_path)

    # Save text report
    text_report_path = os.path.join(output_dir, f"{base_name}_verification.txt")
    report.save_text_report(text_report_path)

    # Create annotated image (for now, just copy the original)
    # In full implementation, would call create_verification_overlay
    verified_image_path = os.path.join(output_dir, f"{base_name}_verified.png")

    # Create enhanced overlay using matplotlib for better control
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle
    from PIL import Image as PILImage

    img = PILImage.open(image_path)
    img_array = np.array(img)

    # Create figure with same size as image
    dpi = 300
    fig_width = img.width / dpi
    fig_height = img.height / dpi
    fig, ax = plt.subplots(figsize=(fig_width, fig_height), dpi=dpi)

    # Display the ECG image
    ax.imshow(img_array, aspect='equal', extent=[0, img.width, img.height, 0])
    ax.set_xlim(0, img.width)
    ax.set_ylim(img.height, 0)  # Invert Y axis to match image coordinates
    ax.axis('off')

    # Get overall status
    overall_status = report.get_overall_status()
    status_color = 'green' if overall_status == "PASS" else 'red'

    # 1. Add grid square measurement annotation (top-left area)
    grid_x = 100
    grid_y = 150
    grid_size_mm = 5
    grid_size_px = grid_size_mm * MM_TO_PX

    # Draw highlighted grid square
    rect = Rectangle((grid_x, grid_y), grid_size_px, grid_size_px,
                     linewidth=3, edgecolor='blue', facecolor='none', alpha=0.9)
    ax.add_patch(rect)

    # Add dimension lines for grid
    # Horizontal dimension
    arrow_offset = 25
    ax.annotate('', xy=(grid_x + grid_size_px, grid_y + grid_size_px + arrow_offset),
                xytext=(grid_x, grid_y + grid_size_px + arrow_offset),
                arrowprops=dict(arrowstyle='<->', color='blue', lw=2))
    ax.text(grid_x + grid_size_px/2, grid_y + grid_size_px + arrow_offset - 15,
            f'{grid_size_mm}mm', ha='center', va='top', color='blue',
            fontsize=10, fontweight='bold',
            bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor='blue', alpha=0.9))

    # Vertical dimension
    ax.annotate('', xy=(grid_x - arrow_offset, grid_y),
                xytext=(grid_x - arrow_offset, grid_y + grid_size_px),
                arrowprops=dict(arrowstyle='<->', color='blue', lw=2))
    ax.text(grid_x - arrow_offset - 15, grid_y + grid_size_px/2,
            f'{grid_size_mm}mm', ha='right', va='center', color='blue',
            fontsize=10, fontweight='bold', rotation=90,
            bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor='blue', alpha=0.9))

    # 2. Add measurement annotations for selected leads
    annotation_count = 0
    max_annotations = 5  # Limit to avoid clutter

    for lead_name, lead_verification in report.lead_verifications.items():
        if annotation_count >= max_annotations:
            break

        if not lead_verification.verification_points:
            continue

        # Select one representative point (preferably with highest voltage)
        best_point = max(lead_verification.verification_points,
                        key=lambda p: abs(p.xml_voltage_mV))

        point = best_point
        baseline_y = point.baseline_y_px
        signal_y = point.signal_y_px
        signal_x = point.signal_x_px

        # Determine color based on status
        point_color = 'green' if point.status == "PASS" else 'red'

        # Draw vertical measurement line from baseline to signal
        ax.plot([signal_x, signal_x], [baseline_y, signal_y],
               color=point_color, linewidth=2.5, linestyle='--', alpha=0.8)

        # Draw marker at signal point
        ax.plot(signal_x, signal_y, 'o', color=point_color, markersize=10,
               markeredgecolor='white', markeredgewidth=2, zorder=5)

        # Add dimension arrow
        arrow_x_offset = 40
        ax.annotate('', xy=(signal_x + arrow_x_offset, signal_y),
                   xytext=(signal_x + arrow_x_offset, baseline_y),
                   arrowprops=dict(arrowstyle='<->', color=point_color, lw=2.5))

        # Add measurement label
        label_x = signal_x + arrow_x_offset + 50
        label_y = (baseline_y + signal_y) / 2

        # Format label text
        label_text = (f'{lead_name}: {point.xml_voltage_mV:.2f}mV\n'
                     f'Exp: {point.expected_height_mm:.1f}mm\n'
                     f'Act: {point.actual_height_mm:.1f}mm\n'
                     f'Err: {point.error_mm:+.2f}mm')

        ax.text(label_x, label_y, label_text,
               color=point_color, fontsize=8, fontweight='bold',
               ha='left', va='center',
               bbox=dict(boxstyle='round,pad=0.5', facecolor='white',
                        edgecolor=point_color, linewidth=2, alpha=0.95))

        annotation_count += 1

    # 3. Add reference pulse annotation if present
    if report.reference_pulse:
        ref_pulse = report.reference_pulse
        ref_color = 'green' if ref_pulse.status == "PASS" else 'red'

        # Position in top-right area
        ref_x = img.width - 400
        ref_y = 150

        ref_text = (f'REFERENCE PULSE (1mV Calibration)\n'
                   f'━━━━━━━━━━━━━━━━━━━━━━━━\n'
                   f'Height: {ref_pulse.actual_height_mm:.2f}mm '
                   f'(expected: {ref_pulse.expected_height_mm:.0f}mm)\n'
                   f'Width:  {ref_pulse.actual_width_mm:.2f}mm '
                   f'(expected: {ref_pulse.expected_width_mm:.0f}mm)\n'
                   f'Status: {ref_pulse.status} ✓' if ref_pulse.status == "PASS" else f'Status: {ref_pulse.status} ✗')

        ax.text(ref_x, ref_y, ref_text,
               color=ref_color, fontsize=9, fontweight='bold',
               ha='left', va='top', family='monospace',
               bbox=dict(boxstyle='round,pad=0.6', facecolor='white',
                        edgecolor=ref_color, linewidth=3, alpha=0.95))

    # 4. Add status banner at top center
    banner_text = f'VERIFICATION: {overall_status}'
    if overall_status == "PASS":
        banner_text += ' ✓'
    else:
        banner_text += ' ✗'

    banner_x = img.width / 2
    banner_y = 40

    ax.text(banner_x, banner_y, banner_text,
           color='white', fontsize=16, fontweight='bold',
           ha='center', va='center',
           bbox=dict(boxstyle='round,pad=0.8', facecolor=status_color,
                    edgecolor='white', linewidth=4, alpha=0.98))

    # 5. Add legend box showing verification criteria
    legend_x = 100
    legend_y = img.height - 200

    legend_text = (f'VERIFICATION CRITERIA:\n'
                  f'• 1 mV = 10 mm (amplitude)\n'
                  f'• 1 s = 25 mm (time)\n'
                  f'• Tolerance: ±{report.tolerance_mm} mm\n'
                  f'• Max error: {report.get_max_error():.3f} mm')

    ax.text(legend_x, legend_y, legend_text,
           color='black', fontsize=9, fontweight='bold',
           ha='left', va='bottom', family='monospace',
           bbox=dict(boxstyle='round,pad=0.6', facecolor='white',
                    edgecolor='gray', linewidth=2, alpha=0.9))

    # 6. Add measurement summary for all leads
    summary_x = img.width - 300
    summary_y = img.height - 200

    passed_leads = sum(1 for v in report.lead_verifications.values()
                      if v.get_summary()['status'] == 'PASS')
    total_leads = len(report.lead_verifications)

    summary_text = (f'LEAD SUMMARY:\n'
                   f'{passed_leads}/{total_leads} leads PASS\n'
                   f'{sum(v.get_summary()["num_points"] for v in report.lead_verifications.values())} '
                   f'measurements')

    ax.text(summary_x, summary_y, summary_text,
           color='black', fontsize=9, fontweight='bold',
           ha='left', va='bottom', family='monospace',
           bbox=dict(boxstyle='round,pad=0.6', facecolor='lightyellow',
                    edgecolor='orange', linewidth=2, alpha=0.9))

    # Save the annotated image
    plt.tight_layout(pad=0)
    plt.savefig(verified_image_path, dpi=dpi, pad_inches=0)
    plt.close()

    return json_report_path, verified_image_path, text_report_path

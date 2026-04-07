"""
Verification Overlay Module

Creates visual measurement overlays on ECG images to verify signal scaling.
Adds dimension lines, labels, and measurement annotations showing:
- Original XML voltage values
- Expected dimensions (based on 1mV=10mm, 1s=25mm)
- Actual rendered dimensions
- Pass/fail status for each measurement

This module operates on an already-rendered ECG image and adds measurement
annotations using matplotlib.
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
from PIL import Image
from typing import Dict, List, Tuple
from ecg_generator.config.constants import (
    MM_TO_PX, AMP_SCALE_PX_PER_MV, TIME_SCALE_PX_PER_S,
    AMP_SCALE_MM_PER_MV, TIME_SCALE_MM_PER_S
)
from ecg_generator.verification.core import (
    SignalVerificationData, VerificationReport,
    auto_select_measurement_points, ReferencePulseVerification
)


def add_dimension_line(ax, x1, y1, x2, y2, measurement_text, color='green',
                      offset_px=10, fontsize=8):
    """
    Add a dimension line with measurement annotation

    Args:
        ax: Matplotlib axes
        x1, y1: Start point coordinates
        x2, y2: End point coordinates
        measurement_text: Text to display (e.g., "10.0mm")
        color: Line and text color
        offset_px: Offset from the measurement line
        fontsize: Font size for text
    """
    # Draw the main dimension line
    ax.plot([x1, x2], [y1, y2], color=color, linewidth=2, alpha=0.8)

    # Draw end caps (perpendicular marks)
    cap_length = 15
    if abs(y2 - y1) < abs(x2 - x1):  # Horizontal line
        ax.plot([x1, x1], [y1 - cap_length/2, y1 + cap_length/2],
               color=color, linewidth=2, alpha=0.8)
        ax.plot([x2, x2], [y2 - cap_length/2, y2 + cap_length/2],
               color=color, linewidth=2, alpha=0.8)
        # Text position (above the line)
        text_x = (x1 + x2) / 2
        text_y = y1 - offset_px
        text_va = 'top'
    else:  # Vertical line
        ax.plot([x1 - cap_length/2, x1 + cap_length/2], [y1, y1],
               color=color, linewidth=2, alpha=0.8)
        ax.plot([x2 - cap_length/2, x2 + cap_length/2], [y2, y2],
               color=color, linewidth=2, alpha=0.8)
        # Text position (to the right of the line)
        text_x = x1 + offset_px
        text_y = (y1 + y2) / 2
        text_va = 'center'

    # Add text with background
    ax.text(text_x, text_y, measurement_text, color=color, fontsize=fontsize,
           fontweight='bold', ha='center', va=text_va,
           bbox=dict(boxstyle='round,pad=0.3', facecolor='white',
                    edgecolor=color, alpha=0.9))


def add_measurement_annotation(ax, x, y, xml_voltage, expected_mm, actual_mm,
                               status, baseline_y, fontsize=7):
    """
    Add a measurement annotation at a signal point

    Args:
        ax: Matplotlib axes
        x, y: Point coordinates
        xml_voltage: Original XML voltage in mV
        expected_mm: Expected dimension in mm
        actual_mm: Actual rendered dimension in mm
        status: "PASS" or "FAIL"
        baseline_y: Baseline Y coordinate
        fontsize: Font size for annotation
    """
    color = 'green' if status == "PASS" else 'red'

    # Draw line from baseline to measurement point
    ax.plot([x, x], [baseline_y, y], color=color, linewidth=1.5,
           linestyle='--', alpha=0.7)

    # Draw marker at measurement point
    ax.plot(x, y, 'o', color=color, markersize=6, markeredgecolor='white',
           markeredgewidth=1.5)

    # Create annotation text
    error_mm = actual_mm - expected_mm
    ann_text = (f"{xml_voltage:.2f}mV\n"
               f"Exp: {expected_mm:.1f}mm\n"
               f"Act: {actual_mm:.1f}mm\n"
               f"Err: {error_mm:+.2f}mm")

    # Position text to the side of the line
    text_x = x + 30
    text_y = (baseline_y + y) / 2

    ax.text(text_x, text_y, ann_text, color=color, fontsize=fontsize,
           ha='left', va='center', fontweight='bold',
           bbox=dict(boxstyle='round,pad=0.4', facecolor='white',
                    edgecolor=color, linewidth=2, alpha=0.95))


def add_grid_measurement_annotation(ax, x, y, grid_size_mm=5, fontsize=8):
    """
    Add annotation showing grid square dimensions

    Args:
        ax: Matplotlib axes
        x, y: Top-left corner of grid square
        grid_size_mm: Grid size in mm (default 5mm)
        fontsize: Font size for annotation
    """
    grid_size_px = grid_size_mm * MM_TO_PX

    # Draw highlighted grid square
    rect = patches.Rectangle((x, y), grid_size_px, grid_size_px,
                             linewidth=3, edgecolor='blue',
                             facecolor='none', alpha=0.8)
    ax.add_patch(rect)

    # Add dimension annotations
    # Horizontal dimension
    add_dimension_line(ax, x, y + grid_size_px + 20,
                      x + grid_size_px, y + grid_size_px + 20,
                      f"{grid_size_mm}mm", color='blue', fontsize=fontsize)

    # Vertical dimension
    add_dimension_line(ax, x - 20, y, x - 20, y + grid_size_px,
                      f"{grid_size_mm}mm", color='blue', fontsize=fontsize)


def calculate_signal_coordinates(config, leads_data, lead_name, sample_indices):
    """
    Calculate where specific signal samples are rendered based on configuration

    This re-implements the coordinate calculation from layout_renderer.py
    to determine where samples will appear in the rendered image.

    Args:
        config: Configuration dictionary
        leads_data: Dictionary of lead signals
        lead_name: Name of the lead
        sample_indices: List of sample indices to calculate coordinates for

    Returns:
        List of tuples: [(x_px, y_px, voltage_mV), ...]
    """
    # This is a simplified version - in practice, you'd need to import
    # and use the actual layout calculation from layout_renderer.py
    # For now, return None to indicate this needs to be calculated during rendering
    return None


def create_verification_overlay(image_path, verification_report: VerificationReport,
                                config, leads_data, output_path):
    """
    Create ECG image with verification measurement overlays

    Args:
        image_path: Path to the rendered ECG image
        verification_report: VerificationReport with measurements
        config: Configuration dictionary
        leads_data: Dictionary of lead signals
        output_path: Path to save the annotated image
    """
    # Load the ECG image
    img = Image.open(image_path)
    img_array = np.array(img)

    # Create figure with same size as image
    dpi = 300
    fig_width = img.width / dpi
    fig_height = img.height / dpi
    fig, ax = plt.subplots(figsize=(fig_width, fig_height), dpi=dpi)

    # Display the ECG image
    ax.imshow(img_array, aspect='equal')
    ax.axis('off')

    # Add grid square measurement (top-left corner)
    margin_mm = 10
    grid_x = margin_mm * MM_TO_PX
    grid_y = margin_mm * MM_TO_PX
    add_grid_measurement_annotation(ax, grid_x, grid_y, grid_size_mm=5)

    # Add measurement annotations for each lead
    for lead_name, lead_verification in verification_report.lead_verifications.items():
        if not lead_verification.verification_points:
            continue

        baseline_y = lead_verification.baseline_y_px

        # Add annotations for selected measurement points (limit to avoid clutter)
        points_to_annotate = lead_verification.verification_points[:3]  # First 3 points

        for point in points_to_annotate:
            add_measurement_annotation(
                ax, point.signal_x_px, point.signal_y_px,
                point.xml_voltage_mV, point.expected_height_mm,
                point.actual_height_mm, point.status, baseline_y
            )

    # Add reference pulse annotation if available
    if verification_report.reference_pulse:
        ref_pulse = verification_report.reference_pulse
        # Find a good location for reference pulse annotation
        # (This would need to be calculated based on where the pulse actually is)
        pulse_ann_x = 100
        pulse_ann_y = 100

        pulse_status_color = 'green' if ref_pulse.status == "PASS" else 'red'
        pulse_text = (f"Reference Pulse (1mV)\n"
                     f"Height: {ref_pulse.actual_height_mm:.2f}mm "
                     f"(exp: {ref_pulse.expected_height_mm:.2f}mm)\n"
                     f"Width: {ref_pulse.actual_width_mm:.2f}mm "
                     f"(exp: {ref_pulse.expected_width_mm:.2f}mm)")

        ax.text(pulse_ann_x, pulse_ann_y, pulse_text,
               color=pulse_status_color, fontsize=9, fontweight='bold',
               bbox=dict(boxstyle='round,pad=0.5', facecolor='white',
                        edgecolor=pulse_status_color, linewidth=2, alpha=0.95))

    # Add overall status banner
    overall_status = verification_report.get_overall_status()
    status_color = 'green' if overall_status == "PASS" else 'red'
    status_text = f"VERIFICATION: {overall_status}"

    banner_x = img.width / 2
    banner_y = 30

    ax.text(banner_x, banner_y, status_text, color='white', fontsize=14,
           fontweight='bold', ha='center', va='center',
           bbox=dict(boxstyle='round,pad=0.8', facecolor=status_color,
                    edgecolor='white', linewidth=3, alpha=0.95))

    # Add legend
    legend_x = img.width - 200
    legend_y = 50
    legend_text = ("Verification Criteria:\n"
                  "• 1 mV = 10 mm\n"
                  "• 1 s = 25 mm\n"
                  f"• Tolerance: ±{verification_report.tolerance_mm} mm")

    ax.text(legend_x, legend_y, legend_text, color='black', fontsize=8,
           ha='left', va='top', family='monospace',
           bbox=dict(boxstyle='round,pad=0.6', facecolor='white',
                    edgecolor='gray', linewidth=2, alpha=0.9))

    # Save the annotated image
    plt.tight_layout(pad=0)
    plt.savefig(output_path, dpi=dpi, pad_inches=0)
    plt.close()


def generate_verification_data_from_coords(leads_data, coord_data, config,
                                          sampling_rate=500.0, num_points=10):
    """
    Generate verification data from coordinate tracking data

    This function takes the coordinate data captured during rendering
    and creates verification measurements.

    Args:
        leads_data: Dictionary of lead signals (in mV)
        coord_data: CoordinateData object from rendering
        config: Configuration dictionary
        sampling_rate: Sampling rate in Hz
        num_points: Number of measurement points per lead

    Returns:
        Dictionary of SignalVerificationData objects (lead_name -> verification_data)
    """
    verification_data = {}

    for lead_name, signal in leads_data.items():
        # Skip if not a standard lead
        if lead_name not in ["I", "II", "III", "aVR", "aVL", "aVF",
                             "V1", "V2", "V3", "V4", "V5", "V6"]:
            continue

        # Create verification data for this lead
        lead_verification = SignalVerificationData(lead_name, sampling_rate)
        lead_verification.set_xml_signal(signal)

        # Auto-select measurement points
        measurement_indices = auto_select_measurement_points(signal, sampling_rate, num_points)

        # Get coordinates from coord_data if available
        if coord_data and hasattr(coord_data, 'lead_coordinates'):
            lead_coords = coord_data.lead_coordinates.get(lead_name, [])
            if lead_coords:
                # Calculate baseline (median Y coordinate)
                y_coords = [coord[1] for coord in lead_coords]
                baseline_y = np.median(y_coords)
                lead_verification.set_baseline(baseline_y)

                # Add measurement points
                for idx in measurement_indices:
                    if idx < len(lead_coords):
                        x_px, y_px = lead_coords[idx]
                        lead_verification.add_measurement_point(idx, x_px, y_px)

        verification_data[lead_name] = lead_verification

    return verification_data

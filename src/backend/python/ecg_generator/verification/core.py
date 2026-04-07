"""
Signal Verification Module

Provides end-to-end verification of ECG signal amplitude and timing scaling.
Tracks voltage values from XML parsing through rendering to ensure:
- Amplitude scaling: 1 mV = 10 mm
- Time scaling: 1 second = 25 mm

Classes:
    VerificationPoint: Single measurement point with XML voltage and rendered position
    SignalVerificationData: Collection of verification points for one signal
    VerificationReport: Complete verification report with pass/fail status
"""

import numpy as np
from typing import Dict, List, Tuple, Optional
import json
from dataclasses import dataclass, asdict
from ecg_generator.config.constants import MM_TO_PX, AMP_SCALE_MM_PER_MV, TIME_SCALE_MM_PER_S


@dataclass
class VerificationPoint:
    """
    Single verification point for amplitude/time measurement

    Attributes:
        time_s: Time in seconds from start of signal
        sample_index: Sample index in the signal array
        xml_voltage_mV: Original voltage from XML (in millivolts)
        baseline_y_px: Baseline Y coordinate in pixels
        signal_y_px: Actual rendered Y coordinate in pixels
        signal_x_px: Rendered X coordinate in pixels
        expected_height_mm: Expected height in mm (voltage * 10mm/mV)
        actual_height_mm: Actual rendered height in mm
        error_mm: Difference between expected and actual (mm)
        error_percent: Percentage error
        status: "PASS" or "FAIL" based on tolerance
    """
    time_s: float
    sample_index: int
    xml_voltage_mV: float
    baseline_y_px: float
    signal_y_px: float
    signal_x_px: float
    expected_height_mm: float
    actual_height_mm: float
    error_mm: float
    error_percent: float
    status: str

    def to_dict(self):
        """Convert to dictionary for JSON serialization"""
        return asdict(self)


@dataclass
class ReferencePulseVerification:
    """
    Verification data for the reference pulse (1mV calibration signal)

    Attributes:
        expected_height_mm: Expected pulse height (should be 10mm)
        actual_height_mm: Measured pulse height
        expected_width_mm: Expected pulse width (should be ~5mm for 0.2s pulse)
        actual_width_mm: Measured pulse width
        height_error_mm: Height measurement error
        width_error_mm: Width measurement error
        status: Overall pass/fail status
    """
    expected_height_mm: float
    actual_height_mm: float
    expected_width_mm: float
    actual_width_mm: float
    height_error_mm: float
    width_error_mm: float
    status: str

    def to_dict(self):
        """Convert to dictionary for JSON serialization"""
        return asdict(self)


class SignalVerificationData:
    """
    Verification data for a single ECG lead signal

    Tracks voltage values from XML through to rendered coordinates
    and compares expected vs actual dimensions.
    """

    def __init__(self, lead_name: str, sampling_rate: float = 500.0,
                 gain_mm_per_mV: float = None, speed_mm_per_s: float = None):
        """
        Initialize verification data for a lead

        Args:
            lead_name: Name of the ECG lead (e.g., "I", "II", "V1")
            sampling_rate: Sampling rate in Hz (default 500)
            gain_mm_per_mV: Amplitude gain in mm/mV (defaults to AMP_SCALE_MM_PER_MV)
            speed_mm_per_s: Paper speed in mm/s (defaults to TIME_SCALE_MM_PER_S)
        """
        self.lead_name = lead_name
        self.sampling_rate = sampling_rate
        self.gain_mm_per_mV = gain_mm_per_mV if gain_mm_per_mV is not None else AMP_SCALE_MM_PER_MV
        self.speed_mm_per_s = speed_mm_per_s if speed_mm_per_s is not None else TIME_SCALE_MM_PER_S
        self.verification_points: List[VerificationPoint] = []
        self.xml_signal: Optional[np.ndarray] = None
        self.baseline_y_px: Optional[float] = None

    def set_xml_signal(self, signal: np.ndarray):
        """Store the original signal from XML (in mV)"""
        self.xml_signal = signal

    def set_baseline(self, baseline_y_px: float):
        """Store the baseline Y coordinate"""
        self.baseline_y_px = baseline_y_px

    def add_measurement_point(self, sample_index: int, signal_x_px: float,
                            signal_y_px: float, tolerance_mm: float = 0.5):
        """
        Add a verification measurement point

        Args:
            sample_index: Index in the signal array
            signal_x_px: X coordinate of rendered point (pixels)
            signal_y_px: Y coordinate of rendered point (pixels)
            tolerance_mm: Acceptable error tolerance in mm (default 0.5mm)
        """
        if self.xml_signal is None or self.baseline_y_px is None:
            raise ValueError("Must call set_xml_signal() and set_baseline() first")

        # Get XML voltage at this sample
        xml_voltage_mV = float(self.xml_signal[sample_index])

        # Calculate time in seconds
        time_s = sample_index / self.sampling_rate

        # Calculate expected height in mm (amplitude scaling: 1mV = gain mm)
        expected_height_mm = xml_voltage_mV * self.gain_mm_per_mV

        # Calculate actual height in mm from pixel coordinates
        # Note: In ECG rendering, positive voltage goes UP (decreasing Y in image coordinates)
        actual_height_px = self.baseline_y_px - signal_y_px
        actual_height_mm = actual_height_px / MM_TO_PX

        # Calculate error
        error_mm = actual_height_mm - expected_height_mm
        error_percent = (error_mm / expected_height_mm * 100.0) if abs(expected_height_mm) > 0.001 else 0.0

        # Determine pass/fail
        status = "PASS" if abs(error_mm) <= tolerance_mm else "FAIL"

        # Create verification point
        point = VerificationPoint(
            time_s=time_s,
            sample_index=sample_index,
            xml_voltage_mV=xml_voltage_mV,
            baseline_y_px=self.baseline_y_px,
            signal_y_px=signal_y_px,
            signal_x_px=signal_x_px,
            expected_height_mm=expected_height_mm,
            actual_height_mm=actual_height_mm,
            error_mm=error_mm,
            error_percent=error_percent,
            status=status
        )

        self.verification_points.append(point)

    def get_summary(self) -> Dict:
        """Get summary statistics for this lead's verification"""
        if not self.verification_points:
            return {
                "lead_name": self.lead_name,
                "num_points": 0,
                "status": "NO_DATA"
            }

        errors = [p.error_mm for p in self.verification_points]
        statuses = [p.status for p in self.verification_points]

        return {
            "lead_name": self.lead_name,
            "num_points": len(self.verification_points),
            "max_error_mm": max(errors, key=abs),
            "mean_error_mm": np.mean(errors),
            "std_error_mm": np.std(errors),
            "num_passed": statuses.count("PASS"),
            "num_failed": statuses.count("FAIL"),
            "status": "PASS" if all(s == "PASS" for s in statuses) else "FAIL"
        }


class VerificationReport:
    """
    Complete verification report for an ECG image

    Aggregates verification data from all leads and generates
    comprehensive pass/fail report.
    """

    def __init__(self, xml_source: str, image_path: str):
        """
        Initialize verification report

        Args:
            xml_source: Path to source XML file
            image_path: Path to generated ECG image
        """
        self.xml_source = xml_source
        self.image_path = image_path
        self.lead_verifications: Dict[str, SignalVerificationData] = {}
        self.reference_pulse: Optional[ReferencePulseVerification] = None
        self.tolerance_mm = 0.5  # Default tolerance

    def add_lead_verification(self, verification_data: SignalVerificationData):
        """Add verification data for a lead"""
        self.lead_verifications[verification_data.lead_name] = verification_data

    def set_reference_pulse_verification(self, ref_pulse: ReferencePulseVerification):
        """Set reference pulse verification data"""
        self.reference_pulse = ref_pulse

    def get_overall_status(self) -> str:
        """Determine overall pass/fail status"""
        # Check reference pulse
        if self.reference_pulse and self.reference_pulse.status == "FAIL":
            return "FAIL"

        # Check all leads
        for lead_data in self.lead_verifications.values():
            summary = lead_data.get_summary()
            if summary["status"] == "FAIL":
                return "FAIL"

        return "PASS"

    def get_max_error(self) -> float:
        """Get maximum absolute error across all measurements"""
        max_error = 0.0

        for lead_data in self.lead_verifications.values():
            for point in lead_data.verification_points:
                max_error = max(max_error, abs(point.error_mm))

        return max_error

    def to_dict(self) -> Dict:
        """Convert report to dictionary for JSON export"""
        lead_measurements = {}
        for lead_name, lead_data in self.lead_verifications.items():
            lead_measurements[lead_name] = {
                "summary": lead_data.get_summary(),
                "measurements": [p.to_dict() for p in lead_data.verification_points]
            }

        report = {
            "xml_source": self.xml_source,
            "image_path": self.image_path,
            "tolerance_mm": self.tolerance_mm,
            "lead_measurements": lead_measurements,
            "overall_status": self.get_overall_status(),
            "max_amplitude_error_mm": self.get_max_error()
        }

        if self.reference_pulse:
            report["reference_pulse_verification"] = self.reference_pulse.to_dict()

        return report

    def save_json(self, output_path: str):
        """Save verification report as JSON file"""
        with open(output_path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)

    def save_text_report(self, output_path: str):
        """Save human-readable text report"""
        with open(output_path, 'w') as f:
            f.write("=" * 80 + "\n")
            f.write("ECG SIGNAL SCALING VERIFICATION REPORT\n")
            f.write("=" * 80 + "\n\n")

            f.write(f"XML Source: {self.xml_source}\n")
            f.write(f"ECG Image: {self.image_path}\n")
            f.write(f"Tolerance: ±{self.tolerance_mm} mm\n\n")

            # Reference pulse verification
            if self.reference_pulse:
                f.write("-" * 80 + "\n")
                f.write("REFERENCE PULSE VERIFICATION (1 mV Calibration Signal)\n")
                f.write("-" * 80 + "\n")
                f.write(f"Expected height: {self.reference_pulse.expected_height_mm:.3f} mm (1 mV)\n")
                f.write(f"Actual height:   {self.reference_pulse.actual_height_mm:.3f} mm\n")
                f.write(f"Height error:    {self.reference_pulse.height_error_mm:+.3f} mm\n\n")
                f.write(f"Expected width:  {self.reference_pulse.expected_width_mm:.3f} mm (0.2 s)\n")
                f.write(f"Actual width:    {self.reference_pulse.actual_width_mm:.3f} mm\n")
                f.write(f"Width error:     {self.reference_pulse.width_error_mm:+.3f} mm\n")
                f.write(f"Status: {self.reference_pulse.status}\n\n")

            # Per-lead summaries
            f.write("-" * 80 + "\n")
            f.write("LEAD VERIFICATION SUMMARIES\n")
            f.write("-" * 80 + "\n\n")

            for lead_name in sorted(self.lead_verifications.keys()):
                summary = self.lead_verifications[lead_name].get_summary()
                f.write(f"Lead {lead_name}:\n")
                f.write(f"  Measurement points: {summary['num_points']}\n")
                if summary['num_points'] > 0:
                    f.write(f"  Max error:  {summary['max_error_mm']:+.3f} mm\n")
                    f.write(f"  Mean error: {summary['mean_error_mm']:+.3f} mm\n")
                    f.write(f"  Std dev:    {summary['std_error_mm']:.3f} mm\n")
                    f.write(f"  Passed:     {summary['num_passed']}/{summary['num_points']}\n")
                    f.write(f"  Status:     {summary['status']}\n")
                f.write("\n")

            # Overall result
            f.write("=" * 80 + "\n")
            f.write(f"OVERALL STATUS: {self.get_overall_status()}\n")
            f.write(f"Maximum error: {self.get_max_error():.3f} mm\n")
            f.write("=" * 80 + "\n")

            # Scaling verification
            f.write("\nVERIFICATION CRITERIA:\n")
            f.write("  ✓ Amplitude scaling: 1 mV should render as 10 mm\n")
            f.write("  ✓ Time scaling: 1 second should render as 25 mm\n")
            f.write(f"  ✓ Tolerance: ±{self.tolerance_mm} mm\n")


def detect_signal_peaks(signal: np.ndarray, num_peaks: int = 5) -> List[int]:
    """
    Detect prominent peaks in ECG signal for measurement

    Args:
        signal: ECG signal array (in mV)
        num_peaks: Number of peaks to detect

    Returns:
        List of sample indices for detected peaks
    """
    # Find local maxima
    peaks = []
    for i in range(1, len(signal) - 1):
        if signal[i] > signal[i-1] and signal[i] > signal[i+1]:
            peaks.append((i, signal[i]))

    # Sort by amplitude and take top N
    peaks.sort(key=lambda x: abs(x[1]), reverse=True)
    peak_indices = [p[0] for p in peaks[:num_peaks]]
    peak_indices.sort()  # Sort by time

    return peak_indices


def auto_select_measurement_points(signal: np.ndarray, sampling_rate: float = 500.0,
                                   num_points: int = 10) -> List[int]:
    """
    Automatically select measurement points from ECG signal

    Strategy:
    - Detect R-wave peaks (highest amplitudes)
    - Add regular interval samples
    - Include start and end points

    Args:
        signal: ECG signal array (in mV)
        sampling_rate: Sampling rate in Hz
        num_points: Target number of measurement points

    Returns:
        List of sample indices to measure
    """
    indices = set()

    # Add peaks (R-waves typically)
    peak_count = min(num_points // 2, 5)
    peaks = detect_signal_peaks(signal, num_peaks=peak_count)
    indices.update(peaks)

    # Add regular interval samples
    interval = len(signal) // (num_points - peak_count)
    for i in range(0, len(signal), interval):
        indices.add(i)
        if len(indices) >= num_points:
            break

    # Always include first and last samples
    indices.add(0)
    indices.add(len(signal) - 1)

    # Convert to sorted list
    return sorted(list(indices))

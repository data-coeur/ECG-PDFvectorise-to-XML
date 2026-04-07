"""
Performance logging module for ECG generation timing

Tracks individual image generation times and provides summary statistics.
Outputs a performance log file with mean/min/max times and per-image durations.
"""

import time
from datetime import datetime
from typing import List, Tuple


class PerformanceLogger:
    """
    Logs timing information for ECG generation process

    Tracks generation times for multiple images in a session and outputs
    summary statistics (total/mean/min/max) along with individual image timings.
    """

    def __init__(self, log_path: str = "data/output_impression/performance_log.txt"):
        """
        Initialize performance logger

        Args:
            log_path (str): Path to the log file where performance data will be saved
        """
        self.log_path = log_path
        self.generation_times: List[Tuple[str, float]] = []
        self.session_start_time = None

    def start_session(self):
        """Mark the start of a generation session and reset timing data"""
        self.session_start_time = time.time()
        self.generation_times = []

    def log_generation(self, image_name: str, duration: float):
        """
        Log a single image generation time

        Args:
            image_name (str): Name of the generated image (e.g., "ECG_001_01.png")
            duration (float): Time taken to generate the image in seconds
        """
        self.generation_times.append((image_name, duration))

    def get_total_time(self) -> float:
        """
        Get the total generation time for all logged images

        Returns:
            float: Total time in seconds
        """
        return sum(duration for _, duration in self.generation_times)

    def save_log(self, verbose: bool = True):
        """
        Save the performance log with summary statistics and individual times

        Writes to log file: timestamp, summary stats (total/mean/min/max), and per-image timings.
        Optionally prints summary to console based on verbose flag. Overwrites any existing log file.

        Args:
            verbose (bool): If True, print summary to console. Defaults to True.
        """
        if not self.generation_times:
            return

        total_time = sum(duration for _, duration in self.generation_times)
        mean_time = total_time / len(self.generation_times)
        min_time = min(duration for _, duration in self.generation_times)
        max_time = max(duration for _, duration in self.generation_times)

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Format total time for log file (with minutes if >= 1 minute)
        total_minutes = total_time / 60
        if total_minutes >= 1:
            minutes = int(total_minutes)
            seconds = int(total_time % 60)
            total_time_str = f"{minutes} minute{'s' if minutes != 1 else ''} {seconds} second{'s' if seconds != 1 else ''} ({total_time:.2f}s)"
        else:
            total_time_str = f"{total_time:.2f} seconds"

        with open(self.log_path, 'w', encoding='utf-8') as f:
            f.write("ECG Generation Performance Log\n")
            f.write("=" * 50 + "\n")
            f.write(f"Date: {timestamp}\n")
            f.write("\n")

            f.write("Summary Statistics:\n")
            f.write(f"  Total images: {len(self.generation_times)}\n")
            f.write(f"  Total time: {total_time_str}\n")
            f.write(f"  Mean time per image: {mean_time:.2f}s\n")
            f.write(f"  Min time: {min_time:.2f}s\n")
            f.write(f"  Max time: {max_time:.2f}s\n")
            f.write("\n")

            f.write("Individual Generation Times:\n")
            for image_name, duration in self.generation_times:
                f.write(f"  {image_name}: {duration:.2f}s\n")

        # Print to console only if verbose is enabled
        if verbose:
            # Format total time for console output
            total_minutes = total_time / 60
            if total_minutes >= 1:
                minutes = int(total_minutes)
                seconds = int(total_time % 60)
                time_str = f"{minutes} minute{'s' if minutes != 1 else ''} {seconds} second{'s' if seconds != 1 else ''}"
            else:
                time_str = f"{total_time:.2f} seconds"

            print(f"\n[PERFORMANCE] Log saved to {self.log_path}")
            print(f"[PERFORMANCE] Total: {time_str} | Mean: {mean_time:.2f}s | Images: {len(self.generation_times)}")


class TimingContext:
    """
    Context manager for timing individual operations

    Usage:
        with TimingContext() as timer:
            # ... perform operation ...
        duration = timer.get_duration()
    """

    def __init__(self):
        self.start_time = None
        self.duration = None

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.duration = time.time() - self.start_time
        return False

    def get_duration(self) -> float:
        """
        Get the duration of the timed operation

        Returns:
            float: Duration in seconds (0.0 if not yet completed)
        """
        return self.duration if self.duration is not None else 0.0

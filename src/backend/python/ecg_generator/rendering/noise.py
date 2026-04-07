"""
Noise generation functions for ECG signals

Based on scientific specifications for realistic baseline wander and muscle interference.
Implements low-frequency noise (0.05-0.3 Hz) and high-frequency noise (40-50 Hz).
"""

import numpy as np


def add_noise_to_leads(leads_data, noise_type, noise_seed=None):
    """
    Add noise to ECG data according to scientific specifications

    Args:
        leads_data (dict): ECG lead data (lead_name -> signal array)
        noise_type (str): Noise type - "none", "low frequency", "high frequency"
        noise_seed (int, optional): Seed for noise reproducibility

    Returns:
        tuple: (noisy_ecg_data, used_seed)
            - noisy_ecg_data (dict): ECG data with noise added
            - used_seed (int): Seed used for noise generation
    """
    # Generate seed if not provided
    if noise_seed is None:
        noise_seed = np.random.randint(0, 2**32 - 1)

    # Save current RNG state to restore later
    current_state = np.random.get_state()

    # Set seed for reproducible noise
    np.random.seed(noise_seed)

    noisy_data = {}

    for lead, signal in leads_data.items():
        if noise_type == "none":
            noisy_data[lead] = signal.copy()
        elif noise_type == "low frequency":
            # Low frequency: Baseline wandering (0.05-0.3 Hz)
            noise = _generate_low_frequency_noise(signal)
            noisy_data[lead] = signal + noise
        elif noise_type == "powerline":
            # Powerline interference (50/60 Hz)
            noise = _generate_powerline_noise(signal)
            noisy_data[lead] = signal + noise
        elif noise_type == "high frequency":
            # High frequency: Muscle interference (40-50 Hz)
            noise = _generate_high_frequency_noise(signal)
            noisy_data[lead] = signal + noise
        else:
            # Fallback: no noise
            noisy_data[lead] = signal.copy()

    # Restore original RNG state
    np.random.set_state(current_state)

    return noisy_data, noise_seed


def _generate_low_frequency_noise(signal):
    """
    Generate low-frequency noise simulating baseline wander

    Specifications:
    - Frequency: 0.05-0.3 Hz (baseline wandering)
    - Amplitude: Random level between Low/Middle/Large
      * Low: 0.1-0.25 mV
      * Middle: 0.25-0.5 mV
      * Large: 0.5-0.75 mV

    Args:
        signal (np.ndarray): Input ECG signal

    Returns:
        np.ndarray: Low-frequency noise array (same length as input)
    """
    sampling_rate = 500  # Hz (standard ECG sampling rate)
    signal_length = len(signal)
    time_axis = np.linspace(0, signal_length/sampling_rate, signal_length)

    # Randomly choose amplitude level
    level = np.random.choice(['low', 'middle', 'large'])

    if level == 'low':
        amplitude = np.random.uniform(0.1, 0.25)
    elif level == 'middle':
        amplitude = np.random.uniform(0.25, 0.5)
    else:  # large
        amplitude = np.random.uniform(0.5, 0.75)

    # Random frequency in 0.05-0.3 Hz range
    frequency = np.random.uniform(0.05, 0.3)

    # Generate baseline wander (slow sinusoid)
    baseline_wander = amplitude * np.sin(2 * np.pi * frequency * time_axis)

    # Add slow random component for realism
    random_component = np.random.normal(0, amplitude * 0.1, size=signal_length)
    # Filter to keep only low frequencies
    random_component = np.convolve(random_component, np.ones(100)/100, mode='same')

    return baseline_wander + random_component


def _generate_high_frequency_noise(signal):
    """
    Generate high-frequency noise simulating muscle interference

    Specifications:
    - Frequency: 40-50 Hz (muscle frequency interference)
    - Amplitude: Random level between Low/Middle/Large
      * Low: 0.02-0.05 mV
      * Middle: 0.05-0.1 mV
      * Large: 0.1-0.15 mV

    Args:
        signal (np.ndarray): Input ECG signal

    Returns:
        np.ndarray: High-frequency noise array (same length as input)
    """
    sampling_rate = 500  # Hz (standard ECG sampling rate)
    signal_length = len(signal)
    time_axis = np.linspace(0, signal_length/sampling_rate, signal_length)

    # Randomly choose amplitude level
    level = np.random.choice(['low', 'middle', 'large'])

    if level == 'low':
        amplitude = np.random.uniform(0.02, 0.05)
    elif level == 'middle':
        amplitude = np.random.uniform(0.05, 0.1)
    else:  # large
        amplitude = np.random.uniform(0.1, 0.15)

    # Random frequency in 40-50 Hz range
    frequency = np.random.uniform(40, 50)

    # Generate base muscle interference (high-frequency sinusoid)
    muscle_interference = amplitude * np.sin(2 * np.pi * frequency * time_axis)

    # Add high-frequency white noise for realism
    white_noise = np.random.normal(0, amplitude * 0.2, size=signal_length)

    # Modulate amplitude to simulate variable muscle contractions
    modulation_freq = np.random.uniform(0.1, 2.0)  # Slow modulation
    modulation = 0.5 + 0.5 * np.sin(2 * np.pi * modulation_freq * time_axis)

    return muscle_interference * modulation + white_noise


def _generate_powerline_noise(signal):
    """
    Generate powerline interference noise (50/60 Hz)

    Specifications:
    - Frequency: 50 Hz (Europe) or 60 Hz (Americas), randomly chosen
    - Amplitude: Random level between Low/Middle/Large
      * Low: 0.01-0.03 mV
      * Middle: 0.03-0.08 mV
      * Large: 0.08-0.15 mV
    - Includes harmonics at 2x (30% amplitude) and 3x (10% amplitude)

    Args:
        signal (np.ndarray): Input ECG signal

    Returns:
        np.ndarray: Powerline noise array (same length as input)
    """
    sampling_rate = 500  # Hz
    signal_length = len(signal)
    time_axis = np.linspace(0, signal_length / sampling_rate, signal_length)

    # Choose 50 or 60 Hz with small Gaussian jitter (σ=0.5 Hz)
    fundamental_freq = np.random.choice([50.0, 60.0])
    fundamental_freq += np.random.normal(0, 0.5)

    # Randomly choose amplitude level
    level = np.random.choice(['low', 'middle', 'large'])
    if level == 'low':
        amplitude = np.random.uniform(0.01, 0.03)
    elif level == 'middle':
        amplitude = np.random.uniform(0.03, 0.08)
    else:
        amplitude = np.random.uniform(0.08, 0.15)

    # Random phase offset
    phase = np.random.uniform(0, 2 * np.pi)

    # Fundamental + harmonics
    noise = amplitude * np.sin(2 * np.pi * fundamental_freq * time_axis + phase)
    noise += amplitude * 0.3 * np.sin(2 * np.pi * 2 * fundamental_freq * time_axis + phase)
    # 3rd harmonic present in 30% of cases (when 2nd harmonic is present)
    if np.random.random() < 0.3:
        noise += amplitude * 0.1 * np.sin(2 * np.pi * 3 * fundamental_freq * time_axis + phase)

    return noise


DECIMATION_RATES = [72, 100, 200]  # Target rates when decimating from 500Hz
ORIGINAL_RATE = 500  # Standard ECG sampling rate


def decimate_leads(leads_data, seed=None, probability=0.3, original_rate=ORIGINAL_RATE):
    """Optionally decimate signal from 500Hz to a lower sampling rate.

    With *probability* chance, resample all leads to one of {72, 100, 200} Hz.
    Otherwise keep the original 500 Hz data untouched.

    Args:
        leads_data: dict of lead_name -> signal array (at *original_rate*)
        seed: RNG seed for reproducibility
        probability: chance of decimation (default 0.3 = 30%)
        original_rate: input sampling rate in Hz

    Returns:
        (leads_out, actual_rate): decimated lead dict and resulting sampling rate
    """
    rng = np.random.RandomState(seed)

    if rng.uniform() >= probability:
        return leads_data, original_rate

    target_rate = int(rng.choice(DECIMATION_RATES))
    n_orig = len(next(iter(leads_data.values())))
    n_target = int(round(n_orig * target_rate / original_rate))

    if n_target >= n_orig or n_target < 10:
        return leads_data, original_rate

    # Resample using linear interpolation (simple, no scipy dependency)
    x_orig = np.arange(n_orig, dtype=np.float64)
    x_target = np.linspace(0, n_orig - 1, n_target)

    decimated = {}
    for lead, signal in leads_data.items():
        decimated[lead] = np.interp(x_target, x_orig, signal).astype(signal.dtype)

    return decimated, target_rate


def get_noise_suffix(noise_type):
    """
    Return file suffix based on noise type

    Args:
        noise_type (str): Noise type - "none", "low frequency", or "high frequency"

    Returns:
        str: Suffix for filename ("_BF" for low frequency, "_HF" for high frequency, "" otherwise)
    """
    if noise_type == "none":
        return ""
    elif noise_type == "low frequency":
        return "_BF"
    elif noise_type == "powerline":
        return "_PL"
    elif noise_type == "high frequency":
        return "_HF"
    else:
        return ""
"""
XML parser module for ECG data

Parses ECG XML files to extract rhythm waveform data and compute derived leads.
"""

import xml.etree.ElementTree as ET
import base64
import numpy as np


def load_ecg_from_xml(xml_path):
    """
    Load ECG data from XML file and extract leads

    Parses XML to extract rhythm waveform data, converts from base64-encoded
    little-endian int16 format, and computes derived Goldberger leads (III, aVR, aVL, aVF).

    Args:
        xml_path (str): Path to the ECG XML file

    Returns:
        dict: Dictionary containing ordered lead data (lead_name -> signal array in mV)
    """
    tree = ET.parse(xml_path)
    root = tree.getroot()

    leads_data = {}
    for waveform in root.findall(".//Waveform"):
        waveform_type = waveform.find("WaveformType")
        if waveform_type is not None and waveform_type.text.strip().upper() == "RHYTHM":
            for lead in waveform.findall("LeadData"):
                lead_id = lead.find("LeadID").text.strip()
                gain = float(lead.find("LeadAmplitudeUnitsPerBit").text.strip())
                waveform_data = lead.find("WaveFormData").text.replace('\n', '').replace('\r', '')
                decoded = base64.b64decode(waveform_data)
                signal = np.frombuffer(decoded, dtype='<i2') * gain / 1000  # µV → mV
                leads_data[lead_id] = signal

    # Compute missing derived leads (Goldberger augmented leads and lead III)
    if "I" in leads_data and "II" in leads_data:
        leads_data["III"] = leads_data["II"] - leads_data["I"]
        leads_data["aVR"] = -(leads_data["I"] + leads_data["II"]) / 2
        leads_data["aVL"] = (leads_data["I"] - leads_data["III"]) / 2
        leads_data["aVF"] = (leads_data["II"] + leads_data["III"]) / 2

    # Return leads in standard 12-lead ECG order
    lead_order = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
    ordered_leads = {lead: leads_data[lead] for lead in lead_order if lead in leads_data}

    return ordered_leads



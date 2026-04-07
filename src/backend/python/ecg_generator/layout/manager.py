"""
Layout management and lead nomenclature functions

Handles lead ordering (normal, Cabrera, territory-based, shuffle) and nomenclature
variations (standard vs. alternative naming like I/DI, V1/C1).
"""

import random
from ecg_generator.config.constants import LEAD_ORDERS, LEAD_NOMENCLATURES


def apply_lead_order(layout_template, lead_order_type, rhythm_leads=None):
    """
    Apply lead ordering to a generic layout template

    Converts generic placeholders like "lead[0]", "lead[1]" into specific lead names
    according to the selected ordering scheme (normal, Cabrera, territory, shuffle).

    Args:
        layout_template (list): Generic layout template with "lead[N]" and "rhythm[N]" placeholders
        lead_order_type (str): Order type - "normal", "cabrera", "territoire", or "shuffle"
        rhythm_leads (list, optional): List of lead names for rhythm strips (for formats with extra leads)

    Returns:
        list: Layout with concrete lead names replacing placeholders
    """
    if lead_order_type == "shuffle":
        # Generate random order by shuffling standard order
        base_leads = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
        lead_order = base_leads.copy()
        random.shuffle(lead_order)
    else:
        lead_order = LEAD_ORDERS[lead_order_type]

    def _resolve_cell(cell):
        """Resolve a single cell template to a concrete lead name."""
        if cell.startswith("lead[") and cell.endswith("]"):
            index = int(cell[5:-1])  # Extract index: "lead[5]" -> 5
            return lead_order[index]
        elif cell.startswith("rhythm[") and cell.endswith("]"):
            index = int(cell[7:-1])  # Extract rhythm index: "rhythm[0]" -> 0
            if rhythm_leads and index < len(rhythm_leads):
                return rhythm_leads[index]
            return cell  # Fallback if rhythm_leads not provided
        return cell

    concrete_layout = []
    for row in layout_template:
        # Handle nested pages (e.g. 6x1;6x1 format: list of pages, each a list of rows)
        if row and isinstance(row[0], list):
            concrete_page = []
            for sub_row in row:
                concrete_page.append([_resolve_cell(c) for c in sub_row])
            concrete_row = concrete_page
        else:
            concrete_row = [_resolve_cell(c) for c in row]
        concrete_layout.append(concrete_row)
    return concrete_layout


def apply_lead_nomenclatures(layout, nomenclatures):
    """
    Apply alternative nomenclatures to lead names

    Converts between standard and alternative naming conventions:
    - Limb leads: I/DI, II/DII, aVR/AVr, etc.
    - Precordial leads: V1/C1, V2/C2, etc.

    Args:
        layout (list): Layout with lead names
        nomenclatures (dict): Nomenclatures to apply with keys "peripheriques" and "precordiales"

    Returns:
        list: Layout with nomenclatures applied (lead names replaced)
    """
    periph_mapping = LEAD_NOMENCLATURES["peripheriques"][nomenclatures["peripheriques"]]
    precord_mapping = LEAD_NOMENCLATURES["precordiales"][nomenclatures["precordiales"]]

    full_mapping = {**periph_mapping, **precord_mapping}

    renamed_layout = []
    for row in layout:
        renamed_row = []
        for cell in row:
            renamed_row.append(full_mapping.get(cell, cell))  # Map if exists, else keep unchanged
        renamed_layout.append(renamed_row)

    return renamed_layout


def create_inverse_mapping(nomenclatures):
    """
    Create inverse mapping to recover original lead names from displayed names

    Useful for converting back from alternative nomenclatures (e.g., DI -> I, C1 -> V1)
    to standard internal lead names.

    Args:
        nomenclatures (dict): Nomenclatures used with keys "peripheriques" and "precordiales"

    Returns:
        dict: Inverse mapping (displayed_name -> original_name)
              Example: {"DI": "I", "C1": "V1", ...}
    """
    periph_mapping = LEAD_NOMENCLATURES["peripheriques"][nomenclatures["peripheriques"]]
    precord_mapping = LEAD_NOMENCLATURES["precordiales"][nomenclatures["precordiales"]]
    full_mapping = {**periph_mapping, **precord_mapping}

    inverse_mapping = {v: k for k, v in full_mapping.items()}

    return inverse_mapping
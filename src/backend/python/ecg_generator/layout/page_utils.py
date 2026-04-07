"""
Multi-page layout utilities for ECG generation

Provides helper functions to detect and handle multi-page ECG formats.
Multi-page formats use a 3D structure (list of page layouts), while single-page
formats use a 2D structure (single layout grid).
"""


def is_multipage_format(layout_template):
    """
    Detect if a layout template represents a multi-page format

    Multi-page templates are 3D structures: list of pages, each page being a 2D layout
    Single-page templates are 2D structures: list of rows, each row being a list of cells

    Args:
        layout_template (list): Layout template from LAYOUT_TEMPLATES

    Returns:
        bool: True if multi-page (3D), False if single-page (2D)

    Examples:
        >>> # Single-page (2D): [["lead[0]", "lead[1]"], ["lead[2]", "lead[3]"]]
        >>> is_multipage_format([["lead[0]", "lead[1]"], ["lead[2]", "lead[3]"]])
        False

        >>> # Multi-page (3D): [[["lead[0]"]], [["lead[6]"]]]
        >>> is_multipage_format([[["lead[0]"]], [["lead[6]"]]])
        True
    """
    if not layout_template or not layout_template[0]:
        return False

    # Check if first element of first row is a list (3D) or string (2D)
    return isinstance(layout_template[0][0], list)


def get_page_count(layout_template):
    """
    Get the number of pages in a layout template

    Args:
        layout_template (list): Layout template from LAYOUT_TEMPLATES

    Returns:
        int: Number of pages (1 for single-page, N for multi-page)

    Examples:
        >>> get_page_count([["lead[0]", "lead[1]"]])  # Single-page 3x4
        1

        >>> get_page_count([[["lead[0]"]], [["lead[6]"]]])  # Multi-page 6x1;6x1
        2
    """
    if is_multipage_format(layout_template):
        return len(layout_template)
    else:
        return 1


def get_page_layout(layout_template, page_index):
    """
    Extract the layout for a specific page

    Handles both single-page and multi-page templates. For single-page formats,
    always returns the full template regardless of page_index.

    Args:
        layout_template (list): Layout template from LAYOUT_TEMPLATES
        page_index (int): Page index (0-based)

    Returns:
        list: 2D layout grid for the specified page

    Raises:
        IndexError: If page_index is out of range for multi-page format

    Examples:
        >>> # Single-page: always returns full template
        >>> get_page_layout([["lead[0]", "lead[1]"]], 0)
        [["lead[0]", "lead[1]"]]

        >>> # Multi-page: returns specific page layout
        >>> template = [[["lead[0]"]], [["lead[6]"]]]
        >>> get_page_layout(template, 0)
        [["lead[0]"]]
        >>> get_page_layout(template, 1)
        [["lead[6]"]]
    """
    if is_multipage_format(layout_template):
        return layout_template[page_index]
    else:
        # Single-page: return entire template (page_index ignored)
        return layout_template

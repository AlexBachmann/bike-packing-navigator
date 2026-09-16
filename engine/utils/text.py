"""
engine.utils.text - String sanitization, slugification, and formatting.

Provides robust URL and filesystem slug generation, identifier sanitization,
and standardized distance/elevation string formatting.
"""

import re
import unicodedata
from typing import Optional


def slugify(text: str, sep: str = "-", default: Optional[str] = None) -> str:
    r"""
    Convert an arbitrary string into a clean URL / filesystem slug.

    Pre-converts German eszett (ß/ẞ -> ss), normalizes Unicode accents
    (NFKD decomposition stripping combining marks), preserves non-Latin
    Unicode word characters (\w), collapses duplicate separators, and
    trims leading/trailing separators.

    Args:
        text: Input string (e.g. "Col du Galibier 2,642m!", "Бишкек", "Großglockner").
        sep: Separator character ("-" for route slugs, "_" for feature IDs).
        default: Fallback slug if the processed string evaluates to empty.

    Returns:
        Clean slug string (e.g. "col-du-galibier-2642m", "бишкек", "grossglockner").
    """
    if not text:
        return default if default is not None else ""

    # Pre-convert German eszett
    text = text.replace("ß", "ss").replace("ẞ", "ss")

    # Normalize unicode accents while preserving non-Latin scripts (Cyrillic, CJK, Greek)
    text = "".join(
        ch for ch in unicodedata.normalize("NFKD", text)
        if unicodedata.category(ch) != "Mn"
    )

    text = text.lower().strip()
    # Replace non-word characters (except dashes and underscores) with space
    text = re.sub(r"[^\w\s-]+", " ", text)
    # Replace whitespace, dashes, and underscores with the designated separator
    text = re.sub(r"[-\s_]+", sep, text)
    result = text.strip(sep)

    if not result:
        return default if default is not None else ""
    return result


def sanitize_name(name: str) -> str:
    """
    Clean up a human-readable name by stripping whitespace, control characters,
    and normalizing consecutive spaces to a single space.

    Args:
        name: Raw name string.

    Returns:
        Cleaned name string.
    """
    if not name:
        return ""
    return re.sub(r"\s+", " ", name).strip()


def sanitize_identifier(text: str, default: Optional[str] = None) -> str:
    """
    Convert a string into a valid programming / JSON identifier token.
    Uses underscores and enforces lowercase alphanumeric characters.
    """
    return slugify(text, sep="_", default=default)


sanitize_id = sanitize_identifier


def format_distance(km: float, imperial: bool = False, precision: int = 1) -> str:
    """Format distance into human-readable string (e.g. '120.5 km' or '74.9 mi')."""
    if imperial:
        return f"{km * 0.621371:.{precision}f} mi"
    return f"{km:.{precision}f} km"


def format_distance_km(km: float, precision: int = 1) -> str:
    """Format distance in kilometers (e.g. '12.3 km')."""
    return f"{km:.{precision}f} km"


def format_elevation(meters: float, imperial: bool = False) -> str:
    """Format elevation into human-readable string (e.g. '1,450 m' or '4,757 ft')."""
    if imperial:
        ft = round(meters * 3.28084)
        return f"{ft:,} ft"
    m = round(meters)
    return f"{m:,} m"

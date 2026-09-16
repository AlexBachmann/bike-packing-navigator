#!/usr/bin/env python3
"""
find_places.py - Backward-compatible forwarder for Google Places POI search.
"""

from pathlib import Path
import sys


def _find_project_root() -> Path:
    p = Path(__file__).resolve()
    for parent in p.parents:
        if (parent / "engine").is_dir():
            return parent
    return p.parents[4]


PROJECT_ROOT = _find_project_root()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from engine.cli.places import main as places_main
from engine.enrichment.places import (
    GooglePlacesClient,
    MockPlacesClient,
    Place,
    PlaceLocation,
    fetch_places_along_route,
)

__all__ = [
    "GooglePlacesClient",
    "MockPlacesClient",
    "Place",
    "PlaceLocation",
    "fetch_places_along_route",
    "main",
]


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    return places_main(argv)


if __name__ == "__main__":
    sys.exit(main())

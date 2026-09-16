#!/usr/bin/env python3
"""
mock_places.py - Backward-compatible forwarder for mock POI generation.
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
from engine.enrichment.places import MockPlacesClient, Place, PlaceLocation

__all__ = ["MockPlacesClient", "Place", "PlaceLocation", "main"]


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    args = list(argv)
    if "--mock" not in args:
        args.append("--mock")
    return places_main(args)


if __name__ == "__main__":
    sys.exit(main())

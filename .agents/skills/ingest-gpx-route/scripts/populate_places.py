#!/usr/bin/env python3
"""
populate_places.py - Legacy alias forwarding to engine.cli.places.
"""

from pathlib import Path
import sys

from find_places import (
    GooglePlacesClient,
    MockPlacesClient,
    Place,
    PlaceLocation,
    fetch_places_along_route,
    main,
)

__all__ = [
    "GooglePlacesClient",
    "MockPlacesClient",
    "Place",
    "PlaceLocation",
    "fetch_places_along_route",
    "main",
]

if __name__ == "__main__":
    sys.exit(main())

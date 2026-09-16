#!/usr/bin/env python3
"""
generate_corridor_pmtiles.py - Legacy alias for build_route_pmtiles.py.
"""

from pathlib import Path
import sys

from build_route_pmtiles import (
    PMTilesArchive,
    PMTilesBuilder,
    PMTilesCorridorExtractor,
    PMTilesSectionSlicer,
    main,
)

__all__ = [
    "PMTilesBuilder",
    "PMTilesCorridorExtractor",
    "PMTilesArchive",
    "PMTilesSectionSlicer",
    "main",
]

if __name__ == "__main__":
    sys.exit(main())

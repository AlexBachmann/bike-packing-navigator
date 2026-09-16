#!/usr/bin/env python3
"""
snap_route_to_osm.py - Legacy alias for snap_to_roads.py.
"""

from pathlib import Path
import sys

from snap_to_roads import (
    CLASS_PENALTIES,
    OsmRoadNetwork,
    SnappedGuidanceTrack,
    SnappingConfig,
    main,
    snap_track_to_osm,
)

__all__ = [
    "snap_track_to_osm",
    "SnappingConfig",
    "SnappedGuidanceTrack",
    "OsmRoadNetwork",
    "CLASS_PENALTIES",
    "main",
]

if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
parse_gpx.py - Legacy alias for densify_route_track.py.
"""

from pathlib import Path
import sys

# Forward all exports and main execution
from densify_route_track import RoutePoint, RouteTrack, main, parse_gpx, parse_gpx_track

__all__ = ["parse_gpx", "parse_gpx_track", "RouteTrack", "RoutePoint", "main"]

if __name__ == "__main__":
    sys.exit(main())

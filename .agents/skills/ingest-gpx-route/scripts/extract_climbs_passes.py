#!/usr/bin/env python3
"""
extract_climbs_passes.py - Legacy alias combining calculate_route_climbs and extract_mountain_passes.
"""

from pathlib import Path
import sys

from calculate_route_climbs import Climb, detect_climbs, main
from extract_mountain_passes import MountainPass, extract_mountain_passes

__all__ = ["detect_climbs", "Climb", "extract_mountain_passes", "MountainPass", "main"]

if __name__ == "__main__":
    sys.exit(main())

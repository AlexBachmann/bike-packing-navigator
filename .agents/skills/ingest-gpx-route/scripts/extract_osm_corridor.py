#!/usr/bin/env python3
"""
extract_osm_corridor.py - Legacy alias for extract_18km_corridor.py.
"""

from pathlib import Path
import sys

from extract_18km_corridor import compute_corridor_bbox, generate_corridor_polygon, main

__all__ = ["generate_corridor_polygon", "compute_corridor_bbox", "main"]

if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
generate_surfaces.py - Legacy alias for generate_surface_intervals.py.
"""

from pathlib import Path
import sys

from generate_surface_intervals import (
    SurfaceInterval,
    clean_and_merge_intervals,
    generate_route_surfaces,
    main,
)

__all__ = ["generate_route_surfaces", "clean_and_merge_intervals", "SurfaceInterval", "main"]

if __name__ == "__main__":
    sys.exit(main())

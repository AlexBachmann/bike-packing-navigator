#!/usr/bin/env python3
"""
extract_milestones.py - Legacy alias for generate_milestones.py.
"""

from pathlib import Path
import sys

from generate_milestones import RouteMilestone, generate_route_milestones, main

__all__ = ["generate_route_milestones", "RouteMilestone", "main"]

if __name__ == "__main__":
    sys.exit(main())

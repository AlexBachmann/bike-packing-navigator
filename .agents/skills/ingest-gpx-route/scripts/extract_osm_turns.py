#!/usr/bin/env python3
"""
extract_osm_turns.py - Legacy alias for generate_turn_cues.py.
"""

from pathlib import Path
import sys

from generate_turn_cues import (
    TurnCue,
    extract_turn_cues,
    extract_turns_from_pmtiles,
    main,
    save_turns_json,
)

__all__ = ["extract_turns_from_pmtiles", "extract_turn_cues", "save_turns_json", "TurnCue", "main"]

if __name__ == "__main__":
    sys.exit(main())

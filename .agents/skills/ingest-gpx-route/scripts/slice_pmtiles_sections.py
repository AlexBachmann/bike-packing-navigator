#!/usr/bin/env python3
"""
slice_pmtiles_sections.py - Backward-compatible forwarder for multi-section PMTiles slicing.
"""

import argparse
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

from engine.tiles.pmtiles import PMTilesSectionSlicer, SectionDefinition

__all__ = ["PMTilesSectionSlicer", "SectionDefinition", "main"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Slice PMTiles archive into regional section files")
    parser.add_argument("--master", required=True, help="Master PMTiles archive")
    parser.add_argument("--track", required=True, help="Path to route-track.json")
    parser.add_argument("--output-dir", required=True, help="Output directory for sections")
    parser.add_argument("--sections", help="Path to custom section definitions JSON")
    args = parser.parse_args(argv)

    slicer = PMTilesSectionSlicer(Path(args.master))
    results = slicer.slice_archive(
        track_path=Path(args.track),
        output_dir=Path(args.output_dir),
        sections_config=Path(args.sections) if args.sections else None,
    )
    print(f"[PMTiles Slicer] Generated {len(results)} section archives in {args.output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

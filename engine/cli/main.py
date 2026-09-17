"""
engine.cli.main - Top-level unified command-line entrypoint for Bikepack Navigator.

Provides multi-command architecture:
  engine [GLOBAL_FLAGS] <subcommand> [OPTIONS]

Subcommands:
  - ingest: Master end-to-end route ingestion pipeline
  - places: Google Places POI query, caching, and batch enrichment
  - water: Backcountry water access waypoint extraction
  - climbs: Mountain climb detection, categorization, and pass extraction
  - surfaces: Route surface intervals modeling and classification
  - tiles: PMTiles corridor archive generation, clipping, and slicing
  - manifest: Central route manifest registration and verification
  - info: Route telemetry and dataset completeness inspection
"""

import argparse
import json
import logging
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Sequence, Union

from engine import __version__
from engine.utils.io import atomic_write_json, read_json

logger = logging.getLogger("engine")


def _resolve_project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def build_parser() -> argparse.ArgumentParser:
    """Build the unified top-level command-line argument parser."""
    parser = argparse.ArgumentParser(
        prog="engine",
        description="Bikepack Navigator Unified Engine CLI - Route Ingestion, Telemetry, and Enrichment",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"bikepack-engine {__version__}",
        help="Show program version and exit",
    )

    # Global output options
    v_group = parser.add_mutually_exclusive_group()
    v_group.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose debug logging",
    )
    v_group.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress non-error output",
    )

    subparsers = parser.add_subparsers(
        dest="subcommand",
        title="Subcommands",
        description="Select an engine domain tool to execute",
        required=True,
    )

    # 1. Ingest Subcommand
    from engine.cli.ingest import register_ingest_parser
    register_ingest_parser(subparsers)

    # 2. Places Subcommand
    from engine.cli.places import register_places_parser
    register_places_parser(subparsers)

    # 3. Water Subcommand
    p_water = subparsers.add_parser(
        "water",
        help="Extract backcountry water access waypoints with 200m dedup & 5km throttling",
    )
    p_water.add_argument("--track", required=True, help="Path to route-track.json or GPX file")
    p_water.add_argument("--corridor-geojson", "--corridor", help="Path to corridor.geojson")
    p_water.add_argument("--output", "-o", default="water_access.json", help="Destination path for water_access.json")
    p_water.add_argument("--segment-km", type=float, default=5.0, help="Max 1 water point per N km segment (default: 5.0)")
    p_water.add_argument("--max-dist-m", type=float, default=250.0, help="Maximum distance to trail in meters (default: 250.0)")

    # 4. Climbs Subcommand
    p_climbs = subparsers.add_parser(
        "climbs",
        help="Detect and categorize mountain climbs (UCI Cat 1-4/HC) and passes",
    )
    p_climbs.add_argument("--track", required=True, help="Path to route-track.json or GPX file")
    p_climbs.add_argument("--output-climbs", default="climbs.json", help="Output path for climbs.json")
    p_climbs.add_argument("--output-passes", default="passes.json", help="Output path for passes.json")
    p_climbs.add_argument("--passes", help="Path to curated passes JSON file to preserve or merge")
    p_climbs.add_argument("--climbs", help="Path to curated climbs JSON file to preserve or merge")
    p_climbs.add_argument("--corridor-geojson", help="Optional corridor GeoJSON for pass matching")
    p_climbs.add_argument("--corridor-pmtiles", help="Optional corridor PMTiles archive for road network matching")
    p_climbs.add_argument("--state", default="", help="State/province code for landmark enrichment")

    # 5. Surfaces Subcommand
    p_surfaces = subparsers.add_parser(
        "surfaces",
        help="Model and merge contiguous surface intervals along the route",
    )
    p_surfaces.add_argument("--track", required=True, help="Path to route-track.json or GPX file")
    p_surfaces.add_argument("--output", "-o", default="surfaces.json", help="Output path for surfaces.json")
    p_surfaces.add_argument("--corridor-pmtiles", help="Optional corridor PMTiles for road classification")

    # 6. Tiles Subcommand
    p_tiles = subparsers.add_parser(
        "tiles",
        help="Build, extract, or slice PMTiles vector archive for corridor",
    )
    p_tiles.add_argument("--track", help="Path to route-track.json")
    p_tiles.add_argument("--corridor", help="Path to corridor.geojson")
    p_tiles.add_argument("--output", "-o", default="corridor.pmtiles", help="Output path for .pmtiles archive")
    p_tiles.add_argument("--source", help="Source PMTiles archive to extract from")
    p_tiles.add_argument("--minzoom", type=int, default=0, help="Minimum zoom level")
    p_tiles.add_argument("--maxzoom", type=int, default=14, help="Maximum zoom level")
    p_tiles.add_argument("--validate-only", action="store_true", help="Validate existing archive")
    p_tiles.add_argument("--slice", action="store_true", help="Slice multi-section route archives")

    # 7. Manifest Subcommand
    p_manifest = subparsers.add_parser(
        "manifest",
        help="Register or update route entry in public/data/routes.json",
    )
    p_manifest.add_argument("--routes-json", default="public/data/routes.json", help="Path to routes.json manifest")
    p_manifest.add_argument("--id", required=True, help="Unique route slug ID")
    p_manifest.add_argument("--name", required=True, help="Full Route Name")
    p_manifest.add_argument("--short-name", help="Short Route Name")
    p_manifest.add_argument("--badge", help="2-3 letter badge abbreviation")
    p_manifest.add_argument("--start-location", default="", help="Start Location")
    p_manifest.add_argument("--end-location", default="", help="End Location")
    p_manifest.add_argument("--stats", help="Path to .stats.json or route-track.json")
    p_manifest.add_argument("--description", default="", help="Route description")
    p_manifest.add_argument("--checkpoints", default="", help="Comma-separated iconic checkpoints")
    p_manifest.add_argument("--highest-point", default="", help="Highest point description")
    p_manifest.add_argument("--iconic-pass", default="", help="Iconic pass description")
    p_manifest.add_argument("--verify-files", action="store_true", help="Verify 6 required route dataset files")

    # 8. Info Subcommand
    p_info = subparsers.add_parser(
        "info",
        help="Inspect and display route telemetry, bounds, elevation profile, and static dataset health",
    )
    p_info.add_argument("target", nargs="?", default=None, help="Route ID slug or path to GPX / route-track.json")
    p_info.add_argument("--route-id", "--route", dest="route_id_flag", help="Route ID slug")
    p_info.add_argument("--json", action="store_true", help="Emit telemetry as JSON")

    return parser


# -----------------------------------------------------------------------------
# Subcommand Execution Handlers
# -----------------------------------------------------------------------------

def _load_track(track_path_str: str) -> Any:
    """Helper to parse a RouteTrack from JSON or GPX."""
    from engine.core.gpx import parse_gpx_track
    from engine.core.models import RouteTrack

    p = Path(track_path_str)
    if not p.exists():
        raise FileNotFoundError(f"Track file not found: {track_path_str}")
    if p.suffix.lower() == ".gpx":
        return parse_gpx_track(p)
    else:
        data = read_json(p)
        return RouteTrack.from_route_track_json(data)


def execute_water(args: argparse.Namespace) -> int:
    """Execute water access extraction."""
    from engine.enrichment.water import extract_water_access

    track = _load_track(args.track)
    corridor_data = {}
    if args.corridor_geojson and Path(args.corridor_geojson).exists():
        corridor_data = read_json(Path(args.corridor_geojson))

    water_points = extract_water_access(
        corridor_geojson_or_elements=corridor_data,
        track=track,
        max_distance_m=args.max_dist_m,
        segment_km=args.segment_km,
    )
    out_p = Path(args.output)
    atomic_write_json(out_p, [wp.to_dict() for wp in water_points])
    print(f"[Water] Extracted {len(water_points)} water waypoints to {out_p}")
    return 0


def execute_climbs(args: argparse.Namespace) -> int:
    """Execute climb and pass detection."""
    from engine.terrain.climbs import detect_climbs, load_curated_climbs
    from engine.terrain.passes import extract_mountain_passes, load_curated_passes

    track = _load_track(args.track)
    corridor_data = None
    if args.corridor_geojson and Path(args.corridor_geojson).exists():
        corridor_data = read_json(Path(args.corridor_geojson))

    network = None
    if getattr(args, "corridor_pmtiles", None) and Path(args.corridor_pmtiles).exists():
        try:
            from engine.osm.network import OsmRoadNetwork
            network = OsmRoadNetwork()
            network.load_from_pmtiles(
                pmtiles_path=Path(args.corridor_pmtiles),
                track_points=[(p.lat, p.lon) for p in track.points],
                threshold_m=50.0,
            )
        except Exception as exc:
            print(f"Warning: Could not load road network from {args.corridor_pmtiles}: {exc}")
            network = None

    curated_climbs = None
    if getattr(args, "climbs", None) and Path(args.climbs).exists():
        curated_climbs = load_curated_climbs(Path(args.climbs))

    curated = None
    if getattr(args, "passes", None) and Path(args.passes).exists():
        curated = load_curated_passes(Path(args.passes))

    climbs = detect_climbs(
        track,
        road_network=network,
        corridor_data=corridor_data,
        default_state=args.state,
        curated_climbs=curated_climbs,
    )
    passes = extract_mountain_passes(
        track_or_points=track,
        corridor_geojson=corridor_data,
        climbs=climbs,
        prominence_m=150.0,
        min_spacing_km=15.0,
        default_state=args.state,
        curated_passes=curated,
    )

    out_climbs = Path(args.output_climbs)
    out_passes = Path(args.output_passes)
    atomic_write_json(out_climbs, [c.to_dict() for c in climbs])
    atomic_write_json(out_passes, [p.to_dict() for p in passes])
    curated_tag = f" ({len(curated)} curated passes)" if curated else ""
    curated_climb_tag = f" ({len(curated_climbs)} curated climbs)" if curated_climbs else ""
    print(f"[Climbs] Extracted {len(climbs)} climbs to {out_climbs}{curated_climb_tag}")
    print(f"[Passes] Extracted {len(passes)} passes to {out_passes}{curated_tag}")
    return 0


def execute_surfaces(args: argparse.Namespace) -> int:
    """Execute surface classification."""
    from engine.terrain.surfaces import generate_route_surfaces

    track = _load_track(args.track)
    intervals = generate_route_surfaces(track)
    out_p = Path(args.output)
    atomic_write_json(out_p, [list(iv) for iv in intervals])
    print(f"[Surfaces] Classified {len(intervals)} surface intervals to {out_p}")
    return 0


def execute_tiles(args: argparse.Namespace) -> int:
    """Execute tile operations."""
    from engine.tiles.pmtiles import PMTilesArchive, PMTilesCorridorExtractor, PMTilesSectionSlicer

    out_p = Path(args.output)
    if args.validate_only:
        with PMTilesArchive(out_p) as archive:
            print(f"[Tiles] PMTiles archive {out_p} is valid (version {archive.header.version}).")
        return 0

    if args.slice:
        if not args.source or not args.track:
            print("[Tiles Error] --slice requires --source (master archive) and --track", file=sys.stderr)
            return 1
        source_p = Path(args.source)
        track_p = Path(args.track)
        if not source_p.exists():
            print(f"[Tiles Error] Source archive not found: {source_p}", file=sys.stderr)
            return 1
        if not track_p.exists():
            print(f"[Tiles Error] Track file not found: {track_p}", file=sys.stderr)
            return 1
        out_dir = out_p if (out_p.is_dir() or not out_p.suffix) else out_p.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        slicer = PMTilesSectionSlicer(source_p)
        slicer.slice_archive(track_p, out_dir)
        print(f"[Tiles] Sliced archive from {source_p} along {track_p} to {out_dir}")
        return 0

    if args.source:
        source_p = Path(args.source)
        if not source_p.exists():
            print(f"[Tiles Error] Source archive not found: {source_p}", file=sys.stderr)
            return 1
        corridor_p = Path(args.corridor) if args.corridor else None
        if not corridor_p or not corridor_p.exists():
            print(f"[Tiles Error] Corridor file required for clipping: {args.corridor}", file=sys.stderr)
            return 1
        extractor = PMTilesCorridorExtractor(source_p)
        extractor.extract_corridor(corridor_p, out_p, min_zoom=args.minzoom, max_zoom=args.maxzoom)
        print(f"[Tiles] Extracted corridor tiles from {args.source} to {out_p}")
        return 0

    print("[Tiles Error] Must specify --source, --slice, or --validate-only", file=sys.stderr)
    return 1


def execute_manifest(args: argparse.Namespace) -> int:
    """Execute manifest registration."""
    from engine.core.manifest import register_route

    ckpts = [c.strip() for c in args.checkpoints.split(",") if c.strip()] if args.checkpoints else None
    stats = None
    if args.stats:
        stats = Path(args.stats)

    register_route(
        routes_json_path=Path(args.routes_json),
        route_id=args.id,
        name=args.name,
        short_name=args.short_name,
        badge=args.badge,
        start_location=args.start_location,
        end_location=args.end_location,
        description=args.description,
        stats=stats,
        checkpoints=ckpts,
        highest_point=args.highest_point or None,
        iconic_pass=args.iconic_pass or None,
        verify_files=args.verify_files,
    )
    print(f"[Manifest] Successfully registered route '{args.id}' in {args.routes_json}")
    return 0


def execute_info(args: argparse.Namespace) -> int:
    """Inspect and display route info."""
    from engine.core.manifest import load_manifest, verify_route_data_files

    project_root = _resolve_project_root()
    target = args.target or args.route_id_flag
    if not target:
        print("Error: Specify a target route ID or file path for info.", file=sys.stderr)
        return 1

    p = Path(target)
    if p.exists():
        track = _load_track(str(p))
        stats = track.to_stats_json()
        if args.json:
            print(json.dumps(stats, indent=2))
        else:
            print(f"\nRoute Telemetry: {p.name}")
            print(f"Total Distance: {stats['total_km']:.1f} km ({stats['total_miles']:.1f} mi)")
            print(f"Elevation Gain: {stats['elevation_gain_m']} m ({stats['elevation_gain_ft']} ft)")
            print(f"Highest Point:  {stats['highest_elevation_m']} m ({stats['highest_elevation_ft']} ft)")
            print(f"Coordinates:    {len(track.points)} points")
            print(f"Bounding Box:   {stats['bounds']}")
        return 0

    # Route ID lookup in routes.json
    manifest_path = project_root / "public" / "data" / "routes.json"
    manifest = load_manifest(manifest_path, default_if_missing=True)
    entry = manifest.get_route(target)
    if not entry:
        print(f"Route '{target}' not found in manifest ({manifest_path}).", file=sys.stderr)
        return 1

    route_dir = project_root / "public" / "data" / "routes" / target
    v_result = verify_route_data_files(route_dir, route_id=target)

    info_data = {
        "manifest": entry.to_dict(),
        "datasets": {
            "is_complete": v_result.is_complete,
            "existing": v_result.existing_files,
            "missing_required": v_result.missing_required,
            "missing_optional": v_result.missing_optional,
        }
    }

    if args.json:
        print(json.dumps(info_data, indent=2))
    else:
        print(f"\nRoute: {entry.name} ({entry.badge})")
        print(f"ID:           {entry.id}")
        print(f"Termini:      {entry.start_location} -> {entry.end_location}")
        print(f"Distance:     {entry.total_distance_km:.1f} km ({entry.total_distance_miles:.1f} mi)")
        print(f"Elevation:    +{entry.elevation_gain_m} m (Peak: {entry.highest_elevation_m} m)")
        print(f"Datasets:     {'COMPLETE' if v_result.is_complete else 'INCOMPLETE'}")
        if v_result.missing_required:
            print(f"Missing:      {', '.join(v_result.missing_required)}")

    return 0


# -----------------------------------------------------------------------------
# Main Entrypoint
# -----------------------------------------------------------------------------

def main(argv: Optional[Sequence[str]] = None) -> int:
    """Main CLI entrypoint."""
    parser = build_parser()
    args = parser.parse_args(argv)

    # Configure logging
    if getattr(args, "verbose", False):
        logging.basicConfig(level=logging.DEBUG, format="[%(levelname)s] %(message)s")
    elif getattr(args, "quiet", False):
        logging.basicConfig(level=logging.WARNING, format="[%(levelname)s] %(message)s")
    else:
        logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")

    subcmd = args.subcommand
    try:
        if subcmd == "ingest":
            from engine.cli.ingest import main as ingest_main
            # Forward the arguments after 'ingest'
            if argv is not None:
                sub_args = list(argv)
                if "ingest" in sub_args:
                    sub_args = sub_args[sub_args.index("ingest") + 1:]
                return ingest_main(sub_args)
            else:
                sub_args = sys.argv[1:]
                if "ingest" in sub_args:
                    sub_args = sub_args[sub_args.index("ingest") + 1:]
                return ingest_main(sub_args)

        elif subcmd == "places":
            from engine.cli.places import run_places
            return run_places(args)

        elif subcmd == "water":
            return execute_water(args)

        elif subcmd == "climbs":
            return execute_climbs(args)

        elif subcmd == "surfaces":
            return execute_surfaces(args)

        elif subcmd == "tiles":
            return execute_tiles(args)

        elif subcmd == "manifest":
            return execute_manifest(args)

        elif subcmd == "info":
            return execute_info(args)

        else:
            parser.print_help()
            return 2

    except Exception as exc:
        logger.error(f"Execution error in subcommand '{subcmd}': {exc}", exc_info=True)
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

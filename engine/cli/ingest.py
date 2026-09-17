"""
engine.cli.ingest - Master in-process route ingestion pipeline orchestrator.

Executes all 10 domain stages in sequence entirely in-process:
1. GPX Parsing & 3D Densification (engine.core.gpx)
2. OSM Corridor Polygon Generation (engine.osm.corridor)
3. Road / Trail Centerline Snapping (engine.osm.snapping)
4. Navigation Turn Guidance Cues (engine.osm.turns)
5. Surface Interval Modeling (engine.terrain.surfaces)
6. Climbs & Mountain Passes Detection (engine.terrain.climbs, passes)
7. Backcountry Water Access Extraction (engine.enrichment.water)
8. Google Places POI Extraction & Merging (engine.enrichment.places)
9. Navigation Milestones & Resupply Jump Targets (engine.enrichment.milestones)
10. Central Route Manifest Registration (engine.core.manifest)

Emits standardized datasets to public/data/routes/<route-id>/ and updates routes.json.
"""

import argparse
from dataclasses import dataclass, field
import json
import logging
import os
from pathlib import Path
import shutil
import sys
import time
from typing import Any, Dict, List, Optional, Sequence, Union

from engine.core.gpx import parse_gpx_track
from engine.core.manifest import register_route
from engine.core.models import EmptyTrackError, GPXError, RouteTrack
from engine.enrichment.cache import APICache
from engine.enrichment.milestones import generate_route_milestones
from engine.enrichment.places import (
    Place,
    fetch_places_along_route,
)
from engine.enrichment.water import extract_water_access
from engine.osm.corridor import generate_corridor_polygon
from engine.osm.network import OsmRoadNetwork
from engine.osm.snapping import SnappingConfig, snap_track_to_osm
from engine.osm.turns import extract_turn_cues, extract_turns_from_pmtiles, save_turns_json
from engine.terrain.climbs import detect_climbs, is_curated_climb_list, load_curated_climbs
from engine.terrain.passes import extract_mountain_passes, is_curated_pass_list, load_curated_passes
from engine.terrain.surfaces import generate_route_surfaces
from engine.utils.io import atomic_write_json, atomic_write_text, ensure_directory, read_json
from engine.utils.text import slugify

logger = logging.getLogger(__name__)


def _resolve_project_root() -> Path:
    return Path(__file__).resolve().parents[2]


@dataclass
class IngestConfig:
    """Configuration options for the route ingestion pipeline."""
    gpx_path: Path
    route_id: Optional[str] = None
    name: Optional[str] = None
    short_name: Optional[str] = None
    badge: Optional[str] = None
    start_location: str = "Start Trailhead"
    end_location: str = "Finish Terminus"
    description: str = ""
    output_dir: Optional[Path] = None
    routes_json: Path = field(default_factory=lambda: _resolve_project_root() / "public" / "data" / "routes.json")

    # Telemetry and corridor tuning
    densify_step_m: float = 100.0
    snap_dist_m: float = 50.0
    search_radius_m: float = 10000.0
    corridor_buffer_km: float = 18.0
    water_segment_km: float = 5.0
    max_water_dist_m: float = 250.0

    # Auxiliary inputs
    corridor_pmtiles: Optional[Path] = None
    corridor_pbf: Optional[Path] = None
    water_file: Optional[Path] = None
    towns_file: Optional[Path] = None
    waypoints_file: Optional[Path] = None
    passes_file: Optional[Path] = None
    climbs_file: Optional[Path] = None
    api_key: Optional[str] = None

    # Control flags
    skip_places: bool = False
    mock_places: bool = False
    skip_osm: bool = False
    find_water_access: bool = True
    no_manifest: bool = False
    force: bool = False


@dataclass
class StageTiming:
    """Timing and status report for an individual pipeline stage."""
    stage_name: str
    duration_s: float
    success: bool
    details: str = ""


@dataclass
class IngestResult:
    """Structured report returned upon pipeline execution."""
    route_id: str
    success: bool
    output_dir: Path
    total_duration_s: float
    total_km: float = 0.0
    total_miles: float = 0.0
    elevation_gain_m: float = 0.0
    datasets_created: List[str] = field(default_factory=list)
    stages: List[StageTiming] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    error: Optional[str] = None


class IngestArgumentParser(argparse.ArgumentParser):
    """Custom argument parser enforcing required GPX input across positional and flags."""
    def parse_args(self, args=None, namespace=None):
        ns = super().parse_args(args, namespace)
        if not getattr(ns, "gpx", None) and not getattr(ns, "gpx_pos", None):
            self.error("the following arguments are required: --gpx")
        return ns


def register_ingest_parser(subparsers: Any) -> argparse.ArgumentParser:
    """Register 'ingest' subcommand on the top-level CLI parser."""
    parser = subparsers.add_parser(
        "ingest",
        help="Run master in-process route ingestion pipeline",
        description="Transform a raw GPX track into complete Bikepack Navigator route datasets.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    _add_ingest_arguments(parser)
    return parser


def _add_ingest_arguments(parser: argparse.ArgumentParser) -> None:
    """Add CLI arguments for ingestion pipeline."""
    req_group = parser.add_argument_group("Route Input & Identification")
    req_group.add_argument("gpx_pos", nargs="?", help="Path to input GPX route file (positional)")
    req_group.add_argument("--gpx", help="Path to input GPX route file")
    req_group.add_argument("--id", help="Route slug ID (default: inferred from GPX filename)")
    req_group.add_argument("--name", help="Full Route Name (e.g. 'The Colorado Trail')")
    req_group.add_argument("--short-name", help="Short Route Name (e.g. 'Colorado Trail')")
    req_group.add_argument("--badge", help="2-3 letter badge abbreviation (e.g. 'CT')")
    req_group.add_argument("--start-location", default="Start Trailhead", help="Starting location / trailhead")
    req_group.add_argument("--end-location", default="Finish Terminus", help="Ending location / terminus")
    req_group.add_argument("--description", default="", help="Route summary narrative")

    paths_group = parser.add_argument_group("Output Paths & Manifest")
    paths_group.add_argument("--output-dir", "-o", help="Target output directory for route datasets")
    paths_group.add_argument("--routes-json", help="Path to public/data/routes.json manifest")
    paths_group.add_argument("--no-manifest", action="store_true", help="Skip updating routes.json manifest")

    tune_group = parser.add_argument_group("Pipeline Tuning Parameters")
    tune_group.add_argument("--densify-step", type=float, default=100.0, help="GPX densification step in meters (default: 100.0)")
    tune_group.add_argument("--snap-dist", type=float, default=50.0, help="Road snapping max distance threshold (default: 50.0m)")
    tune_group.add_argument("--search-radius", type=float, default=10000.0, help="Places API search radius (default: 10000m)")
    tune_group.add_argument("--corridor-buffer-km", type=float, default=18.0, help="Corridor buffer width in km (default: 18.0)")
    tune_group.add_argument("--segment-km", type=float, default=5.0, help="Water access throttling interval (default: 5.0km)")
    tune_group.add_argument("--max-water-dist-m", type=float, default=250.0, help="Max water offset from trail (default: 250.0m)")

    aux_group = parser.add_argument_group("Auxiliary Datasets & Vector Tiles")
    aux_group.add_argument("--corridor-pmtiles", help="Path to corridor.pmtiles archive for road snapping")
    aux_group.add_argument("--corridor-pbf", help="Path to corridor OSM PBF extract")
    aux_group.add_argument("--water", help="Path to external water waypoints JSON file")
    aux_group.add_argument("--towns", help="Path to towns JSON file")
    aux_group.add_argument("--waypoints", help="Path to custom waypoints JSON file")
    aux_group.add_argument("--passes", help="Path to curated mountain passes JSON file")
    aux_group.add_argument("--climbs", help="Path to curated climbs JSON file")

    flags_group = parser.add_argument_group("Flags & Offline Controls")
    flags_group.add_argument("--api-key", help="Google Places API key")
    flags_group.add_argument("--skip-places", action="store_true", help="Skip Google Places POI queries")
    flags_group.add_argument("--mock-places", action="store_true", help="Use offline simulated mock POIs")
    flags_group.add_argument("--skip-osm", action="store_true", help="Skip online Overpass OSM queries")
    flags_group.add_argument("--find-water-access", action="store_true", default=True, help="Extract water access from corridor OSM")
    flags_group.add_argument("--force", action="store_true", help="Overwrite existing dataset files")


def build_ingest_parser() -> argparse.ArgumentParser:
    """Build standalone argument parser for engine.cli.ingest."""
    parser = IngestArgumentParser(
        prog="python3 -m engine.cli.ingest",
        description="Bikepack Navigator Master Route Ingestion Pipeline Orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    _add_ingest_arguments(parser)
    return parser


def build_ingest_config(args: argparse.Namespace) -> IngestConfig:
    """Convert parsed CLI arguments into IngestConfig."""
    gpx_str = args.gpx or args.gpx_pos
    if not gpx_str:
        raise ValueError("Input GPX path must be provided via positional argument or --gpx")

    gpx_p = Path(gpx_str)

    routes_json_p = Path(args.routes_json) if args.routes_json else (_resolve_project_root() / "public" / "data" / "routes.json")
    out_dir_p = Path(args.output_dir) if args.output_dir else None

    corridor_pmtiles_p = Path(args.corridor_pmtiles) if args.corridor_pmtiles else None
    corridor_pbf_p = Path(args.corridor_pbf) if args.corridor_pbf else None
    water_p = Path(args.water) if args.water else None
    towns_p = Path(args.towns) if args.towns else None
    waypoints_p = Path(args.waypoints) if args.waypoints else None
    passes_p = Path(args.passes) if getattr(args, "passes", None) else None
    climbs_p = Path(args.climbs) if getattr(args, "climbs", None) else None

    api_k = (
        args.api_key
        or os.getenv("GOOGLE_CLOUD_API_KEY")
        or os.getenv("GOOGLE_PLACES_API_KEY")
        or os.getenv("GOOGLE_MAPS_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
    )

    mock_p = bool(
        args.mock_places
        or os.getenv("PLACES_MOCK") in ("1", "true", "True")
        or (not api_k and not args.skip_places)
    )

    return IngestConfig(
        gpx_path=gpx_p,
        route_id=args.id,
        name=args.name,
        short_name=args.short_name,
        badge=args.badge,
        start_location=args.start_location,
        end_location=args.end_location,
        description=args.description,
        output_dir=out_dir_p,
        routes_json=routes_json_p,
        densify_step_m=args.densify_step,
        snap_dist_m=args.snap_dist,
        search_radius_m=args.search_radius,
        corridor_buffer_km=args.corridor_buffer_km,
        water_segment_km=args.segment_km,
        max_water_dist_m=args.max_water_dist_m,
        corridor_pmtiles=corridor_pmtiles_p,
        corridor_pbf=corridor_pbf_p,
        water_file=water_p,
        towns_file=towns_p,
        waypoints_file=waypoints_p,
        passes_file=passes_p,
        climbs_file=climbs_p,
        api_key=api_k,
        skip_places=args.skip_places,
        mock_places=mock_p,
        skip_osm=args.skip_osm,
        find_water_access=args.find_water_access,
        no_manifest=args.no_manifest,
        force=args.force,
    )


def run_ingest(config: IngestConfig) -> IngestResult:
    """
    Execute the master route ingestion pipeline in-process.
    """
    pipeline_t0 = time.time()
    stages: List[StageTiming] = []
    warnings: List[str] = []
    datasets_created: List[str] = []

    # Verify input GPX file exists
    if not config.gpx_path.exists():
        err_msg = f"GPX file not found: {config.gpx_path}"
        logger.error(err_msg)
        return IngestResult(
            route_id=config.route_id or "unknown",
            success=False,
            output_dir=config.output_dir or Path("."),
            total_duration_s=0.0,
            error=err_msg,
        )

    # 1. Infer metadata
    raw_stem = config.gpx_path.stem
    route_id = slugify(config.route_id or raw_stem, sep="-")
    name = config.name or raw_stem.replace("-", " ").replace("_", " ").title()
    short_name = config.short_name or name

    if config.badge:
        badge = config.badge
    else:
        words = [w for w in short_name.replace("-", " ").split() if w]
        badge = "".join(w[0].upper() for w in words)[:3]
        if not badge:
            badge = "RT"

    # Resolve output directory
    project_root = _resolve_project_root()
    if config.output_dir:
        # If output_dir already has route_id as its leaf, use it directly; else subfolder
        if config.output_dir.name == route_id:
            target_dir = config.output_dir
        else:
            target_dir = config.output_dir / route_id
    else:
        target_dir = project_root / "public" / "data" / "routes" / route_id

    ensure_directory(target_dir)

    print(f"\n================================================================================")
    print(f"Bikepack Navigator Master Ingestion: {name} [{badge}]")
    print(f"Target Directory: {target_dir}")
    print(f"================================================================================\n")

    # -------------------------------------------------------------------------
    # Stage 1: GPX Parsing & Densification
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    try:
        track = parse_gpx_track(config.gpx_path, densify_step_m=config.densify_step_m)
    except Exception as exc:
        err_msg = f"Failed to parse GPX: {exc}"
        logger.error(err_msg)
        stages.append(StageTiming("gpx_parsing", time.time() - s_t0, False, err_msg))
        return IngestResult(
            route_id=route_id,
            success=False,
            output_dir=target_dir,
            total_duration_s=time.time() - pipeline_t0,
            stages=stages,
            error=err_msg,
        )

    if not track.points:
        err_msg = "GPX track contains 0 track points."
        logger.error(err_msg)
        stages.append(StageTiming("gpx_parsing", time.time() - s_t0, False, err_msg))
        return IngestResult(
            route_id=route_id,
            success=False,
            output_dir=target_dir,
            total_duration_s=time.time() - pipeline_t0,
            stages=stages,
            error=err_msg,
        )

    # Write route-track.json and .stats.json
    track_json = track.to_route_track_json()
    atomic_write_json(target_dir / "route-track.json", track_json)
    datasets_created.append("route-track.json")

    stats_json = track.to_stats_json()
    atomic_write_json(target_dir / ".stats.json", stats_json)
    datasets_created.append(".stats.json")

    # Copy route.gpx
    try:
        shutil.copyfile(config.gpx_path, target_dir / "route.gpx")
        datasets_created.append("route.gpx")
    except Exception as e:
        warnings.append(f"Could not copy raw GPX to output dir: {e}")

    # Write route.geojson
    geojson_feature = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "id": route_id,
                    "name": name,
                    "total_km": track.total_distance_km,
                    "elevation_gain_m": track.elevation_gain_m,
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[p.lon, p.lat, p.ele] for p in track.points],
                },
            }
        ],
    }
    atomic_write_json(target_dir / "route.geojson", geojson_feature)
    datasets_created.append("route.geojson")

    s_dur = time.time() - s_t0
    stages.append(StageTiming("gpx_parsing", s_dur, True, f"{len(track.points)} points, {track.total_distance_km:.1f}km"))
    print(f"[Stage 1/10] GPX parsed: {len(track.points)} points, {track.total_distance_km:.1f}km (+{track.elevation_gain_m}m) ({s_dur:.2f}s)")

    # -------------------------------------------------------------------------
    # Stage 2: OSM Corridor Polygon
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    try:
        corridor_poly = generate_corridor_polygon(track, corridor_m=config.corridor_buffer_km * 1000.0)
        atomic_write_json(target_dir / "corridor.geojson", corridor_poly)
        datasets_created.append("corridor.geojson")
        s_dur = time.time() - s_t0
        stages.append(StageTiming("corridor_polygon", s_dur, True, f"{config.corridor_buffer_km}km buffer"))
        print(f"[Stage 2/10] Corridor polygon generated ({config.corridor_buffer_km}km buffer) ({s_dur:.2f}s)")
    except Exception as exc:
        corridor_poly = None
        s_dur = time.time() - s_t0
        warnings.append(f"Corridor polygon generation failed: {exc}")
        stages.append(StageTiming("corridor_polygon", s_dur, False, str(exc)))
        print(f"[Stage 2/10] Warning: Corridor polygon generation failed: {exc} ({s_dur:.2f}s)")

    # -------------------------------------------------------------------------
    # Stage 3: Road Snapping & Guidance Line
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    pmtiles_paths: List[Path] = []
    if config.corridor_pmtiles:
        p_target = config.corridor_pmtiles
        if p_target.is_dir():
            pmtiles_paths.extend(sorted(p_target.glob("*.pmtiles")))
        elif p_target.exists():
            pmtiles_paths.append(p_target)
    elif (target_dir / "corridor.pmtiles").exists():
        pmtiles_paths.append(target_dir / "corridor.pmtiles")
    else:
        sections = sorted(target_dir.glob("section-*.pmtiles"))
        if sections:
            pmtiles_paths.extend(sections)

    network: Optional[OsmRoadNetwork] = None
    if pmtiles_paths:
        try:
            network = OsmRoadNetwork()
            network.load_from_pmtiles(pmtiles_path=pmtiles_paths, track_points=[(p.lat, p.lon) for p in track.points], threshold_m=config.snap_dist_m)
        except Exception as exc:
            logger.warning(f"Could not load road network from PMTiles: {exc}")
            network = None

    guidance: Optional[Any] = None
    if network is not None or pmtiles_paths:
        try:
            cfg = SnappingConfig(threshold_m=config.snap_dist_m)
            guidance = snap_track_to_osm(track, network or pmtiles_paths, config=cfg)
            atomic_write_json(target_dir / "guidance-track.json", guidance.to_dict())
            datasets_created.append("guidance-track.json")
            s_dur = time.time() - s_t0
            stages.append(StageTiming("road_snapping", s_dur, True, f"{len(guidance.points)} snapped points"))
            print(f"[Stage 3/10] OSM road snapping complete ({len(guidance.points)} points) ({s_dur:.2f}s)")
        except Exception as exc:
            s_dur = time.time() - s_t0
            warnings.append(f"Road snapping failed: {exc}")
            stages.append(StageTiming("road_snapping", s_dur, False, str(exc)))
            print(f"[Stage 3/10] Warning: Road snapping failed: {exc} ({s_dur:.2f}s)")
    else:
        s_dur = time.time() - s_t0
        stages.append(StageTiming("road_snapping", s_dur, True, "Skipped (no corridor PMTiles found)"))
        print(f"[Stage 3/10] Road snapping skipped (no corridor PMTiles found) ({s_dur:.2f}s)")

    # -------------------------------------------------------------------------
    # Stage 4: Turn Guidance Cues
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    try:
        if network is not None:
            turns = extract_turn_cues(track, network=network)
        elif pmtiles_paths:
            turns = extract_turns_from_pmtiles(track, pmtiles_paths[0])
        else:
            turns = extract_turn_cues(track, network=None)

        save_turns_json(turns, target_dir / "turns.json")
        datasets_created.append("turns.json")
        s_dur = time.time() - s_t0
        stages.append(StageTiming("turn_cues", s_dur, True, f"{len(turns)} turn cues"))
        print(f"[Stage 4/10] Turn cues generated ({len(turns)} cues) ({s_dur:.2f}s)")
    except Exception as exc:
        s_dur = time.time() - s_t0
        warnings.append(f"Turn cue generation failed: {exc}")
        stages.append(StageTiming("turn_cues", s_dur, False, str(exc)))
        print(f"[Stage 4/10] Warning: Turn cues failed: {exc} ({s_dur:.2f}s)")

    # -------------------------------------------------------------------------
    # Stage 5: Surfaces
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    try:
        intervals = generate_route_surfaces(track, road_network_or_geojson=network, guidance=guidance)
        atomic_write_json(target_dir / "surfaces.json", [list(iv) for iv in intervals])
        datasets_created.append("surfaces.json")
        s_dur = time.time() - s_t0
        stages.append(StageTiming("surfaces", s_dur, True, f"{len(intervals)} intervals"))
        mode_str = "Viterbi road network" if guidance and getattr(guidance, "matched_candidates", None) else "spatial query"
        print(f"[Stage 5/10] Surface intervals modeled from {mode_str} ({len(intervals)} intervals) ({s_dur:.2f}s)")
    except Exception as exc:
        s_dur = time.time() - s_t0
        err_msg = f"Surface modeling failed: {exc}"
        stages.append(StageTiming("surfaces", s_dur, False, err_msg))
        logger.error(err_msg)
        return IngestResult(
            route_id=route_id,
            success=False,
            output_dir=target_dir,
            total_duration_s=time.time() - pipeline_t0,
            stages=stages,
            error=err_msg,
        )

    # -------------------------------------------------------------------------
    # Stage 6: Climbs & Mountain Passes
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    try:
        # Check for curated climbs in config or existing target_dir / "climbs.json"
        curated_climbs = None
        if config.climbs_file and config.climbs_file.exists():
            curated_climbs = load_curated_climbs(config.climbs_file)
            logger.info(f"Loaded {len(curated_climbs)} curated climbs from {config.climbs_file}")
        elif (target_dir / "climbs.json").exists():
            existing_c = load_curated_climbs(target_dir / "climbs.json")
            if is_curated_climb_list(existing_c):
                curated_climbs = existing_c
                logger.info(f"Mapping previous climb research from {target_dir / 'climbs.json'}")

        climbs = detect_climbs(
            track,
            road_network=network,
            corridor_data=corridor_poly,
            curated_climbs=curated_climbs,
        )

        # Check for curated passes in config or existing target_dir / "passes.json"
        curated = None
        if config.passes_file and config.passes_file.exists():
            curated = load_curated_passes(config.passes_file)
            logger.info(f"Loaded {len(curated)} curated passes from {config.passes_file}")
        elif (target_dir / "passes.json").exists():
            existing = load_curated_passes(target_dir / "passes.json")
            if is_curated_pass_list(existing):
                curated = existing
                logger.info(f"Preserving {len(curated)} curated passes from {target_dir / 'passes.json'}")

        passes = extract_mountain_passes(
            track,
            corridor_geojson=corridor_poly,
            climbs=climbs,
            prominence_m=150.0,
            min_spacing_km=15.0,
            curated_passes=curated,
        )

        atomic_write_json(target_dir / "climbs.json", [c.to_dict() for c in climbs])
        datasets_created.append("climbs.json")

        atomic_write_json(target_dir / "passes.json", [p.to_dict() for p in passes])
        datasets_created.append("passes.json")

        s_dur = time.time() - s_t0
        curated_tag = ""
        if curated_climbs and curated:
            curated_tag = " (curated climbs & passes)"
        elif curated_climbs:
            curated_tag = " (curated climbs)"
        elif curated:
            curated_tag = " (curated passes)"
        stages.append(StageTiming("climbs_passes", s_dur, True, f"{len(climbs)} climbs, {len(passes)} passes{curated_tag}"))
        print(f"[Stage 6/10] Climbs & Passes detected ({len(climbs)} climbs, {len(passes)} passes{curated_tag}) ({s_dur:.2f}s)")
    except Exception as exc:
        s_dur = time.time() - s_t0
        err_msg = f"Climb/pass extraction failed: {exc}"
        stages.append(StageTiming("climbs_passes", s_dur, False, err_msg))
        logger.error(err_msg)
        return IngestResult(
            route_id=route_id,
            success=False,
            output_dir=target_dir,
            total_duration_s=time.time() - pipeline_t0,
            stages=stages,
            error=err_msg,
        )

    # -------------------------------------------------------------------------
    # Stage 7: Backcountry Water Access
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    water_points = []
    if config.find_water_access:
        try:
            water_points = extract_water_access(
                corridor_poly or {},
                track,
                segment_km=config.water_segment_km,
                max_distance_m=config.max_water_dist_m,
            )
            atomic_write_json(target_dir / "water_access.json", [w.to_dict() for w in water_points])
            datasets_created.append("water_access.json")
            s_dur = time.time() - s_t0
            stages.append(StageTiming("water_access", s_dur, True, f"{len(water_points)} water waypoints"))
            print(f"[Stage 7/10] Water access extracted ({len(water_points)} waypoints) ({s_dur:.2f}s)")
        except Exception as exc:
            s_dur = time.time() - s_t0
            warnings.append(f"Water extraction failed: {exc}")
            stages.append(StageTiming("water_access", s_dur, False, str(exc)))
            print(f"[Stage 7/10] Warning: Water extraction failed: {exc} ({s_dur:.2f}s)")
    else:
        s_dur = time.time() - s_t0
        stages.append(StageTiming("water_access", s_dur, True, "Skipped"))
        print(f"[Stage 7/10] Water access extraction skipped ({s_dur:.2f}s)")

    # -------------------------------------------------------------------------
    # Stage 8: Google Places POIs
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    towns = None
    if config.towns_file and config.towns_file.exists():
        towns = read_json(config.towns_file)
    elif (target_dir / "towns.json").exists():
        towns = read_json(target_dir / "towns.json")

    water_sources = read_json(config.water_file) if config.water_file and config.water_file.exists() else []
    if not isinstance(water_sources, list):
        water_sources = []

    # Merge extracted river/lake water points from Stage 7
    for wp in water_points:
        water_sources.append(wp.to_dict())

    if config.waypoints_file and config.waypoints_file.exists():
        custom_wpts = read_json(config.waypoints_file)
        if isinstance(custom_wpts, list):
            water_sources.extend(custom_wpts)

    places: List[Place] = []
    if config.skip_places:
        if (target_dir / "places.json").exists() and (target_dir / "places.json").stat().st_size > 1000:
            try:
                raw_existing = read_json(target_dir / "places.json", default=[])
                if isinstance(raw_existing, list) and len(raw_existing) > len(water_sources):
                    places = [Place.from_dict(p) for p in raw_existing]
                    logger.info(f"Preserving {len(places)} existing POIs from {target_dir / 'places.json'}")
            except Exception:
                places = []

        if places and water_sources:
            existing_ids = {p.id for p in places}
            added = 0
            for ws in water_sources:
                if ws.get("id") and ws.get("id") not in existing_ids:
                    places.append(Place.from_dict(ws))
                    existing_ids.add(ws["id"])
                    added += 1
            if added:
                places.sort(key=lambda p: p.route_mile)

        if not places:
            # Wrap water sources as Places directly
            if water_sources:
                places = fetch_places_along_route(
                    track=track,
                    api_key=config.api_key,
                    towns=towns,
                    water_sources=water_sources,
                    search_radius_m=config.search_radius_m,
                    mock_mode=True,
                )
                # Retain only water items
                places = [p for p in places if p.category == "water"]

        atomic_write_json(target_dir / "places.json", [p.to_dict() for p in places])
        datasets_created.append("places.json")
        s_dur = time.time() - s_t0
        stages.append(StageTiming("places", s_dur, True, f"Preserved/Skipped API ({len(places)} POIs written)"))
        print(f"[Stage 8/10] Places API skipped ({len(places)} POIs written) ({s_dur:.2f}s)")
    else:
        try:
            places = fetch_places_along_route(
                track=track,
                api_key=config.api_key,
                towns=towns,
                water_sources=water_sources,
                search_radius_m=config.search_radius_m,
                mock_mode=config.mock_places,
            )

            atomic_write_json(target_dir / "places.json", [p.to_dict() for p in places])
            datasets_created.append("places.json")
            s_dur = time.time() - s_t0
            stages.append(StageTiming("places", s_dur, True, f"{len(places)} POIs written"))
            print(f"[Stage 8/10] Places populated ({len(places)} POIs) ({s_dur:.2f}s)")
        except Exception as exc:
            s_dur = time.time() - s_t0
            err_msg = f"Places enrichment failed: {exc}"
            stages.append(StageTiming("places", s_dur, False, err_msg))
            logger.error(err_msg)
            return IngestResult(
                route_id=route_id,
                success=False,
                output_dir=target_dir,
                total_duration_s=time.time() - pipeline_t0,
                stages=stages,
                error=err_msg,
            )

    # -------------------------------------------------------------------------
    # Stage 9: Navigation Milestones
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    try:
        milestones = generate_route_milestones(
            track=track,
            towns=towns,
            passes=passes,
            start_name=config.start_location,
            end_name=config.end_location,
        )
        atomic_write_json(target_dir / "milestones.json", [m.to_milestone_json() for m in milestones])
        datasets_created.append("milestones.json")
        s_dur = time.time() - s_t0
        stages.append(StageTiming("milestones", s_dur, True, f"{len(milestones)} milestones"))
        print(f"[Stage 9/10] Milestones generated ({len(milestones)} checkpoints) ({s_dur:.2f}s)")
    except Exception as exc:
        s_dur = time.time() - s_t0
        err_msg = f"Milestone generation failed: {exc}"
        stages.append(StageTiming("milestones", s_dur, False, err_msg))
        logger.error(err_msg)
        return IngestResult(
            route_id=route_id,
            success=False,
            output_dir=target_dir,
            total_duration_s=time.time() - pipeline_t0,
            stages=stages,
            error=err_msg,
        )

    # -------------------------------------------------------------------------
    # Stage 10: Central Manifest Registration
    # -------------------------------------------------------------------------
    s_t0 = time.time()
    if not config.no_manifest:
        try:
            # Build list of iconic checkpoints from passes and towns
            iconic_pass_names = [
                p.name for p in passes
                if getattr(p, "is_iconic", False) or getattr(p, "is_high_point", False) or getattr(p, "difficulty", "") in ("difficult", "extreme")
            ]
            real_milestones = [
                m.name for m in milestones
                if m.name not in (config.start_location, config.end_location)
                and not m.name.startswith("Checkpoint Km")
            ]
            if iconic_pass_names:
                ckpt_names = iconic_pass_names[:12]
            elif real_milestones:
                ckpt_names = real_milestones[:10]
            else:
                ckpt_names = [m.name for m in milestones if m.name not in (config.start_location, config.end_location)][:5]
            highest_pt = ""
            for p in passes:
                if p.is_high_point:
                    highest_pt = p.name
                    break

            register_route(
                routes_json_path=config.routes_json,
                route_id=route_id,
                name=name,
                short_name=short_name,
                badge=badge,
                start_location=config.start_location,
                end_location=config.end_location,
                description=config.description,
                track=track,
                stats=stats_json,
                checkpoints=ckpt_names,
                highest_point=highest_pt or None,
                verify_files=False,
            )
            s_dur = time.time() - s_t0
            stages.append(StageTiming("manifest_registration", s_dur, True, f"Registered {route_id} in {config.routes_json.name}"))
            print(f"[Stage 10/10] Route registered in manifest: {config.routes_json} ({s_dur:.2f}s)")
        except Exception as exc:
            s_dur = time.time() - s_t0
            warnings.append(f"Manifest registration failed: {exc}")
            stages.append(StageTiming("manifest_registration", s_dur, False, str(exc)))
            print(f"[Stage 10/10] Warning: Manifest registration failed: {exc} ({s_dur:.2f}s)")
    else:
        s_dur = time.time() - s_t0
        stages.append(StageTiming("manifest_registration", s_dur, True, "Skipped (--no-manifest)"))
        print(f"[Stage 10/10] Manifest registration skipped (--no-manifest) ({s_dur:.2f}s)")

    total_duration = time.time() - pipeline_t0
    print(f"\n================================================================================")
    print(f"Ingestion Succeeded in {total_duration:.2f}s! ({len(datasets_created)} datasets written)")
    print(f"================================================================================\n")

    return IngestResult(
        route_id=route_id,
        success=True,
        output_dir=target_dir,
        total_duration_s=total_duration,
        total_km=track.total_distance_km,
        total_miles=track.total_distance_miles,
        elevation_gain_m=track.elevation_gain_m,
        datasets_created=datasets_created,
        stages=stages,
        warnings=warnings,
    )


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Main CLI entrypoint for master ingestion."""
    parser = build_ingest_parser()
    args = parser.parse_args(argv)

    try:
        config = build_ingest_config(args)
    except ValueError as val_err:
        print(f"Argument Error: {val_err}", file=sys.stderr)
        return 2

    try:
        result = run_ingest(config)
        if result.success:
            return 0
        else:
            print(f"Ingest Error: {result.error}", file=sys.stderr)
            return 1
    except Exception as exc:
        logger.error(f"Ingest execution crashed: {exc}", exc_info=True)
        print(f"Ingest Crash: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

"""
engine.cli.places - Interactive and batch Google Places POI CLI.

Supports:
1. Interactive search around coordinates (lat/lon, point, mile, km) along routes.
2. Batch POI extraction and track projection for route ingestion with caching.
3. Offline zero-cost mock mode (--mock or PLACES_MOCK=1).
4. Exporting to JSON and GPX waypoints.
"""

import argparse
import logging
import math
import os
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
import xml.etree.ElementTree as ET

from engine.core.gpx import parse_gpx_track
from engine.core.models import RoutePoint, RouteTrack
from engine.enrichment.cache import APICache, DEFAULT_CACHE_ROOT
from engine.enrichment.places import (
    FRONTEND_CATEGORY_MAP,
    PLACES_TYPE_TO_CATEGORY,
    GooglePlacesClient,
    MockPlacesClient,
    Place,
    PlaceLocation,
    fetch_places_along_route,
)
from engine.utils.geo import haversine_distance, haversine_distance_m
from engine.utils.io import atomic_write_json, read_json
from engine.utils.spatial import TrackIndex
from engine.utils.units import km_to_miles, miles_to_km

logger = logging.getLogger(__name__)

# Canonical categories
ALL_CATEGORIES = [
    "bike_shop",
    "hotel",
    "campground",
    "grocery",
    "food",
    "gas_station",
    "pharmacy",
    "laundry",
    "water",
    "town",
]

CATEGORY_TO_PLACES_TYPES: Dict[str, List[str]] = {
    "bike_shop": ["bicycle_store", "bicycle_repair_service", "bike_shop"],
    "hotel": ["lodging", "hotel", "motel", "hostel", "bed_and_breakfast", "resort_hotel", "cabin"],
    "campground": ["campground", "camping_cabin", "rv_park"],
    "grocery": ["supermarket", "grocery_store", "convenience_store", "general_store"],
    "food": ["restaurant", "cafe", "bakery", "meal_takeaway", "fast_food_restaurant", "bar"],
    "gas_station": ["gas_station"],
    "pharmacy": ["pharmacy", "drugstore"],
    "laundry": ["laundromat", "laundry"],
    "water": ["drinking_water", "water_point", "spring"],
    "town": ["town", "locality"],
}

DEFAULT_INCLUDED_TYPES: List[str] = [
    "supermarket",
    "grocery_store",
    "convenience_store",
    "bicycle_store",
    "lodging",
    "campground",
    "restaurant",
    "gas_station",
    "pharmacy",
    "laundromat",
    "drinking_water",
]


def resolve_included_types(categories_arg: Optional[str]) -> List[str]:
    """Map categories argument string to a list of Google Places types."""
    if not categories_arg or categories_arg.strip().lower() in ("all", "*"):
        return list(DEFAULT_INCLUDED_TYPES)

    cats = [c.strip().lower() for c in categories_arg.split(",") if c.strip()]
    types: List[str] = []
    for cat in cats:
        if cat in CATEGORY_TO_PLACES_TYPES:
            for t in CATEGORY_TO_PLACES_TYPES[cat]:
                if t not in types:
                    types.append(t)
        else:
            if cat not in types:
                types.append(cat)
    return types or list(DEFAULT_INCLUDED_TYPES)


def register_places_parser(subparsers: Any) -> argparse.ArgumentParser:
    """Register 'places' subcommand on the top-level CLI parser."""
    parser = subparsers.add_parser(
        "places",
        help="Query, cache, and populate Google Places POIs along route or coordinates",
        description="Query Google Places API for route POIs, with persistent caching and offline mock support.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    _add_places_arguments(parser)
    return parser


def _add_places_arguments(parser: argparse.ArgumentParser) -> None:
    """Add argument groups for places CLI."""
    loc_group = parser.add_argument_group("Target Location (Coordinate or Route)")
    loc_group.add_argument("--route", help="Target route slug ID (e.g. colorado-trail, tour-divide-2025)")
    loc_group.add_argument("--lat", type=float, help="Latitude of search center")
    loc_group.add_argument("--lon", type=float, help="Longitude of search center")
    loc_group.add_argument("--point", help="GPS coordinate formatted as 'lat,lon'")
    loc_group.add_argument("--track", help="Path to route-track.json")
    loc_group.add_argument("--gpx", help="Path to GPX route file")
    loc_group.add_argument("--mile", type=float, help="Search around a specific mile along route")
    loc_group.add_argument("--km", type=float, help="Search around a specific kilometer along route")
    loc_group.add_argument("--index", type=int, help="Search around trackpoint index in route file")

    query_group = parser.add_argument_group("Search Configuration")
    query_group.add_argument("--radius", type=int, default=8000, help="Search radius in meters (default: 8000m)")
    query_group.add_argument(
        "--categories",
        default="bike_shop,hotel,grocery,gas_station,laundry,water",
        help=f"Comma-separated categories ({','.join(ALL_CATEGORIES)}) or 'all'",
    )
    query_group.add_argument("--keyword", help="Custom search keyword (e.g. 'safeway', 'outdoor')")
    query_group.add_argument("--details", action="store_true", help="Fetch extended details if available")

    batch_group = parser.add_argument_group("Batch Ingestion & Integration")
    batch_group.add_argument("--output", "-o", help="Destination path for places.json")
    batch_group.add_argument("--cache", help="Path to persistent Places API cache JSON")
    batch_group.add_argument("--towns", help="Path to towns JSON file to seed search centers")
    batch_group.add_argument("--water", help="Path to external water sources JSON file")
    batch_group.add_argument("--waypoints", help="Path to custom / embedded waypoints JSON file")

    export_group = parser.add_argument_group("Export Options")
    export_group.add_argument("--output-json", help="Export search results to JSON file")
    export_group.add_argument("--output-gpx", help="Export search results to GPX waypoints file")

    auth_group = parser.add_argument_group("API Authentication & Mock")
    auth_group.add_argument(
        "--api-key",
        default=(
            os.getenv("GOOGLE_CLOUD_API_KEY")
            or os.getenv("GOOGLE_PLACES_API_KEY")
            or os.getenv("GOOGLE_MAPS_API_KEY")
            or os.getenv("GOOGLE_API_KEY")
        ),
        help="Google Cloud API Key (or set GOOGLE_CLOUD_API_KEY)",
    )
    auth_group.add_argument(
        "--mock",
        action="store_true",
        default=bool(os.getenv("PLACES_MOCK") in ("1", "true", "True")),
        help="Use deterministic offline mock client without contacting Google API",
    )


def build_parser() -> argparse.ArgumentParser:
    """Build standalone parser for engine.cli.places."""
    parser = argparse.ArgumentParser(
        prog="python3 -m engine.cli.places",
        description="Bikepack Navigator Google Places POI Search and Batch Enrichment CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    _add_places_arguments(parser)
    return parser


def _resolve_project_root() -> Path:
    """Resolve project root directory."""
    return Path(__file__).resolve().parents[2]


def _export_to_gpx(places: List[Dict[str, Any]], output_path: Path) -> None:
    """Export places list to GPX waypoints file."""
    gpx_root = ET.Element(
        "gpx",
        version="1.1",
        creator="Bikepack Navigator Engine",
        xmlns="http://www.topografix.com/GPX/1/1",
    )
    for p in places:
        loc = p.get("location", {})
        lat = loc.get("lat", 0.0)
        lon = loc.get("lon", 0.0)
        wpt = ET.SubElement(gpx_root, "wpt", lat=str(lat), lon=str(lon))
        name_el = ET.SubElement(wpt, "name")
        name_el.text = str(p.get("name", "Waypoint"))

        desc_el = ET.SubElement(wpt, "desc")
        desc_parts = [
            f"Category: {p.get('category', 'other')}",
            f"Type: {p.get('type', 'other')}",
        ]
        if p.get("address"):
            desc_parts.append(f"Address: {p.get('address')}")
        if p.get("distance_to_trail_km") is not None:
            desc_parts.append(f"Off-trail: {p.get('distance_to_trail_km'):.2f}km")
        desc_el.text = " | ".join(desc_parts)

        sym_el = ET.SubElement(wpt, "sym")
        sym_el.text = p.get("category", "Waypoint").capitalize()

        type_el = ET.SubElement(wpt, "type")
        type_el.text = p.get("category", "Waypoint")

    tree = ET.ElementTree(gpx_root)
    ET.indent(tree, space="  ", level=0)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(output_path, encoding="utf-8", xml_declaration=True)


def run_places(args: argparse.Namespace) -> int:
    """Execute places CLI logic according to parsed arguments."""
    project_root = _resolve_project_root()
    is_mock = bool(args.mock or not args.api_key)

    # Resolve track if requested
    track_path: Optional[Path] = None
    if args.track:
        track_path = Path(args.track)
    elif args.route:
        candidate_track = project_root / "public" / "data" / "routes" / args.route / "route-track.json"
        if candidate_track.exists():
            track_path = candidate_track

    # -------------------------------------------------------------------------
    # Case A: Batch Route Extraction Mode
    # -------------------------------------------------------------------------
    output_target = args.output
    if not output_target and args.route and not (args.lat or args.point or args.mile or args.km or args.index):
        output_target = str(project_root / "public" / "data" / "routes" / args.route / "places.json")

    if output_target:
        out_p = Path(output_target)
        if not track_path and args.gpx:
            track = parse_gpx_track(args.gpx)
        elif track_path and track_path.exists():
            track_data = read_json(track_path)
            track = RouteTrack.from_route_track_json(track_data)
        else:
            logger.error("Batch extraction requires --track, --route, or --gpx pointing to a valid track.")
            return 1

        # Cache file resolution
        cache_path: Optional[Path] = None
        if args.cache:
            cache_path = Path(args.cache)
        elif args.route:
            cache_path = project_root / "route" / "places" / f".cache_places_api_{args.route}.json"

        # Towns, water, and waypoints
        towns = read_json(Path(args.towns)) if args.towns and Path(args.towns).exists() else None
        water_sources = read_json(Path(args.water)) if args.water and Path(args.water).exists() else None
        if args.waypoints and Path(args.waypoints).exists():
            extra_wpts = read_json(Path(args.waypoints))
            if water_sources is None:
                water_sources = []
            if isinstance(extra_wpts, list):
                water_sources.extend(extra_wpts)

        places = fetch_places_along_route(
            track=track,
            api_key=args.api_key,
            cache_dir=cache_path.parent if cache_path else None,
            towns=towns,
            water_sources=water_sources,
            search_radius_m=args.radius,
            mock_mode=is_mock,
        )

        places_dict = [p.to_dict() for p in places]
        atomic_write_json(out_p, places_dict)
        print(f"[Places CLI] Batch extracted {len(places)} POIs to {out_p}")
        return 0

    # -------------------------------------------------------------------------
    # Case B: Coordinate / Point / Mile Search Mode
    # -------------------------------------------------------------------------
    center_lat: Optional[float] = None
    center_lon: Optional[float] = None

    if args.lat is not None and args.lon is not None:
        center_lat = float(args.lat)
        center_lon = float(args.lon)
    elif args.point:
        parts = args.point.split(",")
        if len(parts) == 2:
            center_lat, center_lon = float(parts[0].strip()), float(parts[1].strip())
    elif (args.mile is not None or args.km is not None or args.index is not None) and (track_path or args.gpx):
        if track_path and track_path.exists():
            track = RouteTrack.from_route_track_json(read_json(track_path))
        else:
            track = parse_gpx_track(args.gpx)

        target_km = args.km if args.km is not None else (miles_to_km(args.mile) if args.mile is not None else 0.0)
        if args.index is not None and 0 <= args.index < len(track.points):
            pt = track.points[args.index]
            center_lat, center_lon = pt.lat, pt.lon
        else:
            # Find nearest track point to target_km
            best_pt = min(track.points, key=lambda p: abs(p.cum_km - target_km))
            center_lat, center_lon = best_pt.lat, best_pt.lon

    if center_lat is None or center_lon is None:
        # If no coordinates or batch target, default to helpful error or usage
        print("[Places CLI] No coordinates or batch target provided. Specify --point lat,lon or --route.", file=sys.stderr)
        return 1

    # Execute interactive query
    types_to_query = resolve_included_types(args.categories)
    client = MockPlacesClient() if is_mock else GooglePlacesClient(api_key=args.api_key)
    raw_results = client.search_nearby(
        lat=center_lat,
        lon=center_lon,
        radius_m=args.radius,
        included_types=types_to_query,
        max_results=20,
    )

    formatted_results: List[Dict[str, Any]] = []
    for r in raw_results:
        loc = r.get("location", {})
        plat = loc.get("latitude") if "latitude" in loc else loc.get("lat", 0.0)
        plon = loc.get("longitude") if "longitude" in loc else loc.get("lon", 0.0)
        disp_name = r.get("displayName")
        name = disp_name.get("text", "") if isinstance(disp_name, dict) else (disp_name or r.get("name", "Place"))
        ptype = r.get("primaryType") or (r.get("types", ["other"])[0] if r.get("types") else "other")
        _, frontend_cat = PLACES_TYPE_TO_CATEGORY.get(ptype, (None, FRONTEND_CATEGORY_MAP.get(ptype, "other")))
        dist_m = haversine_distance_m(center_lat, center_lon, float(plat), float(plon))

        formatted_results.append({
            "id": r.get("id") or r.get("place_id") or name.lower().replace(" ", "_"),
            "name": name,
            "category": frontend_cat,
            "type": ptype,
            "location": {"lat": round(float(plat), 6), "lon": round(float(plon), 6)},
            "distance_m": round(dist_m, 1),
            "address": r.get("formattedAddress", ""),
            "google_maps_url": r.get("googleMapsUri", f"https://maps.google.com/?q={plat},{plon}"),
        })

    # Sort by distance
    formatted_results.sort(key=lambda x: x["distance_m"])

    if args.output_json:
        atomic_write_json(Path(args.output_json), formatted_results)
        print(f"[Places CLI] Wrote {len(formatted_results)} results to {args.output_json}")

    if args.output_gpx:
        _export_to_gpx(formatted_results, Path(args.output_gpx))
        print(f"[Places CLI] Wrote {len(formatted_results)} waypoints to {args.output_gpx}")

    if not args.output_json and not args.output_gpx:
        print(f"\nFound {len(formatted_results)} places near ({center_lat:.5f}, {center_lon:.5f}) within {args.radius}m:")
        print(f"{'Name':<35} | {'Category':<12} | {'Dist (m)':<9} | {'Address'}")
        print("-" * 80)
        for p in formatted_results[:15]:
            print(f"{p['name'][:34]:<35} | {p['category']:<12} | {p['distance_m']:<9.0f} | {p['address'][:25]}")

    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    """CLI entrypoint for places tool."""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return run_places(args)
    except Exception as exc:
        logger.error(f"[Places Error] {exc}", exc_info=True)
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

"""
engine.cli.remap_tracks - Cross-track canonical & guidance mileage mapping tool.

Projects guidance track points onto the canonical route track to enrich guidance-track.json
with monotonic canonical_km and canonical_mi (7D tuples).
Projects all waypoints in places.json onto guidance-track.json to populate guidance_km,
guidance_mile, and guidance_distance_to_trail_km.
"""

import argparse
import json
import logging
from pathlib import Path
import sys
import time
from typing import Any, Dict, List, Optional

from engine.core.models import RoutePoint
from engine.osm.snapping import map_guidance_to_canonical
from engine.utils.io import atomic_write_json
from engine.utils.spatial import TrackIndex

logger = logging.getLogger(__name__)


def remap_route(route_dir: Path) -> Dict[str, Any]:
    """
    Remap guidance track and places for a single route directory.
    Returns metadata summary of the operation.
    """
    route_id = route_dir.name
    route_track_file = route_dir / "route-track.json"
    guidance_track_file = route_dir / "guidance-track.json"
    places_file = route_dir / "places.json"

    if not route_track_file.exists():
        return {"route_id": route_id, "status": "skipped", "reason": "No route-track.json"}

    with open(route_track_file, "r", encoding="utf-8") as f:
        route_track_data = json.load(f)

    canonical_points = route_track_data.get("points", [])
    if not canonical_points:
        return {"route_id": route_id, "status": "skipped", "reason": "Empty route-track points"}

    result: Dict[str, Any] = {
        "route_id": route_id,
        "status": "success",
        "guidance_points": 0,
        "places_remapped": 0
    }

    if guidance_track_file.exists():
        with open(guidance_track_file, "r", encoding="utf-8") as f:
            guidance_data = json.load(f)

        raw_guidance = guidance_data.get("points", [])
        if raw_guidance:
            guidance_points = [
                RoutePoint(
                    lat=float(p[0]),
                    lon=float(p[1]),
                    ele=float(p[2]),
                    cum_km=float(p[3]),
                    cum_mi=float(p[4]),
                    canonical_km=float(p[5]) if len(p) > 5 else None,
                    canonical_mi=float(p[6]) if len(p) > 6 else None,
                )
                for p in raw_guidance
            ]

            map_guidance_to_canonical(guidance_points, canonical_points)

            # Re-serialize guidance-track.json with 7D points
            guidance_output = {
                "total_km": guidance_data.get("total_km", round(guidance_points[-1].cum_km, 1)),
                "total_miles": guidance_data.get("total_miles", round(guidance_points[-1].cum_mi, 1)),
                "points": [p.to_list_7d() for p in guidance_points]
            }
            atomic_write_json(guidance_track_file, guidance_output)
            result["guidance_points"] = len(guidance_points)

            # If places.json exists, project places onto guidance track
            if places_file.exists():
                with open(places_file, "r", encoding="utf-8") as f:
                    places_data = json.load(f)

                if places_data:
                    track_index = TrackIndex(guidance_output["points"])
                    for place in places_data:
                        loc = place.get("location", {})
                        plat = float(loc.get("lat", 0.0))
                        plon = float(loc.get("lon", 0.0))
                        if plat != 0.0 or plon != 0.0:
                            dist_km, g_km, g_mi = track_index.project_point(plat, plon)
                            place["guidance_km"] = g_km
                            place["guidance_mile"] = g_mi
                            place["guidance_distance_to_trail_km"] = dist_km

                    atomic_write_json(places_file, places_data)
                    result["places_remapped"] = len(places_data)

    return result


def remap_all_routes(
    routes_dir: Path,
    target_route: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Remap all routes under routes_dir or a targeted route."""
    if not routes_dir.exists():
        raise FileNotFoundError(f"Routes directory not found: {routes_dir}")

    results = []
    route_folders = (
        [routes_dir / target_route]
        if target_route
        else sorted([p for p in routes_dir.iterdir() if p.is_dir() and (p / "route-track.json").exists()])
    )

    for r_dir in route_folders:
        t0 = time.time()
        res = remap_route(r_dir)
        res["duration_s"] = round(time.time() - t0, 2)
        results.append(res)
        logger.info(
            "Remapped %s: %s guidance pts, %s places in %.2fs",
            res["route_id"],
            res.get("guidance_points", 0),
            res.get("places_remapped", 0),
            res["duration_s"]
        )

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Remap guidance track canonical miles and place projections.")
    parser.add_argument(
        "--routes-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "public" / "data" / "routes",
        help="Directory containing route folders."
    )
    parser.add_argument(
        "--route-id",
        type=str,
        default=None,
        help="Specific route ID to remap. Defaults to all routes."
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    results = remap_all_routes(args.routes_dir, args.route_id)

    print("\n" + "=" * 70)
    print(f"{'Route ID':32} | {'Guidance Pts':12} | {'Places':8} | {'Time (s)':8}")
    print("-" * 70)
    for r in results:
        print(f"{r['route_id']:32} | {r.get('guidance_points', 0):12d} | {r.get('places_remapped', 0):8d} | {r.get('duration_s', 0):8.2f}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())

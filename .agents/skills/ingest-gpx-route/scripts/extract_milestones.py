#!/usr/bin/env python3
"""
extract_milestones.py - Generate milestone checkpoints and jump points along the route.

Usage:
  python3 extract_milestones.py --track <path_to_route_track_json> --output <path_to_milestones_json> [--towns <path_to_towns_json>] [--interval-miles 35] [--state "CO"]
"""

import argparse
import json
import os
import sys
from typing import Dict, List, Any, Optional

def generate_milestones(
    track_path: str,
    output_path: str,
    towns_path: Optional[str] = None,
    interval_miles: float = 35.0,
    default_state: str = "",
    start_name: str = "Trailhead / Start",
    end_name: str = "Finish Terminus"
) -> List[Dict[str, Any]]:
    with open(track_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    points = data.get("points", [])
    if not points:
        raise ValueError("No points found in route-track.json")

    milestones: List[Dict[str, Any]] = []

    # 1. Start point
    start_pt = points[0]
    milestones.append({
        "name": start_name,
        "mile": 0.0,
        "km": 0.0,
        "elevation": round(start_pt[2]),
        "state": default_state
    })

    # 2. Add towns if provided
    towns_added = []
    if towns_path and os.path.exists(towns_path):
        with open(towns_path, "r", encoding="utf-8") as f:
            town_data = json.load(f)
        for t in town_data:
            milestones.append({
                "name": t.get("name", "Town"),
                "mile": round(t.get("route_mile", 0.0), 1),
                "km": round(t.get("route_km", 0.0), 1),
                "elevation": round(t.get("elevation", 0)),
                "state": t.get("province_state", default_state)
            })
            towns_added.append(t.get("route_mile", 0.0))

    # 3. If no towns or large gaps, generate spaced interval checkpoints
    total_miles = points[-1][4]
    curr_target_mile = interval_miles

    while curr_target_mile < total_miles - (interval_miles * 0.4):
        # Check if already covered by an existing town/pass
        has_nearby = any(abs(m["mile"] - curr_target_mile) < (interval_miles * 0.4) for m in milestones)
        if not has_nearby:
            # Find closest track point
            best_pt = min(points, key=lambda p: abs(p[4] - curr_target_mile))
            milestones.append({
                "name": f"Checkpoint Mile {round(best_pt[4])}",
                "mile": round(best_pt[4], 1),
                "km": round(best_pt[3], 1),
                "elevation": round(best_pt[2]),
                "state": default_state
            })
        curr_target_mile += interval_miles

    # 4. Finish point
    end_pt = points[-1]
    milestones.append({
        "name": end_name,
        "mile": round(end_pt[4], 1),
        "km": round(end_pt[3], 1),
        "elevation": round(end_pt[2]),
        "state": default_state
    })

    # Sort milestones strictly by route mile
    milestones.sort(key=lambda m: m["mile"])

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(milestones, f, indent=2)

    print(f"[MILESTONES] Generated {len(milestones)} milestones saved to {output_path}")
    return milestones

def main():
    parser = argparse.ArgumentParser(description="Generate milestones for route navigation")
    parser.add_argument("--track", required=True, help="Path to input route-track.json")
    parser.add_argument("--output", required=True, help="Path to output milestones.json")
    parser.add_argument("--towns", required=False, help="Optional path to towns JSON")
    parser.add_argument("--interval-miles", type=float, default=35.0, help="Interval miles between checkpoints")
    parser.add_argument("--state", default="", help="Default state/province code")
    parser.add_argument("--start-name", default="Start Trailhead", help="Start location name")
    parser.add_argument("--end-name", default="Finish Terminus", help="End location name")
    args = parser.parse_args()

    generate_milestones(
        args.track,
        args.output,
        args.towns,
        args.interval_miles,
        args.state,
        args.start_name,
        args.end_name
    )

if __name__ == "__main__":
    main()

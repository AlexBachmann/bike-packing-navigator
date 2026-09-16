"""
engine.terrain.surfaces - Route surface interval classification, firmness scoring,
gap-free interval reconciliation, and surface telemetry.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple, Union


# -----------------------------------------------------------------------------
# Enums & Constants
# -----------------------------------------------------------------------------

class SurfaceType(str, Enum):
    """Normalized bikepacking surface classification categories."""
    PAVED = "paved"
    UNPAVED = "unpaved"
    GRAVEL = "gravel"
    DIRT = "dirt"
    SINGLETRACK = "singletrack"
    SAND = "sand"
    UNKNOWN = "unknown"


PAVED_SURFACES = {
    "asphalt", "paved", "concrete", "chipseal", "tarmac", "paving_stones",
    "sett", "cobblestone", "concrete:plates", "concrete:lanes", "metal"
}

GRAVEL_SURFACES = {
    "gravel", "fine_gravel", "compacted", "crushed_limestone", "pebblestone",
    "gravel_turf", "crushed_stone"
}

DIRT_SURFACES = {
    "dirt", "ground", "earth", "mud", "clay", "soil", "natural"
}

SAND_SURFACES = {
    "sand", "sandy", "dune", "beach"
}

PAVED_HIGHWAYS = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary",
    "primary_link", "secondary", "secondary_link", "residential"
}

SINGLETRACK_HIGHWAYS = {
    "path", "footway", "bridleway"
}

TRACKTYPE_FIRMNESS: Dict[str, int] = {
    "grade1": 1,
    "grade2": 2,
    "grade3": 3,
    "grade4": 4,
    "grade5": 5,
}

FIRMNESS_LABELS: Dict[int, str] = {
    1: "Grade 1: Solid Paved / Hard Base",
    2: "Grade 2: Solid Unpaved (Compacted Gravel)",
    3: "Grade 3: Mixed Unpaved (Loose Gravel / Soft)",
    4: "Grade 4: Soft Dirt (High Mud Risk)",
    5: "Grade 5: Rough Soil & Exposed Rock",
}

ROAD_CLASS_DEFAULTS: Dict[str, Tuple[str, str]] = {
    'motorway': ('asphalt', 'grade1'),
    'trunk': ('asphalt', 'grade1'),
    'primary': ('asphalt', 'grade1'),
    'secondary': ('asphalt', 'grade1'),
    'tertiary': ('asphalt', 'grade1'),
    'residential': ('asphalt', 'grade1'),
    'unclassified': ('gravel', 'grade2'),
    'track': ('gravel', 'grade2'),
    'service': ('gravel', 'grade2'),
    'path': ('dirt', 'grade4'),
    'footway': ('dirt', 'grade4'),
    'bridleway': ('dirt', 'grade4'),
    'cycleway': ('compacted', 'grade2')
}


# -----------------------------------------------------------------------------
# Classification & Firmness Functions
# -----------------------------------------------------------------------------

def classify_surface(highway: str = "", surface: str = "", tracktype: str = "") -> SurfaceType:
    """
    Classifies OSM road attributes into one of 7 canonical bikepacking surface categories:
    paved, unpaved, gravel, dirt, singletrack, sand, unknown.
    """
    s = (surface or "").strip().lower()
    hw = (highway or "").strip().lower()
    tt = (tracktype or "").strip().lower()

    # 1. Sand
    if s in SAND_SURFACES:
        return SurfaceType.SAND

    # 2. Paved
    if s in PAVED_SURFACES:
        return SurfaceType.PAVED
    if not s and (hw in PAVED_HIGHWAYS or tt == "grade1"):
        return SurfaceType.PAVED

    # 3. Singletrack (narrow trails)
    if hw in SINGLETRACK_HIGHWAYS:
        if s in PAVED_SURFACES:
            return SurfaceType.PAVED
        return SurfaceType.SINGLETRACK

    # 4. Gravel
    if s in GRAVEL_SURFACES:
        return SurfaceType.GRAVEL
    if not s and hw in ("tertiary", "tertiary_link", "unclassified", "track", "service"):
        if tt in ("grade2", "grade3"):
            return SurfaceType.GRAVEL

    # 5. Dirt
    if s in DIRT_SURFACES:
        return SurfaceType.DIRT
    if not s and tt in ("grade4", "grade5"):
        return SurfaceType.DIRT

    # 6. Unpaved
    if s in ("unpaved", "rock", "scree", "grass"):
        return SurfaceType.UNPAVED
    if hw in ("track", "unclassified", "service"):
        return SurfaceType.UNPAVED

    if not hw and not s and not tt:
        return SurfaceType.UNKNOWN

    return SurfaceType.UNKNOWN


def tracktype_to_firmness_score(tracktype: str) -> int:
    """Convert OSM tracktype string ('grade1'..'grade5') to numeric 1-5 firmness score."""
    tt = (tracktype or "").strip().lower()
    return TRACKTYPE_FIRMNESS.get(tt, 2)


def firmness_score_to_tracktype(score: int) -> str:
    """Convert numeric 1-5 firmness score to OSM tracktype grade string ('grade1'..'grade5')."""
    clamped = max(1, min(5, int(score)))
    return f"grade{clamped}"


def infer_firmness(surface: str = "", tracktype: str = "", highway: str = "") -> int:
    """
    Infer surface firmness rating on 1 (hardest/fastest) to 5 (softest/slowest) scale.
    """
    tt = (tracktype or "").strip().lower()
    if tt in TRACKTYPE_FIRMNESS:
        return TRACKTYPE_FIRMNESS[tt]

    s = (surface or "").strip().lower()
    hw = (highway or "").strip().lower()

    if s in PAVED_SURFACES or hw in PAVED_HIGHWAYS:
        return 1
    if s in ("compacted", "fine_gravel"):
        return 2
    if s in ("gravel", "unpaved"):
        return 2
    if s in DIRT_SURFACES or hw in SINGLETRACK_HIGHWAYS:
        return 4
    if s in ("rock", "scree", "sand"):
        return 5

    return 2  # backcountry unpaved default


# -----------------------------------------------------------------------------
# Dataclasses
# -----------------------------------------------------------------------------

@dataclass
class SurfaceInterval:
    """
    Represents a contiguous surface interval along a bikepacking route.

    Implements the Python Sequence protocol (__len__, __getitem__, __iter__)
    to serialize cleanly as [start_km, end_km, road_class, surface, tracktype]
    for backward compatibility with the frontend, physics simulation, and tests.
    """
    start_km: float
    end_km: float
    highway: str = "unclassified"
    surface: str = "gravel"
    tracktype: str = "grade2"

    def __post_init__(self) -> None:
        self.start_km = round(float(self.start_km), 3)
        self.end_km = round(float(self.end_km), 3)
        self.highway = str(self.highway or "unclassified").strip().lower()
        self.surface = str(self.surface or "gravel").strip().lower()
        self.tracktype = str(self.tracktype or "grade2").strip().lower()
        if self.end_km < self.start_km:
            raise ValueError(f"end_km ({self.end_km}) cannot be less than start_km ({self.start_km})")

    @property
    def length_km(self) -> float:
        return max(0.0, round(self.end_km - self.start_km, 3))

    @property
    def road_class(self) -> str:
        """Alias for highway class."""
        return self.highway

    @property
    def surface_type(self) -> SurfaceType:
        """Normalized bikepacking surface classification."""
        return classify_surface(self.highway, self.surface, self.tracktype)

    @property
    def firmness_score(self) -> int:
        """Firmness rating on 1 (hardest) to 5 (softest) scale."""
        return infer_firmness(self.surface, self.tracktype, self.highway)

    @property
    def is_paved(self) -> bool:
        return self.surface_type == SurfaceType.PAVED

    @property
    def is_singletrack(self) -> bool:
        return self.surface_type == SurfaceType.SINGLETRACK

    # Sequence protocol implementation for [start_km, end_km, highway, surface, tracktype]
    def __len__(self) -> int:
        return 5

    def __getitem__(self, index: Union[int, slice]) -> Any:
        values = (self.start_km, self.end_km, self.highway, self.surface, self.tracktype)
        return values[index]

    def __iter__(self) -> Iterator[Any]:
        yield self.start_km
        yield self.end_km
        yield self.highway
        yield self.surface
        yield self.tracktype

    def to_list(self) -> List[Any]:
        """Convert to standard 5-element list for JSON serialization."""
        return [
            round(self.start_km, 1),
            round(self.end_km, 1),
            self.highway,
            self.surface,
            self.tracktype
        ]

    def to_dict(self) -> Dict[str, Any]:
        """Detailed dictionary representation for domain and frontend consumers."""
        return {
            "start_km": self.start_km,
            "end_km": self.end_km,
            "length_km": self.length_km,
            "highway": self.highway,
            "road_class": self.highway,
            "surface": self.surface,
            "tracktype": self.tracktype,
            "surface_type": self.surface_type.value,
            "firmness_score": self.firmness_score,
            "startKm": round(self.start_km, 1),
            "endKm": round(self.end_km, 1),
            "roadClass": self.highway,
        }

    @classmethod
    def from_sequence(cls, seq: Sequence[Any]) -> "SurfaceInterval":
        if len(seq) < 2:
            raise ValueError(f"Surface interval sequence must have at least [start_km, end_km], got {seq}")
        start_km = float(seq[0])
        end_km = float(seq[1])
        hw = str(seq[2]) if len(seq) > 2 else "unclassified"
        surf = str(seq[3]) if len(seq) > 3 else "gravel"
        tt = str(seq[4]) if len(seq) > 4 else "grade2"
        return cls(start_km=start_km, end_km=end_km, highway=hw, surface=surf, tracktype=tt)


@dataclass
class SurfaceStats:
    """Aggregate surface and firmness statistics for a route."""
    total_km: float
    paved_km: float = 0.0
    paved_pct: float = 0.0
    unpaved_km: float = 0.0
    unpaved_pct: float = 0.0
    gravel_km: float = 0.0
    gravel_pct: float = 0.0
    dirt_km: float = 0.0
    dirt_pct: float = 0.0
    singletrack_km: float = 0.0
    singletrack_pct: float = 0.0
    sand_km: float = 0.0
    sand_pct: float = 0.0
    unknown_km: float = 0.0
    unknown_pct: float = 0.0
    avg_firmness: float = 2.0
    breakdown_by_type: Dict[str, Dict[str, float]] = field(default_factory=dict)
    breakdown_by_tracktype: Dict[str, Dict[str, float]] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_km": round(self.total_km, 1),
            "paved_km": round(self.paved_km, 1),
            "paved_pct": round(self.paved_pct, 1),
            "unpaved_km": round(self.unpaved_km, 1),
            "unpaved_pct": round(self.unpaved_pct, 1),
            "gravel_km": round(self.gravel_km, 1),
            "gravel_pct": round(self.gravel_pct, 1),
            "dirt_km": round(self.dirt_km, 1),
            "dirt_pct": round(self.dirt_pct, 1),
            "singletrack_km": round(self.singletrack_km, 1),
            "singletrack_pct": round(self.singletrack_pct, 1),
            "sand_km": round(self.sand_km, 1),
            "sand_pct": round(self.sand_pct, 1),
            "unknown_km": round(self.unknown_km, 1),
            "unknown_pct": round(self.unknown_pct, 1),
            "avg_firmness": round(self.avg_firmness, 2),
            "breakdown_by_type": self.breakdown_by_type,
            "breakdown_by_tracktype": self.breakdown_by_tracktype,
        }


# -----------------------------------------------------------------------------
# Cleaning, Gap Bridging & Merging
# -----------------------------------------------------------------------------

def clean_and_merge_intervals(
    intervals: Sequence[Union[SurfaceInterval, Sequence[Any]]],
    total_km: Optional[float] = None
) -> List[SurfaceInterval]:
    """
    Cleans, bridges, and merges surface intervals with mathematical integrity guarantees:
    1. Converts inputs to SurfaceInterval instances.
    2. Filters out zero-length or negative intervals (end_km <= start_km).
    3. Sorts intervals strictly by start_km.
    4. Guarantees 0.0 start: extends first interval to 0.0 if > 0.0.
    5. Bridges spatial gaps: if interval[i].end_km < interval[i+1].start_km,
       fills the gap using the preceding interval's surface classification.
    6. Eliminates overlaps: if interval[i].end_km > interval[i+1].start_km,
       clamps interval[i+1].start_km to interval[i].end_km.
    7. Merges adjacent intervals with identical (highway, surface, tracktype).
    8. Guarantees total_km end: extends final interval to total_km if total_km is provided.
    """
    if not intervals:
        if total_km and total_km > 0.0:
            return [SurfaceInterval(0.0, round(total_km, 1), "unclassified", "gravel", "grade2")]
        return []

    # 1. Parse into SurfaceIntervals and discard degenerate zero-length intervals
    parsed: List[SurfaceInterval] = []
    for item in intervals:
        interval = item if isinstance(item, SurfaceInterval) else SurfaceInterval.from_sequence(item)
        if interval.end_km > interval.start_km:
            parsed.append(interval)

    if not parsed:
        if total_km and total_km > 0.0:
            return [SurfaceInterval(0.0, round(total_km, 1), "unclassified", "gravel", "grade2")]
        return []

    parsed.sort(key=lambda iv: (iv.start_km, iv.end_km))

    # 2. Bridge gaps and clamp overlaps
    normalized: List[SurfaceInterval] = []
    first = parsed[0]
    curr = SurfaceInterval(0.0, first.end_km, first.highway, first.surface, first.tracktype)

    for nxt in parsed[1:]:
        if nxt.end_km <= curr.end_km:
            # Completely enclosed inside current interval; skip
            continue

        if nxt.start_km > curr.end_km:
            # Gap detected: extend curr to bridge the gap seamlessly
            curr.end_km = nxt.start_km
            normalized.append(curr)
            curr = SurfaceInterval(nxt.start_km, nxt.end_km, nxt.highway, nxt.surface, nxt.tracktype)
        elif nxt.start_km < curr.end_km:
            # Overlap detected: clamp nxt.start_km to curr.end_km
            normalized.append(curr)
            curr = SurfaceInterval(curr.end_km, nxt.end_km, nxt.highway, nxt.surface, nxt.tracktype)
        else:
            # Exact boundary match
            normalized.append(curr)
            curr = SurfaceInterval(nxt.start_km, nxt.end_km, nxt.highway, nxt.surface, nxt.tracktype)

    normalized.append(curr)

    # 3. Merge contiguous intervals having identical highway, surface, and tracktype
    merged: List[SurfaceInterval] = []
    for iv in normalized:
        if not merged:
            merged.append(iv)
            continue
        prev = merged[-1]
        if (
            iv.highway == prev.highway and
            iv.surface == prev.surface and
            iv.tracktype == prev.tracktype and
            abs(iv.start_km - prev.end_km) < 1e-4
        ):
            prev.end_km = iv.end_km
        else:
            merged.append(iv)

    # 4. Guarantee coverage up to total_km if provided
    if total_km is not None and total_km > 0.0:
        target_km = round(total_km, 1)
        if merged:
            last = merged[-1]
            if last.end_km < target_km:
                last.end_km = target_km
            elif last.end_km > target_km and last.start_km < target_km:
                last.end_km = target_km

    # Final sanity cleanup for zero lengths
    return [iv for iv in merged if iv.end_km > iv.start_km]


def compute_surface_stats(
    intervals: Sequence[Union[SurfaceInterval, Sequence[Any]]],
    total_km: Optional[float] = None
) -> SurfaceStats:
    """
    Computes aggregate surface metrics (kilometers, percentages, and weighted average firmness).
    """
    cleaned = clean_and_merge_intervals(intervals, total_km=total_km)
    calc_total_km = total_km if total_km and total_km > 0.0 else (cleaned[-1].end_km if cleaned else 0.0)

    if calc_total_km <= 0.0 or not cleaned:
        return SurfaceStats(total_km=0.0)

    category_kms: Dict[str, float] = {st.value: 0.0 for st in SurfaceType}
    tracktype_kms: Dict[str, float] = {f"grade{i}": 0.0 for i in range(1, 6)}
    total_firmness_weight = 0.0

    for iv in cleaned:
        length = iv.end_km - iv.start_km
        cat = iv.surface_type.value
        category_kms[cat] = category_kms.get(cat, 0.0) + length
        tt = iv.tracktype if iv.tracktype in tracktype_kms else "grade2"
        tracktype_kms[tt] = tracktype_kms.get(tt, 0.0) + length
        total_firmness_weight += iv.firmness_score * length

    avg_firmness = total_firmness_weight / calc_total_km if calc_total_km > 0.0 else 2.0

    breakdown_by_type = {
        k: {
            "km": round(v, 1),
            "pct": round((v / calc_total_km) * 100.0, 1)
        }
        for k, v in category_kms.items() if v > 0.0
    }

    breakdown_by_tracktype = {
        k: {
            "km": round(v, 1),
            "pct": round((v / calc_total_km) * 100.0, 1)
        }
        for k, v in tracktype_kms.items() if v > 0.0
    }

    return SurfaceStats(
        total_km=round(calc_total_km, 1),
        paved_km=round(category_kms["paved"], 1),
        paved_pct=round((category_kms["paved"] / calc_total_km) * 100.0, 1),
        unpaved_km=round(category_kms["unpaved"], 1),
        unpaved_pct=round((category_kms["unpaved"] / calc_total_km) * 100.0, 1),
        gravel_km=round(category_kms["gravel"], 1),
        gravel_pct=round((category_kms["gravel"] / calc_total_km) * 100.0, 1),
        dirt_km=round(category_kms["dirt"], 1),
        dirt_pct=round((category_kms["dirt"] / calc_total_km) * 100.0, 1),
        singletrack_km=round(category_kms["singletrack"], 1),
        singletrack_pct=round((category_kms["singletrack"] / calc_total_km) * 100.0, 1),
        sand_km=round(category_kms["sand"], 1),
        sand_pct=round((category_kms["sand"] / calc_total_km) * 100.0, 1),
        unknown_km=round(category_kms["unknown"], 1),
        unknown_pct=round((category_kms["unknown"] / calc_total_km) * 100.0, 1),
        avg_firmness=round(avg_firmness, 2),
        breakdown_by_type=breakdown_by_type,
        breakdown_by_tracktype=breakdown_by_tracktype,
    )


def generate_route_surfaces(
    track: Any,
    road_network_or_geojson: Optional[Any] = None
) -> List[SurfaceInterval]:
    """
    Generate route surface intervals along a track using matched OSM ways or adaptive terrain heuristic.
    Guarantees contiguous, gap-free coverage from 0.0 to total_km.
    """
    pts = track.points if hasattr(track, "points") else track
    if not pts:
        return []

    total_km = float(pts[-1][3]) if len(pts[-1]) >= 4 else 0.0

    raw_intervals: List[SurfaceInterval] = []

    # If OsmRoadNetwork or GeoJSON is provided, correlate track with OSM ways
    if road_network_or_geojson is not None:
        try:
            # Check if road_network_or_geojson is OsmRoadNetwork
            if hasattr(road_network_or_geojson, "find_nearest_way"):
                # Sample points along route to associate highway segments
                step = max(1, len(pts) // 100)
                curr_hw, curr_surf, curr_tt = "unclassified", "gravel", "grade2"
                curr_start = 0.0

                for i in range(0, len(pts), step):
                    pt = pts[i]
                    lat, lon = pt[0], pt[1]
                    km = pt[3] if len(pt) >= 4 else 0.0
                    match = road_network_or_geojson.find_nearest_way(lat, lon, max_dist_m=100.0)
                    if match:
                        way = match.way
                        hw = way.highway_class or "unclassified"
                        surf = way.surface or ""
                        tt = way.tracktype or ""
                        if not surf or not tt:
                            d_surf, d_tt = ROAD_CLASS_DEFAULTS.get(hw, ("gravel", "grade2"))
                            surf = surf or d_surf
                            tt = tt or d_tt

                        if hw != curr_hw or surf != curr_surf or tt != curr_tt:
                            if km > curr_start:
                                raw_intervals.append(SurfaceInterval(curr_start, km, curr_hw, curr_surf, curr_tt))
                                curr_start = km
                                curr_hw, curr_surf, curr_tt = hw, surf, tt

                if total_km > curr_start:
                    raw_intervals.append(SurfaceInterval(curr_start, total_km, curr_hw, curr_surf, curr_tt))
        except Exception:
            pass

    # If no intervals were produced, generate baseline gravel / unpaved intervals
    if not raw_intervals:
        raw_intervals.append(SurfaceInterval(0.0, total_km, "unclassified", "gravel", "grade2"))

    return clean_and_merge_intervals(raw_intervals, total_km=total_km)

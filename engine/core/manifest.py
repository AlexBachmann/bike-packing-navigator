"""
engine.core.manifest - Route manifest registration and schema synchronization.

Provides atomic reading, updating, and persistence of public/data/routes.json,
synchronizing telemetry data with Angular frontend models, performing
slugification, and managing metadata conflict resolution.
"""

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from engine.utils.io import (
    atomic_write_bytes,
    atomic_write_json,
    safe_read_json,
)
from engine.utils.text import slugify
from engine.utils.units import km_to_miles, meters_to_feet


# -----------------------------------------------------------------------------
# File Verification Constants
# -----------------------------------------------------------------------------

REQUIRED_ROUTE_DATA_FILES: Tuple[str, ...] = (
    "route-track.json",
    "surfaces.json",
    "climbs.json",
    "passes.json",
    "milestones.json",
    "places.json",
)

OPTIONAL_ROUTE_DATA_FILES: Tuple[str, ...] = (
    "guidance-track.json",
    "corridor.pmtiles",
)


# -----------------------------------------------------------------------------
# Manifest Exceptions
# -----------------------------------------------------------------------------

class ManifestError(Exception):
    """Base exception for all manifest operations."""
    pass


class ManifestNotFoundError(ManifestError, FileNotFoundError):
    """Raised when manifest file does not exist and default_if_missing is False."""
    pass


class ManifestCorruptError(ManifestError, ValueError):
    """Raised when manifest JSON is malformed or unparseable."""
    def __init__(self, message: str, path: Optional[Path] = None, backup_path: Optional[Path] = None):
        super().__init__(message)
        self.path = path
        self.backup_path = backup_path


class MissingRouteDataError(ManifestError):
    """Raised in strict verification mode when required route dataset files are missing."""
    pass


# -----------------------------------------------------------------------------
# Verification Result Model
# -----------------------------------------------------------------------------

@dataclass
class RouteVerificationResult:
    """Report of static dataset file completeness for a route directory."""
    route_id: str
    route_dir: Path
    is_complete: bool
    existing_files: List[str]
    missing_required: List[str]
    missing_optional: List[str]


# -----------------------------------------------------------------------------
# Route Manifest Entry Model (Matches Angular RouteSummary)
# -----------------------------------------------------------------------------

@dataclass
class RouteManifestEntry:
    """
    Domain model representing a single route entry in the manifest.
    
    Fully compatible with Angular 21 RouteSummary in src/app/models/route.model.ts,
    providing dual-field aliases for imperial/metric distances and elevations.
    """
    id: str
    name: str
    short_name: str
    badge: str
    start_location: str
    end_location: str
    total_distance_km: float
    total_distance_miles: float
    elevation_gain_m: int
    elevation_gain_ft: int
    highest_elevation_m: int
    highest_elevation_ft: int
    highest_point: str = ""
    iconic_pass: str = ""
    iconic_checkpoints: List[str] = field(default_factory=list)
    description: str = ""
    start_coordinates: Tuple[float, float] = (0.0, 0.0)
    bounds: List[List[float]] = field(default_factory=list)  # [[south, west], [north, east]]
    data_path: str = ""
    start_point: Optional[str] = None
    end_point: Optional[str] = None
    distance_km: Optional[float] = None
    distance_miles: Optional[float] = None
    elevation_gain_meters: Optional[int] = None
    elevation_gain_feet: Optional[int] = None
    highest_elevation_meters: Optional[int] = None
    highest_elevation_feet: Optional[int] = None
    extra_fields: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.id = slugify(self.id, sep="-")
        if not self.data_path:
            self.data_path = f"/data/routes/{self.id}"
        if not self.start_point:
            self.start_point = self.start_location
        if not self.end_point:
            self.end_point = self.end_location
        if not self.badge:
            self.badge = self.short_name
        if self.distance_km is None:
            self.distance_km = self.total_distance_km
        if self.distance_miles is None:
            self.distance_miles = self.total_distance_miles
        if self.elevation_gain_meters is None:
            self.elevation_gain_meters = self.elevation_gain_m
        if self.elevation_gain_feet is None:
            self.elevation_gain_feet = self.elevation_gain_ft
        if self.highest_elevation_meters is None:
            self.highest_elevation_meters = self.highest_elevation_m
        if self.highest_elevation_feet is None:
            self.highest_elevation_feet = self.highest_elevation_ft
        if not self.highest_point and self.iconic_pass:
            self.highest_point = self.iconic_pass
        elif not self.iconic_pass and self.highest_point:
            self.iconic_pass = self.highest_point

    @property
    def center(self) -> Tuple[float, float]:
        """Compute geographic center ((south + north)/2, (west + east)/2)."""
        if len(self.bounds) >= 2 and len(self.bounds[0]) >= 2 and len(self.bounds[1]) >= 2:
            s, w = self.bounds[0][0], self.bounds[0][1]
            n, e = self.bounds[1][0], self.bounds[1][1]
            return ((s + n) / 2.0, (w + e) / 2.0)
        return self.start_coordinates

    @property
    def bbox(self) -> Tuple[float, float, float, float]:
        """Return GeoJSON format bbox: (min_lon, min_lat, max_lon, max_lat)."""
        if len(self.bounds) >= 2 and len(self.bounds[0]) >= 2 and len(self.bounds[1]) >= 2:
            s, w = self.bounds[0][0], self.bounds[0][1]
            n, e = self.bounds[1][0], self.bounds[1][1]
            return (w, s, e, n)
        return (self.start_coordinates[1], self.start_coordinates[0], self.start_coordinates[1], self.start_coordinates[0])

    def to_dict(self) -> Dict[str, Any]:
        """
        Produce complete dictionary with all 24 canonical camelCase fields and aliases.
        """
        d: Dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "shortName": self.short_name,
            "badge": self.badge or self.short_name,
            "startLocation": self.start_location,
            "endLocation": self.end_location,
            "startPoint": self.start_point or self.start_location,
            "endPoint": self.end_point or self.end_location,
            "totalDistanceMiles": round(self.total_distance_miles, 1),
            "totalDistanceKm": round(self.total_distance_km, 1),
            "distanceMiles": round(self.distance_miles if self.distance_miles is not None else self.total_distance_miles, 1),
            "distanceKm": round(self.distance_km if self.distance_km is not None else self.total_distance_km, 1),
            "elevationGainFt": self.elevation_gain_ft,
            "elevationGainM": self.elevation_gain_m,
            "elevationGainFeet": self.elevation_gain_feet if self.elevation_gain_feet is not None else self.elevation_gain_ft,
            "elevationGainMeters": self.elevation_gain_meters if self.elevation_gain_meters is not None else self.elevation_gain_m,
            "highestElevationFeet": self.highest_elevation_feet if self.highest_elevation_feet is not None else self.highest_elevation_ft,
            "highestElevationMeters": self.highest_elevation_meters if self.highest_elevation_meters is not None else self.highest_elevation_m,
            "highestPoint": self.highest_point or self.iconic_pass,
            "iconicPass": self.iconic_pass or self.highest_point,
            "iconicCheckpoints": list(self.iconic_checkpoints),
            "description": self.description,
            "startCoordinates": [round(self.start_coordinates[0], 5), round(self.start_coordinates[1], 5)],
            "bounds": self.bounds,
            "dataPath": self.data_path or f"/data/routes/{self.id}",
        }
        if self.extra_fields:
            d.update(self.extra_fields)
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RouteManifestEntry":
        """
        Parse dictionary supporting both camelCase and snake_case keys.
        Unknown extension fields are preserved in extra_fields.
        """
        known_keys = {
            "id", "name", "shortName", "short_name", "badge",
            "startLocation", "start_location", "endLocation", "end_location",
            "startPoint", "start_point", "endPoint", "end_point",
            "totalDistanceKm", "total_distance_km", "totalDistanceMiles", "total_distance_miles",
            "distanceKm", "distance_km", "distanceMiles", "distance_miles",
            "elevationGainM", "elevation_gain_m", "elevationGainFt", "elevation_gain_ft",
            "elevationGainMeters", "elevation_gain_meters", "elevationGainFeet", "elevation_gain_feet",
            "highestElevationMeters", "highest_elevation_m", "highest_elevation_meters",
            "highestElevationFeet", "highest_elevation_ft", "highest_elevation_feet",
            "highestPoint", "highest_point", "iconicPass", "iconic_pass",
            "iconicCheckpoints", "iconic_checkpoints", "description",
            "startCoordinates", "start_coordinates", "bounds", "dataPath", "data_path"
        }

        r_id = str(data.get("id", ""))
        name = str(data.get("name", ""))
        short_name = str(data.get("shortName", data.get("short_name", name)))
        badge = str(data.get("badge", short_name))

        start_location = str(data.get("startLocation", data.get("start_location", data.get("startPoint", data.get("start_point", "")))))
        end_location = str(data.get("endLocation", data.get("end_location", data.get("endPoint", data.get("end_point", "")))))
        start_point = data.get("startPoint", data.get("start_point", start_location))
        end_point = data.get("endPoint", data.get("end_point", end_location))

        dist_km = float(data.get("totalDistanceKm", data.get("total_distance_km", data.get("distanceKm", data.get("distance_km", 0.0)))))
        dist_mi = float(data.get("totalDistanceMiles", data.get("total_distance_miles", data.get("distanceMiles", data.get("distance_miles", 0.0)))))

        gain_m = int(round(float(data.get("elevationGainM", data.get("elevation_gain_m", data.get("elevationGainMeters", data.get("elevation_gain_meters", 0)))))))
        gain_ft = int(round(float(data.get("elevationGainFt", data.get("elevation_gain_ft", data.get("elevationGainFeet", data.get("elevation_gain_feet", 0)))))))

        high_m = int(round(float(data.get("highestElevationMeters", data.get("highest_elevation_m", data.get("highest_elevation_meters", 0))))))
        high_ft = int(round(float(data.get("highestElevationFeet", data.get("highest_elevation_ft", data.get("highest_elevation_feet", 0))))))

        highest_point = str(data.get("highestPoint", data.get("highest_point", "")))
        iconic_pass = str(data.get("iconicPass", data.get("iconic_pass", highest_point)))
        if not highest_point and iconic_pass:
            highest_point = iconic_pass

        checkpoints = data.get("iconicCheckpoints", data.get("iconic_checkpoints", []))
        if isinstance(checkpoints, str):
            checkpoints = [c.strip() for c in checkpoints.split(",") if c.strip()]

        description = str(data.get("description", ""))

        raw_start_coords = data.get("startCoordinates", data.get("start_coordinates", [0.0, 0.0]))
        start_coords = (float(raw_start_coords[0]), float(raw_start_coords[1])) if len(raw_start_coords) >= 2 else (0.0, 0.0)

        bounds = data.get("bounds", [])
        data_path = str(data.get("dataPath", data.get("data_path", f"/data/routes/{slugify(r_id, sep='-')}")))

        extra = {k: v for k, v in data.items() if k not in known_keys}

        return cls(
            id=r_id,
            name=name,
            short_name=short_name,
            badge=badge,
            start_location=start_location,
            end_location=end_location,
            total_distance_km=dist_km,
            total_distance_miles=dist_mi,
            elevation_gain_m=gain_m,
            elevation_gain_ft=gain_ft,
            highest_elevation_m=high_m,
            highest_elevation_ft=high_ft,
            highest_point=highest_point,
            iconic_pass=iconic_pass,
            iconic_checkpoints=list(checkpoints),
            description=description,
            start_coordinates=start_coords,
            bounds=bounds,
            data_path=data_path,
            start_point=start_point,
            end_point=end_point,
            distance_km=dist_km,
            distance_miles=dist_mi,
            elevation_gain_meters=gain_m,
            elevation_gain_feet=gain_ft,
            highest_elevation_meters=high_m,
            highest_elevation_feet=high_ft,
            extra_fields=extra
        )


# -----------------------------------------------------------------------------
# Route Manifest Container Model
# -----------------------------------------------------------------------------

@dataclass
class RouteManifest:
    """Container model representing the full manifest file (routes.json)."""
    version: int = 1
    routes: List[RouteManifestEntry] = field(default_factory=list)
    default_route_id: Optional[str] = None
    extra_fields: Dict[str, Any] = field(default_factory=dict)

    def get_route(self, route_id: str) -> Optional[RouteManifestEntry]:
        """Retrieve a route by its slug ID."""
        normalized = slugify(route_id, sep="-")
        for r in self.routes:
            if r.id == normalized:
                return r
        return None

    def has_route(self, route_id: str) -> bool:
        """Check whether route ID is registered in manifest."""
        return self.get_route(route_id) is not None

    def find_index(self, route_id: str) -> Optional[int]:
        """Find the 0-based index of a route in the routes list."""
        normalized = slugify(route_id, sep="-")
        for i, r in enumerate(self.routes):
            if r.id == normalized:
                return i
        return None

    def upsert_route(self, entry: RouteManifestEntry, preserve_metadata: bool = True) -> bool:
        """
        Insert or update route. Returns True if updated, False if appended.
        Preserves ordering in routes list when updating.
        """
        idx = self.find_index(entry.id)
        if idx is not None:
            if preserve_metadata:
                old = self.routes[idx]
                # Checkpoints preservation: if new is empty or generic and old has custom items
                new_ckpts = entry.iconic_checkpoints
                old_ckpts = old.iconic_checkpoints
                if (not new_ckpts or len(new_ckpts) <= 3) and len(old_ckpts) > len(new_ckpts):
                    entry.iconic_checkpoints = list(old_ckpts)

                # Highest point / iconic pass preservation: if new is empty and old is custom
                if not entry.highest_point and old.highest_point:
                    entry.highest_point = old.highest_point
                if not entry.iconic_pass and old.iconic_pass:
                    entry.iconic_pass = old.iconic_pass

                # Descriptive fields fallback: keep old if new is blank
                if not entry.description and old.description:
                    entry.description = old.description
                if not entry.start_location and old.start_location:
                    entry.start_location = old.start_location
                    entry.start_point = old.start_point
                if not entry.end_location and old.end_location:
                    entry.end_location = old.end_location
                    entry.end_point = old.end_point

                # Spatial and geographic coordinate preservation
                if not entry.bounds and old.bounds:
                    entry.bounds = [list(b) for b in old.bounds] if isinstance(old.bounds, list) else list(old.bounds)
                if entry.start_coordinates == (0.0, 0.0) and old.start_coordinates != (0.0, 0.0):
                    entry.start_coordinates = old.start_coordinates

                # Distance metrics preservation and imperial conversion fallback
                if entry.total_distance_km == 0.0 and old.total_distance_km > 0.0:
                    entry.total_distance_km = old.total_distance_km
                    if entry.distance_km == 0.0 or entry.distance_km is None:
                        entry.distance_km = old.total_distance_km

                if entry.total_distance_miles == 0.0:
                    if entry.total_distance_km > 0.0 and entry.total_distance_km != old.total_distance_km:
                        entry.total_distance_miles = km_to_miles(entry.total_distance_km)
                    elif old.total_distance_miles > 0.0:
                        entry.total_distance_miles = old.total_distance_miles
                    elif entry.total_distance_km > 0.0:
                        entry.total_distance_miles = km_to_miles(entry.total_distance_km)
                    if entry.distance_miles == 0.0 or entry.distance_miles is None:
                        entry.distance_miles = entry.total_distance_miles

                # Elevation gain preservation and foot conversion
                if entry.elevation_gain_m == 0 and old.elevation_gain_m > 0:
                    entry.elevation_gain_m = old.elevation_gain_m
                    entry.elevation_gain_meters = old.elevation_gain_m
                if entry.elevation_gain_ft == 0:
                    if old.elevation_gain_ft > 0 and entry.elevation_gain_m == old.elevation_gain_m:
                        entry.elevation_gain_ft = old.elevation_gain_ft
                    elif entry.elevation_gain_m > 0:
                        entry.elevation_gain_ft = int(round(meters_to_feet(entry.elevation_gain_m)))
                    elif old.elevation_gain_ft > 0:
                        entry.elevation_gain_ft = old.elevation_gain_ft
                    entry.elevation_gain_feet = entry.elevation_gain_ft

                # Highest elevation preservation and foot conversion
                if entry.highest_elevation_m == 0 and old.highest_elevation_m > 0:
                    entry.highest_elevation_m = old.highest_elevation_m
                    entry.highest_elevation_meters = old.highest_elevation_m
                if entry.highest_elevation_ft == 0:
                    if old.highest_elevation_ft > 0 and entry.highest_elevation_m == old.highest_elevation_m:
                        entry.highest_elevation_ft = old.highest_elevation_ft
                    elif entry.highest_elevation_m > 0:
                        entry.highest_elevation_ft = int(round(meters_to_feet(entry.highest_elevation_m)))
                    elif old.highest_elevation_ft > 0:
                        entry.highest_elevation_ft = old.highest_elevation_ft
                    entry.highest_elevation_feet = entry.highest_elevation_ft

                # Merge extra metadata
                merged_extra = {**old.extra_fields, **entry.extra_fields}
                entry.extra_fields = merged_extra

            self.routes[idx] = entry
            return True
        else:
            self.routes.append(entry)
            return False

    def remove_route(self, route_id: str) -> bool:
        """Remove route by slug ID. Returns True if removed, False if not found."""
        idx = self.find_index(route_id)
        if idx is not None:
            del self.routes[idx]
            return True
        return False

    def to_dict(self) -> Dict[str, Any]:
        """Serialize manifest to JSON-compatible dictionary."""
        res: Dict[str, Any] = {
            "version": self.version,
            "routes": [r.to_dict() for r in self.routes]
        }
        if self.default_route_id:
            res["defaultRouteId"] = self.default_route_id
        if self.extra_fields:
            res.update(self.extra_fields)
        return res

    @classmethod
    def from_dict(cls, data: Union[Dict[str, Any], List[Dict[str, Any]]]) -> "RouteManifest":
        """Parse dictionary or list representation into RouteManifest."""
        if isinstance(data, list):
            routes = [RouteManifestEntry.from_dict(item) for item in data]
            return cls(version=1, routes=routes)

        version = int(data.get("version", 1))
        routes_raw = data.get("routes", [])
        routes = [RouteManifestEntry.from_dict(item) for item in routes_raw]
        default_route = data.get("defaultRouteId")
        extra = {k: v for k, v in data.items() if k not in ("version", "routes", "defaultRouteId")}
        return cls(version=version, routes=routes, default_route_id=default_route, extra_fields=extra)


# -----------------------------------------------------------------------------
# Manifest File Operations
# -----------------------------------------------------------------------------

def load_manifest(
    path: Union[str, Path] = "public/data/routes.json",
    default_if_missing: bool = True,
    auto_recover_backup: bool = True,
) -> RouteManifest:
    """
    Safely load and parse the route manifest JSON file.

    Args:
        path: Filepath to routes.json.
        default_if_missing: If True, returns an empty RouteManifest if file missing.
                            If False, raises ManifestNotFoundError.
        auto_recover_backup: If True and primary JSON is corrupted, attempts to
                             recover from {path}.bak.

    Returns:
        RouteManifest instance.

    Raises:
        ManifestNotFoundError: If file does not exist and default_if_missing is False.
        ManifestCorruptError: If file is malformed JSON and backup recovery fails.
    """
    p = Path(path)
    if not p.exists():
        if default_if_missing:
            return RouteManifest(version=1, routes=[])
        raise ManifestNotFoundError(f"Manifest file not found: {p}")

    try:
        data = safe_read_json(p)
        return RouteManifest.from_dict(data)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as err:
        if auto_recover_backup:
            bak_path = p.with_name(p.name + ".bak")
            if bak_path.exists():
                try:
                    bak_data = safe_read_json(bak_path)
                    return RouteManifest.from_dict(bak_data)
                except Exception:
                    pass
        raise ManifestCorruptError(f"Corrupted manifest JSON at {p}: {err}", path=p) from err


def backup_manifest(
    path: Union[str, Path],
    backup_suffix: str = ".bak"
) -> Optional[Path]:
    """
    Create a backup copy of an existing manifest file.

    Returns:
        Path to backup file if created, None if source did not exist or was empty.
    """
    p = Path(path)
    if p.exists() and p.stat().st_size > 0:
        bak_path = p.with_name(p.name + backup_suffix)
        atomic_write_bytes(bak_path, p.read_bytes())
        return bak_path
    return None


def save_manifest(
    path: Union[str, Path],
    manifest: RouteManifest,
    create_backup: bool = True,
    indent: int = 2,
) -> None:
    """
    Atomically write the route manifest to disk.

    Args:
        path: Target filepath for routes.json.
        manifest: RouteManifest container to serialize.
        create_backup: If True, creates a .bak copy of pre-existing valid file.
        indent: JSON indentation formatting (default: 2).
    """
    p = Path(path)
    if create_backup and p.exists() and p.stat().st_size > 0:
        backup_manifest(p)
    atomic_write_json(p, manifest.to_dict(), indent=indent)


def verify_route_data_files(
    route_data_dir: Union[str, Path],
    route_id: Optional[str] = None,
    required_files: Optional[Sequence[str]] = None,
    optional_files: Optional[Sequence[str]] = None,
) -> RouteVerificationResult:
    """
    Inspect a route's data folder to verify presence of standardized datasets.
    """
    dir_path = Path(route_data_dir)
    r_id = route_id or dir_path.name
    reqs = required_files or REQUIRED_ROUTE_DATA_FILES
    opts = optional_files or OPTIONAL_ROUTE_DATA_FILES

    existing: List[str] = []
    missing_req: List[str] = []
    missing_opt: List[str] = []

    for req in reqs:
        if (dir_path / req).exists():
            existing.append(req)
        else:
            missing_req.append(req)

    for opt in opts:
        if (dir_path / opt).exists():
            existing.append(opt)
        else:
            missing_opt.append(opt)

    is_complete = (len(missing_req) == 0)
    return RouteVerificationResult(
        route_id=r_id,
        route_dir=dir_path,
        is_complete=is_complete,
        existing_files=existing,
        missing_required=missing_req,
        missing_optional=missing_opt
    )


def register_route(
    routes_json_path: Union[str, Path],
    route_id: str,
    name: str,
    short_name: Optional[str] = None,
    badge: Optional[str] = None,
    start_location: str = "",
    end_location: str = "",
    description: str = "",
    stats: Optional[Union[Dict[str, Any], str, Path]] = None,
    track: Optional[Any] = None,
    checkpoints: Optional[Union[List[str], str]] = None,
    highest_point: Optional[str] = None,
    iconic_pass: Optional[str] = None,
    custom_metadata: Optional[Dict[str, Any]] = None,
    verify_files: bool = False,
    strict_verify: bool = False,
    create_backup: bool = True,
) -> RouteManifestEntry:
    """
    High-level entrypoint to register or update a route in routes.json.

    1. Normalizes and slugifies route_id.
    2. Loads existing manifest or creates default version 1 container.
    3. Populates telemetry from stats dict/path or RouteTrack/TrackTelemetry.
    4. Applies conflict resolution: updates existing route while preserving
       custom metadata and checkpoints, or appends a new entry.
    5. Optionally verifies standardized dataset files in route data directory.
    6. Atomically saves manifest with backup creation.

    Returns:
        The registered RouteManifestEntry.
    """
    p_manifest = Path(routes_json_path)

    # 1. Enforce deterministic slugification
    if not route_id:
        normalized_id = slugify(name, sep="-")
    else:
        normalized_id = slugify(route_id, sep="-")

    # 2. File verification
    if verify_files:
        route_dir = p_manifest.parent / "routes" / normalized_id
        ver_res = verify_route_data_files(route_dir, route_id=normalized_id)
        if strict_verify and not ver_res.is_complete:
            raise MissingRouteDataError(
                f"Route '{normalized_id}' is missing required data files in {route_dir}: {ver_res.missing_required}"
            )

    # 3. Extract telemetry
    stats_dict: Dict[str, Any] = {}
    if stats is not None:
        if isinstance(stats, (str, Path)):
            stats_p = Path(stats)
            if stats_p.exists():
                stats_dict = safe_read_json(stats_p)
        elif isinstance(stats, dict):
            stats_dict = stats

    if not stats_dict and track is not None:
        if hasattr(track, "to_stats_json"):
            stats_dict = track.to_stats_json()
        elif hasattr(track, "to_dict"):
            stats_dict = track.to_dict()

    total_km = float(stats_dict.get("total_km", stats_dict.get("distance_km", stats_dict.get("distanceKm", 0.0))))
    total_mi = float(stats_dict.get("total_miles", stats_dict.get("distance_miles", stats_dict.get("distanceMiles", 0.0))))
    if total_mi == 0.0 and total_km > 0.0:
        total_mi = km_to_miles(total_km)

    gain_m = int(round(float(stats_dict.get("elevation_gain_m", stats_dict.get("elevationGainM", 0)))))
    gain_ft = int(round(float(stats_dict.get("elevation_gain_ft", stats_dict.get("elevationGainFt", 0)))))
    if gain_ft == 0 and gain_m > 0:
        gain_ft = int(round(meters_to_feet(gain_m)))

    high_m = int(round(float(stats_dict.get("highest_elevation_m", stats_dict.get("highestElevationMeters", 0)))))
    high_ft = int(round(float(stats_dict.get("highest_elevation_ft", stats_dict.get("highestElevationFeet", 0)))))
    if high_ft == 0 and high_m > 0:
        high_ft = int(round(meters_to_feet(high_m)))

    start_coords = stats_dict.get("start_coordinates", stats_dict.get("startCoordinates", [0.0, 0.0]))
    start_tuple = (float(start_coords[0]), float(start_coords[1])) if len(start_coords) >= 2 else (0.0, 0.0)

    bounds = stats_dict.get("bounds", [])

    # Checkpoints
    ckpts: List[str] = []
    if checkpoints is not None:
        if isinstance(checkpoints, str):
            ckpts = [c.strip() for c in checkpoints.split(",") if c.strip()]
        else:
            ckpts = list(checkpoints)

    entry = RouteManifestEntry(
        id=normalized_id,
        name=name,
        short_name=short_name or name,
        badge=badge or short_name or name,
        start_location=start_location,
        end_location=end_location,
        total_distance_km=total_km,
        total_distance_miles=total_mi,
        elevation_gain_m=gain_m,
        elevation_gain_ft=gain_ft,
        highest_elevation_m=high_m,
        highest_elevation_ft=high_ft,
        highest_point=highest_point or "",
        iconic_pass=iconic_pass or highest_point or "",
        iconic_checkpoints=ckpts,
        description=description,
        start_coordinates=start_tuple,
        bounds=bounds,
        extra_fields=custom_metadata or {}
    )

    manifest = load_manifest(p_manifest, default_if_missing=True)
    manifest.upsert_route(entry, preserve_metadata=True)
    save_manifest(p_manifest, manifest, create_backup=create_backup)

    # Return the persisted entry from manifest
    saved_entry = manifest.get_route(normalized_id)
    return saved_entry if saved_entry is not None else entry

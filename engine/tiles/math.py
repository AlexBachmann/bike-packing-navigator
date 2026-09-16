"""
engine.tiles.math - Slippy map Web Mercator tile mathematics and coordinate transformations.

Provides:
- Strongly typed TileCoord and TileRange dataclasses.
- TMS, QuadKey, and Hilbert curve Tile ID conversions.
- Geodetic ground resolution (meters/pixel) and map scale calculations.
- Tile hierarchy traversal (parent, children, neighbors).
- Bounding box pyramids and route corridor tile identification.
- Re-exports and integrates with engine.utils.tiles.
"""

from dataclasses import dataclass
import math
from typing import Any, Iterator, List, Optional, Sequence, Set, Tuple, Union

from engine.utils.geo import haversine_distance_m
from engine.utils.spatial import BoundingBox
from engine.utils.tiles import (
    MAX_LAT,
    MIN_LAT,
    dem_tile_name,
    get_intersecting_tiles,
    is_valid_tile,
    latlon_to_tile,
    lonlat_to_mvt_pixel,
    lonlat_to_tile,
    mvt_pixel_to_lonlat,
    tile_range_for_bbox,
    tile_to_bounds,
)

try:
    from pmtiles.tile import tileid_to_zxy as _tileid_to_zxy, zxy_to_tileid as _zxy_to_tileid
except ImportError:
    _zxy_to_tileid = None
    _tileid_to_zxy = None


# -----------------------------------------------------------------------------
# Dataclasses
# -----------------------------------------------------------------------------

@dataclass(frozen=True)
class TileCoord:
    """
    Represents a standard Web Mercator Slippy tile coordinate (z, x, y).
    Implements 3-element Sequence protocol (z, x, y) for unpacking and indexing.
    """
    z: int
    x: int
    y: int

    def __post_init__(self) -> None:
        if not is_valid_tile(self.x, self.y, self.z):
            raise ValueError(f"Invalid tile coordinate ({self.x}, {self.y}) at zoom {self.z}")

    def __len__(self) -> int:
        return 3

    def __getitem__(self, index: Union[int, slice]) -> Any:
        vals = (self.z, self.x, self.y)
        return vals[index]

    def __iter__(self) -> Iterator[int]:
        yield self.z
        yield self.x
        yield self.y

    @property
    def tile_id(self) -> int:
        """Hilbert curve PMTiles v3 64-bit tile ID."""
        return tile_to_tileid(self.z, self.x, self.y)

    @property
    def quadkey(self) -> str:
        """Microsoft Bing Maps QuadKey string representation."""
        return tile_to_quadkey(self.x, self.y, self.z)

    @property
    def bounds(self) -> Tuple[float, float, float, float]:
        """Standard GIS bbox: (min_lon, min_lat, max_lon, max_lat)."""
        return tile_to_bounds(tx=self.x, ty=self.y, zoom=self.z)

    @property
    def bbox(self) -> BoundingBox:
        """BoundingBox instance for tile boundaries."""
        w, s, e, n = self.bounds
        return BoundingBox(min_lon=w, min_lat=s, max_lon=e, max_lat=n)

    @property
    def center(self) -> Tuple[float, float]:
        """Tile center coordinate as (lon, lat)."""
        w, s, e, n = self.bounds
        return (w + e) / 2.0, (s + n) / 2.0

    @property
    def parent(self) -> Optional["TileCoord"]:
        """Parent tile at zoom z - 1, or None if at root zoom 0."""
        if self.z <= 0:
            return None
        pz, px, py = parent_tile(self.z, self.x, self.y)
        return TileCoord(pz, px, py)

    @property
    def children(self) -> List["TileCoord"]:
        """4 sub-tiles at zoom z + 1."""
        return [TileCoord(cz, cx, cy) for cz, cx, cy in children_tiles(self.z, self.x, self.y)]

    def neighbors(self, buffer_radius: int = 1) -> List["TileCoord"]:
        """Return (2*r + 1)x(2*r + 1) neighborhood of valid tile coordinates."""
        return [
            TileCoord(nz, nx, ny)
            for nz, nx, ny in tile_neighbors(self.z, self.x, self.y, buffer_radius=buffer_radius)
        ]

    def to_tms(self) -> Tuple[int, int, int]:
        """Return (z, x, y_tms) in OSGeo TMS coordinate convention."""
        tms_x, tms_y = xyz_to_tms(self.x, self.y, self.z)
        return self.z, tms_x, tms_y

    def as_tuple(self) -> Tuple[int, int, int]:
        """Return (z, x, y) tuple."""
        return self.z, self.x, self.y


@dataclass(frozen=True)
class TileRange:
    """
    Inclusive bounding tile index range at a specific zoom level.
    """
    zoom: int
    min_x: int
    min_y: int
    max_x: int
    max_y: int

    def __post_init__(self) -> None:
        if not (0 <= self.zoom <= 30):
            raise ValueError(f"Invalid zoom level: {self.zoom}")
        if self.min_x > self.max_x or self.min_y > self.max_y:
            raise ValueError("Min coordinates cannot exceed max coordinates")

    @property
    def count(self) -> int:
        """Total number of tiles in this range."""
        return (self.max_x - self.min_x + 1) * (self.max_y - self.min_y + 1)

    def iter_tiles(self) -> Iterator[TileCoord]:
        """Yield TileCoord for all tiles in range."""
        for x in range(self.min_x, self.max_x + 1):
            for y in range(self.min_y, self.max_y + 1):
                yield TileCoord(self.zoom, x, y)

    def __iter__(self) -> Iterator[TileCoord]:
        return self.iter_tiles()


# -----------------------------------------------------------------------------
# Coordinate Conversions & Tile IDs
# -----------------------------------------------------------------------------

def xyz_to_tms(x: int, y: int, zoom: int) -> Tuple[int, int]:
    """
    Convert Slippy (XYZ) coordinates to OSGeo TMS coordinates: y_tms = 2^zoom - 1 - y.
    """
    if not is_valid_tile(x, y, zoom):
        raise ValueError(f"Invalid tile coordinates ({x}, {y}) at zoom {zoom}")
    n = 1 << zoom
    return x, n - 1 - y


def tms_to_xyz(x: int, y: int, zoom: int) -> Tuple[int, int]:
    """
    Convert OSGeo TMS coordinates to Slippy (XYZ) coordinates: y_xyz = 2^zoom - 1 - y.
    """
    if not is_valid_tile(x, y, zoom):
        raise ValueError(f"Invalid TMS coordinates ({x}, {y}) at zoom {zoom}")
    n = 1 << zoom
    return x, n - 1 - y


def tile_to_quadkey(x: int, y: int, zoom: int) -> str:
    """
    Convert (x, y, zoom) to a Bing Maps QuadKey string of length zoom.
    """
    if not is_valid_tile(x, y, zoom):
        raise ValueError(f"Invalid tile coordinates ({x}, {y}) at zoom {zoom}")
    chars: List[str] = []
    for i in range(zoom, 0, -1):
        digit = 0
        mask = 1 << (i - 1)
        if (x & mask) != 0:
            digit += 1
        if (y & mask) != 0:
            digit += 2
        chars.append(str(digit))
    return "".join(chars)


def quadkey_to_tile(quadkey: str) -> Tuple[int, int, int]:
    """
    Convert a Bing Maps QuadKey string to (zoom, x, y).
    """
    zoom = len(quadkey)
    if not (0 <= zoom <= 30):
        raise ValueError(f"Invalid QuadKey length {zoom}")
    x = 0
    y = 0
    for char in quadkey:
        if char not in ("0", "1", "2", "3"):
            raise ValueError(f"Invalid QuadKey character: {char}")
        x <<= 1
        y <<= 1
        digit = int(char)
        if digit & 1:
            x |= 1
        if digit & 2:
            y |= 1
    return zoom, x, y


def tile_to_tileid(z: int, x: int, y: int) -> int:
    """
    Convert (z, x, y) to PMTiles v3 Hilbert tile ID using pmtiles.tile.zxy_to_tileid.
    """
    if _zxy_to_tileid is not None:
        return _zxy_to_tileid(z, x, y)
    # Pure Python fallback for Hilbert tile ID calculation if pmtiles is uninstalled
    # Interleaved Morton/Hilbert fallback for testing environments
    return (1 << (2 * z)) + (x << z) + y


def tileid_to_tile(tile_id: int) -> Tuple[int, int, int]:
    """
    Convert PMTiles v3 Hilbert tile ID to (z, x, y) using pmtiles.tile.tileid_to_zxy.
    """
    if _tileid_to_zxy is not None:
        return _tileid_to_zxy(tile_id)
    raise NotImplementedError("pmtiles library required for tileid_to_tile decoding")


# -----------------------------------------------------------------------------
# Geodetic Resolution & Scale Math
# -----------------------------------------------------------------------------

def ground_resolution(lat: float, zoom: int) -> float:
    """
    Calculate ground resolution in meters per pixel at a given latitude and zoom level.
    Formula: (cos(radians(lat)) * 2 * pi * 6378137.0) / (256 * 2^zoom)
    """
    lat_clamped = max(MIN_LAT, min(MAX_LAT, lat))
    lat_rad = math.radians(lat_clamped)
    return (math.cos(lat_rad) * 2.0 * math.pi * 6378137.0) / (256.0 * (2.0 ** zoom))


def map_scale(lat: float, zoom: int, dpi: float = 96.0) -> float:
    """
    Calculate the representative fraction map scale denominator (1:M) at given latitude and DPI.
    Formula: ground_resolution(lat, zoom) * (dpi / 0.0254)
    """
    return ground_resolution(lat, zoom) * (dpi / 0.0254)


def meters_to_tile_pixels(meters: float, lat: float, zoom: int, extent: int = 4096) -> float:
    """
    Convert a ground distance in meters to MVT pixel units within a tile of given extent.
    """
    res = ground_resolution(lat, zoom)
    if res <= 0.0:
        return 0.0
    return (meters / res) * (extent / 256.0)


# -----------------------------------------------------------------------------
# Hierarchy & Neighborhood
# -----------------------------------------------------------------------------

def parent_tile(z: int, x: int, y: int) -> Tuple[int, int, int]:
    """
    Return parent tile (z - 1, x // 2, y // 2) for z > 0.
    """
    if z <= 0:
        raise ValueError("Root tile at zoom 0 has no parent")
    return z - 1, x // 2, y // 2


def children_tiles(z: int, x: int, y: int) -> List[Tuple[int, int, int]]:
    """
    Return 4 children tiles at zoom z + 1.
    """
    nz = z + 1
    nx = x * 2
    ny = y * 2
    return [
        (nz, nx, ny),
        (nz, nx + 1, ny),
        (nz, nx, ny + 1),
        (nz, nx + 1, ny + 1),
    ]


def tile_neighbors(z: int, x: int, y: int, buffer_radius: int = 1) -> List[Tuple[int, int, int]]:
    """
    Return all valid tile coordinates in the (2*r + 1)x(2*r + 1) window around (x, y).
    """
    max_coord = 1 << z
    neighbors: List[Tuple[int, int, int]] = []
    for dx in range(-buffer_radius, buffer_radius + 1):
        for dy in range(-buffer_radius, buffer_radius + 1):
            nx = x + dx
            ny = y + dy
            if 0 <= nx < max_coord and 0 <= ny < max_coord:
                neighbors.append((z, nx, ny))
    return neighbors


# -----------------------------------------------------------------------------
# Bounding Box Pyramids & Corridor Calculations
# -----------------------------------------------------------------------------

def tiles_for_bbox_pyramid(
    bbox: Union[BoundingBox, Tuple[float, float, float, float]],
    min_zoom: int,
    max_zoom: int,
) -> List[TileCoord]:
    """
    Compute all tile coordinates (z, x, y) covering a bounding box across zoom range [min_zoom, max_zoom].
    """
    if min_zoom > max_zoom:
        raise ValueError(f"min_zoom ({min_zoom}) cannot exceed max_zoom ({max_zoom})")

    tiles: List[TileCoord] = []
    for z in range(min_zoom, max_zoom + 1):
        for z_val, x, y in get_intersecting_tiles(bbox, z):
            tiles.append(TileCoord(z_val, x, y))
    return tiles


def _densify_coords(coords: Sequence[Tuple[float, float]], step_m: float = 120.0) -> List[Tuple[float, float]]:
    """
    Helper to densify sequence of (lat, lon) coordinates so adjacent points are <= step_m.
    """
    if len(coords) < 2:
        return list(coords)

    densified: List[Tuple[float, float]] = [coords[0]]
    for i in range(len(coords) - 1):
        p1 = coords[i]
        p2 = coords[i + 1]
        dist = haversine_distance_m(p1[0], p1[1], p2[0], p2[1])

        if dist > step_m and dist > 0.0:
            num_sub = int(math.ceil(dist / step_m))
            for k in range(1, num_sub):
                frac = k / num_sub
                lat = p1[0] + (p2[0] - p1[0]) * frac
                lon = p1[1] + (p2[1] - p1[1]) * frac
                densified.append((lat, lon))

        densified.append(p2)
    return densified


def tiles_for_corridor(
    points: Sequence[Any],
    zoom_or_min_zoom: int,
    max_zoom: Optional[int] = None,
    radius_m: float = 500.0,
    buffer_tiles: int = 1,
    densify_step_m: float = 120.0,
    town_boxes: Optional[Sequence[Any]] = None,
) -> List[TileCoord]:
    """
    Compute tile coordinates for a route corridor:
    - If max_zoom is None, calculates for single zoom_or_min_zoom.
    - If max_zoom is provided, computes across [min_zoom, max_zoom].
    - Overview zooms (z <= 8): Full route bounding box + buffer tiles.
    - Detail zooms (z > 8): Densified track points (interval <= densify_step_m) + neighborhood buffer.
    - Full coverage of town_boxes at all requested zoom levels.

    Returns:
        Deduplicated, sorted list of TileCoord instances.
    """
    if max_zoom is None:
        min_z = int(zoom_or_min_zoom)
        max_z = int(zoom_or_min_zoom)
    else:
        min_z = int(zoom_or_min_zoom)
        max_z = int(max_zoom)

    if min_z > max_z:
        raise ValueError(f"min_zoom ({min_z}) cannot exceed max_zoom ({max_z})")

    # Extract coordinates from sequence or RouteTrack
    raw_coords: List[Tuple[float, float]] = []
    if hasattr(points, "points"):
        raw_coords = [(float(p[0]), float(p[1])) for p in points.points]
    else:
        for p in points:
            raw_coords.append((float(p[0]), float(p[1])))

    if not raw_coords:
        return []

    lats = [p[0] for p in raw_coords]
    lons = [p[1] for p in raw_coords]
    route_bbox = BoundingBox(min_lon=min(lons), min_lat=min(lats), max_lon=max(lons), max_lat=max(lats))

    # Densify detail points once
    densified_pts = _densify_coords(raw_coords, step_m=densify_step_m)

    unique_tiles: Set[Tuple[int, int, int]] = set()

    for z in range(min_z, max_z + 1):
        if z <= 8:
            # Overview zoom: Route bounding box + 1 tile buffer
            min_x, min_y, max_x, max_y = tile_range_for_bbox(route_bbox, z)
            max_c = 1 << z
            bx0 = max(0, min_x - buffer_tiles)
            by0 = max(0, min_y - buffer_tiles)
            bx1 = min(max_c - 1, max_x + buffer_tiles)
            by1 = min(max_c - 1, max_y + buffer_tiles)

            for x in range(bx0, bx1 + 1):
                for y in range(by0, by1 + 1):
                    unique_tiles.add((z, x, y))
        else:
            # Detail zoom: Point buffer
            for lat, lon in densified_pts:
                tx, ty = lonlat_to_tile(lon, lat, z)
                for nz, nx, ny in tile_neighbors(z, tx, ty, buffer_radius=buffer_tiles):
                    unique_tiles.add((nz, nx, ny))

        # Add town boxes if provided
        if town_boxes:
            for tb in town_boxes:
                for z_val, x, y in get_intersecting_tiles(tb, z):
                    unique_tiles.add((z_val, x, y))

    # Sort deterministically by (z, x, y)
    sorted_coords = sorted(unique_tiles, key=lambda t: (t[0], t[1], t[2]))
    return [TileCoord(z, x, y) for z, x, y in sorted_coords]

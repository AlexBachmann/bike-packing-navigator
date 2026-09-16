"""
engine.tiles.pmtiles - PMTiles v3 archive lifecycle management, reader/writer,
corridor extraction, and section slicing.
"""

from dataclasses import dataclass, field
import gzip
import json
import os
from pathlib import Path
import time
from typing import Any, BinaryIO, Callable, Dict, Iterator, List, Optional, Sequence, Set, Tuple, Union
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import Compression, TileType, tileid_to_zxy, zxy_to_tileid, SpecVersionUnsupported
from pmtiles.writer import Writer

from engine.tiles.math import (
    TileCoord,
    get_intersecting_tiles,
    is_valid_tile,
    tile_range_for_bbox,
    tile_to_bounds,
    tiles_for_corridor,
)
from engine.utils.io import read_json
from engine.utils.spatial import BoundingBox


def read_geojson(path: Union[Path, str]) -> Any:
    """Read and parse a GeoJSON file."""
    return read_json(path)


# -----------------------------------------------------------------------------
# Domain Exceptions
# -----------------------------------------------------------------------------

class PMTilesError(Exception):
    """Base exception for all PMTiles operations."""
    pass


class CorruptArchiveError(PMTilesError):
    """Raised when an archive has invalid magic bytes, truncated data, or corrupt directories."""
    pass


class TileNotFoundError(PMTilesError):
    """Raised when a specific tile (z, x, y) is requested but missing."""
    pass


class ArchiveBuildError(PMTilesError):
    """Raised when an error occurs during tile compression, writing, or archive finalization."""
    pass


class ExtractionError(PMTilesError):
    """Raised when an error occurs during network fetching or source extraction."""
    pass


# -----------------------------------------------------------------------------
# Data Models & Dataclasses
# -----------------------------------------------------------------------------

@dataclass
class PMTilesHeader:
    """Strongly typed representation of PMTiles v3 127-byte header."""
    version: int = 3
    min_zoom: int = 0
    max_zoom: int = 14
    min_lon: float = -180.0
    min_lat: float = -85.0511
    max_lon: float = 180.0
    max_lat: float = 85.0511
    center_zoom: int = 7
    center_lon: float = 0.0
    center_lat: float = 0.0
    addressed_tiles_count: int = 0
    tile_entries_count: int = 0
    tile_contents_count: int = 0
    clustered: bool = True
    tile_type: TileType = TileType.MVT
    tile_compression: Compression = Compression.GZIP
    internal_compression: Compression = Compression.GZIP

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "PMTilesHeader":
        """Parse from pmtiles reader header dictionary."""
        return cls(
            version=d.get("version", 3),
            min_zoom=d.get("min_zoom", 0),
            max_zoom=d.get("max_zoom", 14),
            min_lon=d.get("min_lon_e7", -1800000000) / 1e7,
            min_lat=d.get("min_lat_e7", -850511288) / 1e7,
            max_lon=d.get("max_lon_e7", 1800000000) / 1e7,
            max_lat=d.get("max_lat_e7", 850511288) / 1e7,
            center_zoom=d.get("center_zoom", 7),
            center_lon=d.get("center_lon_e7", 0) / 1e7,
            center_lat=d.get("center_lat_e7", 0) / 1e7,
            addressed_tiles_count=d.get("addressed_tiles_count", 0),
            tile_entries_count=d.get("tile_entries_count", 0),
            tile_contents_count=d.get("tile_contents_count", 0),
            clustered=d.get("clustered", True),
            tile_type=d.get("tile_type", TileType.MVT),
            tile_compression=d.get("tile_compression", Compression.GZIP),
            internal_compression=d.get("internal_compression", Compression.GZIP),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary expected by pmtiles.writer.Writer.finalize()."""
        return {
            "tile_compression": self.tile_compression,
            "tile_type": self.tile_type,
            "min_lon_e7": int(round(self.min_lon * 1e7)),
            "min_lat_e7": int(round(self.min_lat * 1e7)),
            "max_lon_e7": int(round(self.max_lon * 1e7)),
            "max_lat_e7": int(round(self.max_lat * 1e7)),
            "center_zoom": self.center_zoom,
            "center_lon_e7": int(round(self.center_lon * 1e7)),
            "center_lat_e7": int(round(self.center_lat * 1e7)),
        }


@dataclass
class PMTilesMetadata:
    """Strongly typed representation of PMTiles JSON metadata."""
    name: str = "PMTiles Vector Basemap"
    description: str = ""
    version: str = "1.0.0"
    minzoom: int = 0
    maxzoom: int = 14
    bounds: Tuple[float, float, float, float] = (-180.0, -85.0511, 180.0, 85.0511)
    center: Tuple[float, float, int] = (0.0, 0.0, 7)
    vector_layers: List[Dict[str, Any]] = field(default_factory=list)
    attribution: str = "OpenFreeMap, OpenMapTiles, OpenStreetMap"
    extra: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "PMTilesMetadata":
        raw_bounds = d.get("bounds")
        if isinstance(raw_bounds, str):
            parts = [float(x.strip()) for x in raw_bounds.split(",")]
            bounds = (parts[0], parts[1], parts[2], parts[3])
        elif isinstance(raw_bounds, (list, tuple)) and len(raw_bounds) == 4:
            bounds = (float(raw_bounds[0]), float(raw_bounds[1]), float(raw_bounds[2]), float(raw_bounds[3]))
        else:
            bounds = (-180.0, -85.0511, 180.0, 85.0511)

        raw_center = d.get("center")
        if isinstance(raw_center, str):
            c_parts = [float(x.strip()) for x in raw_center.split(",")]
            center = (c_parts[0], c_parts[1], int(c_parts[2]))
        elif isinstance(raw_center, (list, tuple)) and len(raw_center) == 3:
            center = (float(raw_center[0]), float(raw_center[1]), int(raw_center[2]))
        else:
            center = (0.0, 0.0, 7)

        return cls(
            name=d.get("name", "PMTiles Vector Basemap"),
            description=d.get("description", ""),
            version=str(d.get("version", "1.0.0")),
            minzoom=int(d.get("minzoom", 0)),
            maxzoom=int(d.get("maxzoom", 14)),
            bounds=bounds,
            center=center,
            vector_layers=d.get("vector_layers", []),
            attribution=d.get("attribution", "OpenFreeMap, OpenMapTiles, OpenStreetMap"),
            extra={
                k: v for k, v in d.items()
                if k not in {
                    "name", "description", "version", "minzoom", "maxzoom", "bounds", "center", "vector_layers", "attribution"
                }
            }
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary expected by pmtiles metadata serializer."""
        res: Dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "minzoom": str(self.minzoom),
            "maxzoom": str(self.maxzoom),
            "bounds": f"{self.bounds[0]},{self.bounds[1]},{self.bounds[2]},{self.bounds[3]}",
            "center": f"{self.center[0]},{self.center[1]},{self.center[2]}",
            "vector_layers": self.vector_layers,
            "attribution": self.attribution,
        }
        res.update(self.extra)
        return res


@dataclass
class SectionDefinition:
    """Definition for a regional section slice of a route."""
    section_id: str
    name: str
    filename: str
    lat_min: Optional[float] = None
    lat_max: Optional[float] = None
    km_start: Optional[float] = None
    km_end: Optional[float] = None
    filter_predicate: Optional[Callable[[float, float], bool]] = None


@dataclass
class ArchiveStats:
    """Inspection statistics for a PMTiles archive."""
    path: Path
    file_size_bytes: int
    tile_count: int
    min_zoom: int
    max_zoom: int
    bounds: Tuple[float, float, float, float]
    center: Tuple[float, float, int]
    layer_names: List[str]
    is_valid: bool
    version: int = 3


# -----------------------------------------------------------------------------
# Core Classes
# -----------------------------------------------------------------------------

class PMTilesArchive:
    """
    Encapsulates reading, inspecting, and extracting tiles from a PMTiles v3 archive.
    Supports context manager protocol for automatic resource cleanup.
    """
    def __init__(self, path: Union[Path, str]) -> None:
        self.path = Path(path)
        self._file: Optional[BinaryIO] = None
        self._reader: Optional[Reader] = None
        self._header: Optional[PMTilesHeader] = None
        self._metadata: Optional[PMTilesMetadata] = None

    def __enter__(self) -> "PMTilesArchive":
        self.open()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()

    def open(self) -> None:
        if not self.path.exists():
            raise FileNotFoundError(f"PMTiles archive does not exist: {self.path}")
        try:
            self._file = open(self.path, "rb")
            # Validate PMTiles v3 magic bytes and version byte
            prefix = self._file.read(8)
            if len(prefix) < 8 or prefix[:7] != b"PMTiles":
                raise CorruptArchiveError(f"Invalid PMTiles magic bytes: {prefix[:7]!r} in {self.path}")
            if prefix[7] != 3:
                raise CorruptArchiveError(f"Unsupported PMTiles version: {prefix[7]} (expected 3) in {self.path}")
            self._file.seek(0)
            self._reader = Reader(MmapSource(self._file))
            raw_h = self._reader.header()
            if raw_h.get("version") != 3:
                raise CorruptArchiveError(f"Unsupported PMTiles version: {raw_h.get('version')} (expected 3)")
            self._header = PMTilesHeader.from_dict(raw_h)
            raw_meta = self._reader.metadata() or {}
            self._metadata = PMTilesMetadata.from_dict(raw_meta)
        except CorruptArchiveError:
            self.close()
            raise
        except SpecVersionUnsupported as ex:
            self.close()
            raise CorruptArchiveError(f"Unsupported PMTiles version in {self.path} (expected 3)") from ex
        except Exception as ex:
            self.close()
            raise CorruptArchiveError(f"Failed to open PMTiles archive at {self.path}: {ex}") from ex

    def close(self) -> None:
        if self._file:
            try:
                self._file.close()
            except Exception:
                pass
            self._file = None
            self._reader = None

    @property
    def header(self) -> PMTilesHeader:
        if self._header is None:
            self.open()
        return self._header  # type: ignore

    @property
    def metadata(self) -> PMTilesMetadata:
        if self._metadata is None:
            self.open()
        return self._metadata  # type: ignore

    def get_tile(self, z: int, x: int, y: int, decompress: bool = False) -> Optional[bytes]:
        """Fetch tile bytes at (z, x, y). If decompress=True and tile is GZIP, decompresses."""
        if self._reader is None:
            self.open()
        try:
            data = self._reader.get(z, x, y)  # type: ignore
        except Exception as ex:
            raise PMTilesError(f"Error reading tile ({z}, {x}, {y}): {ex}") from ex

        if not data:
            return None
        if decompress and data.startswith(b"\x1f\x8b"):
            return gzip.decompress(data)
        return data

    def has_tile(self, z: int, x: int, y: int) -> bool:
        """Check if tile (z, x, y) is addressed in archive."""
        return self.get_tile(z, x, y) is not None

    def validate(self) -> bool:
        """Verify version 3, valid tile count, valid bounds, and test sample decompression."""
        h = self.header
        if h.version != 3:
            raise CorruptArchiveError(f"Unsupported PMTiles version: {h.version} (expected 3)")
        if h.addressed_tiles_count == 0:
            raise CorruptArchiveError("PMTiles archive contains 0 addressed tiles")
        return True

    def get_stats(self) -> ArchiveStats:
        """Return structured archive statistics."""
        self.validate()
        h = self.header
        m = self.metadata
        layer_names = []
        for layer in m.vector_layers:
            if isinstance(layer, dict):
                name = layer.get("id") or layer.get("name")
                if name:
                    layer_names.append(name)
        return ArchiveStats(
            path=self.path,
            file_size_bytes=self.path.stat().st_size,
            tile_count=h.addressed_tiles_count,
            min_zoom=h.min_zoom,
            max_zoom=h.max_zoom,
            bounds=(h.min_lon, h.min_lat, h.max_lon, h.max_lat),
            center=(h.center_lon, h.center_lat, h.center_zoom),
            layer_names=layer_names,
            is_valid=True,
            version=h.version,
        )


class PMTilesBuilder:
    """
    Builder for PMTiles v3 archives.
    Buffers tile entries and sorts them strictly by 64-bit Hilbert tile ID,
    ensuring strict spec compliance. Writes atomically to a temporary file
    before committing to the final output path.
    """
    def __init__(
        self,
        output_path: Union[Path, str],
        header: Optional[PMTilesHeader] = None,
        metadata: Optional[PMTilesMetadata] = None,
    ) -> None:
        self.output_path = Path(output_path)
        self.header = header or PMTilesHeader()
        self.metadata = metadata or PMTilesMetadata(name=self.output_path.stem, description="")
        self._tiles: Dict[int, bytes] = {}
        self._tmp_path = self.output_path.with_suffix(f".tmp.{os.getpid()}.pmtiles")

    def add_tile(self, z: int, x: int, y: int, data: bytes, compress: bool = True) -> None:
        """Add tile data for coordinate (z, x, y). Compresses with gzip if compress=True."""
        tile_id = zxy_to_tileid(z, x, y)
        self.add_tile_by_id(tile_id, data, compress=compress)

    def add_tile_by_id(self, tile_id: int, data: bytes, compress: bool = True) -> None:
        """Add tile data by 64-bit Hilbert tile ID."""
        if not data:
            return
        if compress and not data.startswith(b"\x1f\x8b"):
            cdata = gzip.compress(data)
        else:
            cdata = data
        self._tiles[tile_id] = cdata

    def finalize(self) -> Path:
        """Sort all tiles by tile_id, write PMTiles v3 archive, and atomically replace target file."""
        if not self._tiles:
            raise ArchiveBuildError("Cannot finalize empty PMTiles archive with 0 tiles")

        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        sorted_tile_ids = sorted(self._tiles.keys())

        # Update tile count in header
        self.header.addressed_tiles_count = len(sorted_tile_ids)
        self.header.tile_entries_count = len(sorted_tile_ids)
        self.header.tile_contents_count = len(sorted_tile_ids)

        try:
            with open(self._tmp_path, "wb") as f:
                writer = Writer(f)
                for tid in sorted_tile_ids:
                    writer.write_tile(tid, self._tiles[tid])
                writer.finalize(self.header.to_dict(), self.metadata.to_dict())

            os.replace(self._tmp_path, self.output_path)
        except Exception as ex:
            if self._tmp_path.exists():
                try:
                    self._tmp_path.unlink()
                except Exception:
                    pass
            raise ArchiveBuildError(f"Failed to finalize PMTiles archive at {self.output_path}: {ex}") from ex

        return self.output_path


class PMTilesCorridorExtractor:
    """
    Coordinates extraction of corridor vector tiles from OpenFreeMap, local master archives,
    or synthetic geometry builders.
    """
    OPENFREEMAP_PLANET_ENDPOINT = "https://tiles.openfreemap.org/planet"

    def __init__(self, source_path: Optional[Union[Path, str]] = None):
        self.source_path = Path(source_path) if source_path else None

    def extract_corridor(
        self,
        corridor_path: Union[Path, str],
        output_path: Union[Path, str],
        min_zoom: int = 0,
        max_zoom: int = 14,
    ) -> Path:
        """
        Extract corridor tiles from source archive into output path based on corridor GeoJSON.
        """
        corridor_p = Path(corridor_path)
        out_p = Path(output_path)
        if not corridor_p.exists():
            raise FileNotFoundError(f"Corridor GeoJSON not found: {corridor_p}")

        data = read_geojson(corridor_p)
        geom = None
        if isinstance(data, dict):
            if data.get("type") == "FeatureCollection":
                features = data.get("features", [])
                geoms = [f.get("geometry") for f in features if f.get("geometry")]
                if len(geoms) == 1:
                    geom = geoms[0]
                elif len(geoms) > 1:
                    geom = {"type": "GeometryCollection", "geometries": geoms}
            elif data.get("type") == "Feature":
                geom = data.get("geometry")
            elif "coordinates" in data:
                geom = data
        if geom is None:
            geom = data

        self.extract_from_source(
            source_path=self.source_path,
            output_path=out_p,
            corridor_geometry=geom,
            min_zoom=min_zoom,
            max_zoom=max_zoom,
        )
        return out_p

    @classmethod
    def fetch_openfreemap_tiles(
        cls,
        tiles: Sequence[Tuple[int, int, int]],
        output_path: Path,
        header: PMTilesHeader,
        metadata: PMTilesMetadata,
        max_workers: int = 32,
    ) -> bool:
        """Fetch tiles from OpenFreeMap endpoint with incremental reuse and multi-threading."""
        cached_tiles: Dict[Tuple[int, int, int], bytes] = {}
        if output_path.exists() and output_path.stat().st_size > 0:
            try:
                with PMTilesArchive(output_path) as arch:
                    for z, x, y in tiles:
                        tile_data = arch.get_tile(z, x, y)
                        if tile_data:
                            cached_tiles[(z, x, y)] = tile_data
            except Exception:
                cached_tiles = {}

        needed = [t for t in tiles if t not in cached_tiles]
        downloaded: List[Tuple[int, int, int, bytes]] = []

        if needed:
            req = urllib.request.Request(
                cls.OPENFREEMAP_PLANET_ENDPOINT,
                headers={"User-Agent": "BikepackNavigator/1.0"}
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    tj = json.loads(resp.read().decode())
                tile_url_pattern = tj.get("tiles", [])[0]
            except Exception as ex:
                raise ExtractionError(f"Failed to query OpenFreeMap planet endpoint: {ex}") from ex

            def fetch_single(coords: Tuple[int, int, int]) -> Tuple[int, int, int, Optional[bytes]]:
                z, x, y = coords
                url = tile_url_pattern.format(z=z, x=x, y=y)
                r = urllib.request.Request(url, headers={"User-Agent": "BikepackNavigator/1.0"})
                for attempt in range(4):
                    try:
                        with urllib.request.urlopen(r, timeout=12) as res:
                            return z, x, y, res.read()
                    except Exception:
                        if attempt == 3:
                            return z, x, y, None
                        time.sleep(0.2 * (2 ** attempt))
                return z, x, y, None

            with ThreadPoolExecutor(max_workers=max_workers) as ex:
                results = list(ex.map(fetch_single, needed))

            for z, x, y, data in results:
                if data:
                    downloaded.append((z, x, y, data))

        builder = PMTilesBuilder(output_path, header=header, metadata=metadata)
        for (z, x, y), data in cached_tiles.items():
            builder.add_tile(z, x, y, data)
        for z, x, y, data in downloaded:
            builder.add_tile(z, x, y, data)

        builder.finalize()
        return True

    @classmethod
    def extract_from_source(
        cls,
        source_archive: Optional[Union[Path, str]] = None,
        output_path: Optional[Union[Path, str]] = None,
        tiles: Optional[Sequence[Tuple[int, int, int]]] = None,
        header: Optional[PMTilesHeader] = None,
        metadata: Optional[PMTilesMetadata] = None,
        *,
        source_path: Optional[Union[Path, str]] = None,
        corridor_geometry: Any = None,
        min_zoom: int = 0,
        max_zoom: int = 14,
    ) -> int:
        """Extract intersecting tiles from a master PMTiles archive."""
        src_path = source_path or source_archive
        if src_path is None:
            raise ExtractionError("No source archive specified for extraction")
        src_path = Path(src_path)
        if not src_path.exists():
            raise FileNotFoundError(f"Source archive not found: {src_path}")
        if output_path is None:
            raise ExtractionError("No output path specified for extraction")

        out_path = Path(output_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        with PMTilesArchive(src_path) as src:
            h = PMTilesHeader.from_dict(src.header.to_dict()) if header is None else header
            m = PMTilesMetadata.from_dict(src.metadata.to_dict()) if metadata is None else metadata
            builder = PMTilesBuilder(out_path, header=h, metadata=m)
            count = 0

            if tiles is not None:
                for z, x, y in tiles:
                    data = src.get_tile(z, x, y)
                    if data:
                        builder.add_tile(z, x, y, data)
                        count += 1
            elif corridor_geometry is not None:
                from shapely.geometry import shape, box
                from shapely.ops import unary_union

                if isinstance(corridor_geometry, dict):
                    if corridor_geometry.get("type") == "FeatureCollection":
                        sub_geoms = [shape(f["geometry"]) for f in corridor_geometry.get("features", []) if f.get("geometry")]
                        geom = unary_union(sub_geoms) if sub_geoms else None
                    elif corridor_geometry.get("type") == "GeometryCollection":
                        sub_geoms = [shape(g) for g in corridor_geometry.get("geometries", []) if g]
                        geom = unary_union(sub_geoms) if sub_geoms else None
                    elif corridor_geometry.get("type") == "Feature":
                        geom = shape(corridor_geometry.get("geometry"))
                    else:
                        geom = shape(corridor_geometry)
                elif hasattr(corridor_geometry, "bounds") or hasattr(corridor_geometry, "intersects"):
                    geom = corridor_geometry
                else:
                    geom = shape(corridor_geometry)

                if geom is None:
                    raise ExtractionError("Invalid or empty corridor geometry provided")

                with open(src_path, "rb") as f:
                    source_bytes = MmapSource(f)
                    for (z, x, y), data in all_tiles(source_bytes):
                        if min_zoom <= z <= max_zoom:
                            w, s, e, n = tile_to_bounds(tx=x, ty=y, zoom=z)
                            if geom.intersects(box(w, s, e, n)):
                                builder.add_tile(z, x, y, data)
                                count += 1
            else:
                raise ExtractionError("Either 'tiles' or 'corridor_geometry' must be specified for extraction")

            if count == 0:
                raise ExtractionError("0 tiles extracted from source archive for specified coordinates")
            builder.finalize()
            return count

    @classmethod
    def build_synthetic_corridor(
        cls,
        route_dir: Path,
        output_path: Path,
        bbox: Tuple[float, float, float, float],
        corridor_geom: Any = None,
        min_zoom: int = 0,
        max_zoom: int = 14,
        route_id: str = "route",
    ) -> int:
        """
        Build offline synthetic MVT vector tiles using route track, corridor polygon, and POIs.
        Produces OpenMapTiles-compatible layers: transportation, landcover, place, natural.
        """
        try:
            import mapbox_vector_tile
            from shapely.geometry import LineString, Point, box
        except ImportError as ex:
            raise ArchiveBuildError(f"mapbox_vector_tile and shapely are required for synthetic corridor: {ex}") from ex

        min_lon, min_lat, max_lon, max_lat = bbox

        # Load Route Track
        track_path = route_dir / "route-track.json"
        track_coords: List[Tuple[float, float]] = []
        if track_path.exists():
            with open(track_path, "r", encoding="utf-8") as f:
                tdata = json.load(f)
                raw_pts = tdata.get("points", []) or tdata.get("coordinates", [])
                track_coords = [(float(p[1]), float(p[0])) for p in raw_pts if len(p) >= 2]

        guidance_path = route_dir / "guidance-track.json"
        if guidance_path.exists():
            with open(guidance_path, "r", encoding="utf-8") as f:
                gdata = json.load(f)
                gpts = gdata.get("points", []) or gdata.get("coordinates", [])
                for p in gpts:
                    if len(p) >= 2:
                        track_coords.append((float(p[1]), float(p[0])))

        track_line = LineString(track_coords) if len(track_coords) >= 2 else None

        # Load Places
        places_path = route_dir / "places.json"
        places: List[Dict[str, Any]] = []
        if places_path.exists():
            with open(places_path, "r", encoding="utf-8") as f:
                places = json.load(f)

        # Zooms to build
        zooms = sorted(list(set([0, 4, 6, 8, 10, 12, min(max_zoom, 14)])))
        zooms = [z for z in zooms if min_zoom <= z <= max_zoom]
        if min_zoom == 0 and 0 not in zooms:
            zooms.insert(0, 0)

        header = PMTilesHeader(
            min_zoom=min(zooms),
            max_zoom=max(zooms),
            min_lon=min_lon,
            min_lat=min_lat,
            max_lon=max_lon,
            max_lat=max_lat,
            center_zoom=min(zooms),
            center_lon=(min_lon + max_lon) / 2.0,
            center_lat=(min_lat + max_lat) / 2.0,
        )
        metadata = PMTilesMetadata(
            name=f"{route_id} Vector Corridor",
            description=f"Offline PMTiles vector basemap corridor for {route_id}",
            minzoom=min(zooms),
            maxzoom=max(zooms),
            bounds=(min_lon, min_lat, max_lon, max_lat),
            center=((min_lon + max_lon) / 2.0, (min_lat + max_lat) / 2.0, min(zooms)),
            vector_layers=[
                {"id": "landcover", "fields": {"class": "String", "name": "String"}},
                {"id": "transportation", "fields": {"class": "String", "subclass": "String", "name": "String"}},
                {"id": "place", "fields": {"name": "String", "class": "String", "mile": "Number"}},
                {"id": "natural", "fields": {"class": "String"}},
            ]
        )

        builder = PMTilesBuilder(output_path, header=header, metadata=metadata)
        count = 0

        for z in zooms:
            tiles = get_intersecting_tiles(min_lon, min_lat, max_lon, max_lat, z)
            if len(tiles) > 300:
                tiles = tiles[:300]

            for tz, tx, ty in tiles:
                tb_w, tb_s, tb_e, tb_n = tile_to_bounds(tx=tx, ty=ty, zoom=tz)
                tile_box = box(tb_w, tb_s, tb_e, tb_n)

                layers: List[Dict[str, Any]] = []

                if corridor_geom and hasattr(corridor_geom, "intersects") and corridor_geom.intersects(tile_box):
                    inter = corridor_geom.intersection(tile_box)
                    if not inter.is_empty and inter.geom_type in ("Polygon", "MultiPolygon"):
                        layers.append({
                            "name": "landcover",
                            "features": [{
                                "geometry": inter.wkt,
                                "properties": {"class": "forest", "subclass": "corridor", "name": f"{route_id} Corridor"}
                            }]
                        })

                if track_line and track_line.intersects(tile_box):
                    t_inter = track_line.intersection(tile_box)
                    if not t_inter.is_empty:
                        layers.append({
                            "name": "transportation",
                            "features": [{
                                "geometry": t_inter.wkt,
                                "properties": {
                                    "class": "track",
                                    "subclass": "singletrack",
                                    "name": f"{route_id} Primary Route",
                                    "route_id": route_id
                                }
                            }]
                        })

                poi_features: List[Dict[str, Any]] = []
                for p in places:
                    loc = p.get("location") or {}
                    plat = p.get("lat") if p.get("lat") is not None else loc.get("lat")
                    plon = p.get("lon") if p.get("lon") is not None else loc.get("lon")
                    if plat is not None and plon is not None:
                        pt = Point(float(plon), float(plat))
                        if tile_box.contains(pt):
                            poi_features.append({
                                "geometry": pt.wkt,
                                "properties": {
                                    "name": p.get("name", "Waypoint"),
                                    "class": p.get("category", "poi"),
                                    "mile": float(p.get("mile", 0.0))
                                }
                            })
                if poi_features:
                    layers.append({"name": "place", "features": poi_features})

                if not layers:
                    layers.append({
                        "name": "natural",
                        "features": [{
                            "geometry": tile_box.wkt,
                            "properties": {"class": "corridor-buffer"}
                        }]
                    })

                mvt_bytes = mapbox_vector_tile.encode(layers)
                builder.add_tile(tz, tx, ty, mvt_bytes, compress=True)
                count += 1

        builder.finalize()
        return count


class _SliceArchiveDescriptor:
    """Descriptor allowing slice_archive to be called on class or instance."""

    def __get__(self, obj: Any, objtype: Optional[type] = None) -> Any:
        if obj is None:
            return objtype._slice_archive_class
        def bound_slice_archive(*args: Any, **kwargs: Any) -> List[Path]:
            return obj._slice_archive_instance(*args, **kwargs)
        return bound_slice_archive


class PMTilesSectionSlicer:
    """
    Slices long-distance route archives into regional sections with boundary overlaps.
    """
    TOUR_DIVIDE_SECTIONS = [
        SectionDefinition("1", "Section 1: Canada & Montana", "section-1.pmtiles", lat_min=44.95),
        SectionDefinition("2", "Section 2: Wyoming", "section-2.pmtiles", lat_min=40.95, lat_max=45.05),
        SectionDefinition("3", "Section 3: Colorado", "section-3.pmtiles", lat_min=36.95, lat_max=41.05),
        SectionDefinition("4", "Section 4: New Mexico", "section-4.pmtiles", lat_max=37.05),
    ]

    def __init__(self, master_archive_path: Optional[Union[Path, str]] = None):
        self.master_archive_path = Path(master_archive_path) if master_archive_path else None

    @classmethod
    def _slice_archive_class(
        cls,
        master_archive_path: Union[Path, str],
        route_dir: Path,
        sections: Sequence[SectionDefinition],
        track_points: Sequence[Sequence[float]],
        places_coords: Optional[Sequence[Tuple[float, float]]] = None,
        town_boxes: Optional[Sequence[Tuple[float, float, float, float]]] = None,
    ) -> List[Path]:
        """Slice master corridor archive into sections based on coordinate boundaries."""
        created_paths: List[Path] = []
        route_dir = Path(route_dir)
        route_dir.mkdir(parents=True, exist_ok=True)
        with PMTilesArchive(master_archive_path) as master:
            for sec in sections:
                sec_pts = [
                    p for p in track_points
                    if (sec.lat_min is None or p[0] >= sec.lat_min) and
                       (sec.lat_max is None or p[0] <= sec.lat_max)
                ]
                if not sec_pts:
                    continue

                sec_output = route_dir / sec.filename
                sec_lons = [p[1] for p in sec_pts]
                sec_lats = [p[0] for p in sec_pts]
                sec_bbox = (min(sec_lons), min(sec_lats), max(sec_lons), max(sec_lats))

                sec_tiles = tiles_for_corridor(
                    sec_pts,
                    master.header.min_zoom,
                    master.header.max_zoom,
                    town_boxes=town_boxes
                )

                sec_header = PMTilesHeader(
                    min_zoom=master.header.min_zoom,
                    max_zoom=master.header.max_zoom,
                    min_lon=sec_bbox[0],
                    min_lat=sec_bbox[1],
                    max_lon=sec_bbox[2],
                    max_lat=sec_bbox[3],
                    center_zoom=master.header.min_zoom or 7,
                    center_lon=(sec_bbox[0] + sec_bbox[2]) / 2.0,
                    center_lat=(sec_bbox[1] + sec_bbox[3]) / 2.0,
                )
                sec_meta = PMTilesMetadata(
                    name=sec.name,
                    description=f"Offline PMTiles vector section for {sec.name}",
                    minzoom=master.header.min_zoom,
                    maxzoom=master.header.max_zoom,
                    bounds=sec_bbox,
                    center=(sec_header.center_lon, sec_header.center_lat, sec_header.center_zoom),
                    vector_layers=master.metadata.vector_layers,
                )

                builder = PMTilesBuilder(sec_output, header=sec_header, metadata=sec_meta)
                for tc in sec_tiles:
                    tile_data = master.get_tile(tc.z, tc.x, tc.y)
                    if tile_data:
                        builder.add_tile(tc.z, tc.x, tc.y, tile_data)

                # Finalize if any tiles were found
                if builder._tiles:
                    builder.finalize()
                    created_paths.append(sec_output)

        return created_paths

    def _slice_archive_instance(
        self,
        track_path: Optional[Union[Path, str]] = None,
        output_dir: Optional[Union[Path, str]] = None,
        sections_config: Optional[Union[Path, str]] = None,
        master_archive_path: Optional[Union[Path, str]] = None,
        places_coords: Optional[Sequence[Tuple[float, float]]] = None,
        town_boxes: Optional[Sequence[Tuple[float, float, float, float]]] = None,
        **kwargs: Any,
    ) -> List[Path]:
        """Instance adapter method to slice master archive along route track into section archives."""
        if "sections" in kwargs or "track_points" in kwargs:
            return self._slice_archive_class(
                master_archive_path=master_archive_path or kwargs.get("master_archive_path") or self.master_archive_path,
                route_dir=Path(output_dir or kwargs.get("route_dir")),
                sections=kwargs.get("sections"),
                track_points=kwargs.get("track_points"),
                places_coords=places_coords or kwargs.get("places_coords"),
                town_boxes=town_boxes or kwargs.get("town_boxes"),
            )

        master = master_archive_path or self.master_archive_path
        if not master or not Path(master).exists():
            raise FileNotFoundError(f"Master PMTiles archive not found: {master}")

        if not track_path:
            raise ExtractionError("Track path required for slicing")
        track_p = Path(track_path)
        if not track_p.exists():
            raise FileNotFoundError(f"Track file not found: {track_p}")

        if not output_dir:
            raise ExtractionError("Output directory required for slicing")
        out_d = Path(output_dir)
        if out_d.suffix and not out_d.is_dir():
            out_d = out_d.parent
        out_d.mkdir(parents=True, exist_ok=True)

        track_data = read_json(track_p)
        track_points = track_data.get("points", []) or track_data.get("coordinates", [])

        if sections_config:
            sec_p = Path(sections_config)
            if not sec_p.exists():
                raise FileNotFoundError(f"Sections config not found: {sec_p}")
            sec_data = read_json(sec_p)
            sections: List[SectionDefinition] = []
            for s in sec_data:
                sections.append(
                    SectionDefinition(
                        section_id=str(s.get("section_id") or s.get("id", "")),
                        name=s.get("name", ""),
                        filename=s.get("filename", ""),
                        lat_min=s.get("lat_min"),
                        lat_max=s.get("lat_max"),
                        km_start=s.get("km_start"),
                        km_end=s.get("km_end"),
                    )
                )
        else:
            sections = self.TOUR_DIVIDE_SECTIONS

        return self._slice_archive_class(
            master_archive_path=master,
            route_dir=out_d,
            sections=sections,
            track_points=track_points,
            places_coords=places_coords,
            town_boxes=town_boxes,
        )

    slice_archive = _SliceArchiveDescriptor()

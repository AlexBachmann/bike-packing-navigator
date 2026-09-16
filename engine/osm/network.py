"""
engine.osm.network - OpenStreetMap road and trail network representation, spatial indexing, and topology graph.

Provides:
1. Strong domain dataclasses: OsmNode, OsmWaySegment, OsmWay, and WayCandidate.
2. 2D uniform spatial hash grid indexing (~500m cells) for sub-millisecond nearest-way queries.
3. Multi-format ingestion: Overpass JSON (out geom or node-referenced), PMTiles vector tiles, and GeoJSON.
4. Bikepacking preference weighting with mathematical distance bounds.
5. Topological way adjacency discovery, junction connectivity, and Dijkstra shortest path geometry extraction.
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
import heapq
import math
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Set, Tuple, Union

from engine.utils.geo import (
    deflection_angle,
    dist_point_to_segment_m,
    haversine_distance_m,
    initial_bearing,
)

# Standardized bikepacking preference penalties in meters
CLASS_PENALTIES: Dict[str, float] = {
    'track': 0.0,
    'path': 0.0,
    'cycleway': 0.5,
    'bridleway': 0.5,
    'footway': 0.5,
    'pedestrian': 0.5,
    'unclassified': 0.5,
    'living_street': 1.0,
    'service': 1.5,
    'residential': 1.5,
    'tertiary': 2.0,
    'tertiary_link': 2.0,
    'minor': 2.0,
    'secondary': 3.0,
    'secondary_link': 3.0,
    'primary': 4.5,
    'primary_link': 4.5,
    'trunk': 6.0,
    'trunk_link': 6.0,
    'motorway': 15.0,
    'motorway_link': 15.0,
}


@dataclass
class OsmNode:
    """Represents a point node in OpenStreetMap."""
    id: int
    lat: float
    lon: float
    tags: Dict[str, str] = field(default_factory=dict)


@dataclass
class OsmWaySegment:
    """Represents a 2-point directional segment of an OSM way."""
    way_id: int
    seg_idx: int
    lat1: float
    lon1: float
    lat2: float
    lon2: float
    length_m: float
    highway: str
    penalty_m: float

    @property
    def bearing(self) -> float:
        """Initial forward bearing from start to end of segment."""
        return initial_bearing(self.lat1, self.lon1, self.lat2, self.lon2)


@dataclass
class OsmWay:
    """
    Represents an OpenStreetMap highway, trail, or track with full geometry and tags.
    Provides dictionary compatibility for backward compatibility with legacy scripts.
    """
    id: int
    nodes: List[int]
    coords: List[Tuple[float, float]]  # List of (lat, lon)
    tags: Dict[str, str] = field(default_factory=dict)

    @property
    def name(self) -> str:
        return self.tags.get("name") or self.tags.get("name:en") or self.tags.get("ref") or ""

    @property
    def highway(self) -> str:
        return self.tags.get("highway") or self.tags.get("class") or ""

    @property
    def surface(self) -> Optional[str]:
        return self.tags.get("surface")

    @property
    def tracktype(self) -> Optional[str]:
        return self.tags.get("tracktype")

    @property
    def smoothness(self) -> Optional[str]:
        return self.tags.get("smoothness")

    @property
    def access(self) -> Optional[str]:
        return self.tags.get("access")

    @property
    def bicycle(self) -> Optional[str]:
        return self.tags.get("bicycle")

    @property
    def is_cyclable(self) -> bool:
        non_cyclable = {"motorway", "motorway_link", "proposed", "construction", "abandoned"}
        access_no = self.access in ("no", "private") and self.bicycle not in ("yes", "designated", "permissive")
        return (self.highway not in non_cyclable) and not access_no

    @property
    def penalty_m(self) -> float:
        base = CLASS_PENALTIES.get(self.highway, 2.0)
        if self.access in ("no", "private") and self.bicycle not in ("yes", "designated", "permissive"):
            base += 30.0
        return base

    # Dictionary compatibility for legacy scripts
    def __getitem__(self, key: str) -> Any:
        if key in ("class", "highway"):
            return self.highway
        elif key == "penalty":
            return self.penalty_m
        elif key == "coords":
            return self.coords
        elif key == "tags":
            return self.tags
        elif key == "id":
            return self.id
        elif key == "nodes":
            return self.nodes
        elif key == "name":
            return self.name
        elif key in self.tags:
            return self.tags[key]
        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self[key]
        except KeyError:
            return default

    def __contains__(self, key: str) -> bool:
        return key in ("class", "highway", "penalty", "coords", "tags", "id", "nodes", "name") or (key in self.tags)


@dataclass
class WayCandidate:
    """
    Represents a projected candidate on an OSM road segment or off-road fallback.
    Provides dictionary compatibility for seamless interoperability with legacy scripts.
    """
    way_id: int                    # Index or ID of the OSM way (-1 for fallback)
    seg_idx: int                   # Index of segment within way (-1 for fallback)
    dist_m: float                  # Geodesic perpendicular distance to segment
    eff_dist_m: float              # Effective distance including penalties
    proj_lat: float                # Projected latitude
    proj_lon: float                # Projected longitude
    t: float                       # Parametric progress [0.0, 1.0] along segment
    highway: str                   # Highway tag or classification
    is_fallback: bool = False      # True if raw GPX off-road fallback
    tags: Dict[str, Any] = field(default_factory=dict)
    bearing_deflection_deg: float = 0.0

    @property
    def eff_dist(self) -> float:
        """Alias for eff_dist_m for backward compatibility."""
        return self.eff_dist_m

    @property
    def way_idx(self) -> int:
        """Alias for way_id for backward compatibility."""
        return self.way_id

    # Dictionary compatibility
    def __getitem__(self, key: str) -> Any:
        if key in ("way_idx", "way_id"):
            return self.way_id
        elif key == "seg_idx":
            return self.seg_idx
        elif key == "dist_m":
            return self.dist_m
        elif key in ("eff_dist", "eff_dist_m"):
            return self.eff_dist_m
        elif key == "proj_lat":
            return self.proj_lat
        elif key == "proj_lon":
            return self.proj_lon
        elif key == "t":
            return self.t
        elif key in ("class", "highway"):
            return self.highway
        elif key == "is_fallback":
            return self.is_fallback
        elif key == "tags":
            return self.tags
        elif key == "bearing_deflection_deg":
            return self.bearing_deflection_deg
        elif key in self.tags:
            return self.tags[key]
        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self[key]
        except KeyError:
            return default

    def __contains__(self, key: str) -> bool:
        return key in (
            "way_idx", "way_id", "seg_idx", "dist_m", "eff_dist", "eff_dist_m",
            "proj_lat", "proj_lon", "t", "class", "highway", "is_fallback", "tags",
            "bearing_deflection_deg"
        ) or (key in self.tags)


class OsmRoadNetwork:
    """
    In-memory topological way graph and spatial index for OSM transportation features.

    Indexes ways using a 2D uniform spatial hash grid (default cell size: 0.005 deg ~ 500m)
    for $O(1)$ candidate lookups during road snapping.
    """

    def __init__(
        self,
        pmtiles_path: Optional[Union[Path, str]] = None,
        cell_size_deg: float = 0.005
    ):
        self.pmtiles_path = Path(pmtiles_path) if pmtiles_path else None
        self.grid_size = cell_size_deg
        self.ways: List[OsmWay] = []
        self.ways_by_id: Dict[int, OsmWay] = {}
        self.nodes: Dict[int, OsmNode] = {}
        self.segments: List[OsmWaySegment] = []
        # Spatial hash grid: (gx, gy) -> List of (way_idx, seg_idx)
        self.grid: Dict[Tuple[int, int], List[Tuple[int, int]]] = defaultdict(list)
        # Topological adjacency graph: way_idx -> Set of connected way_idx
        self.adjacency: Dict[int, Set[int]] = defaultdict(set)
        # Connection metadata: way_idx1 -> way_idx2 -> (v_idx1, v_idx2, distance_m)
        self.connections: Dict[int, Dict[int, Tuple[int, int, float]]] = defaultdict(dict)

    def add_way(self, way: Union[OsmWay, Dict[str, Any]]) -> int:
        """
        Add a way to the network and index its segments in the spatial hash grid.

        Returns:
            Internal integer index of the newly added way.
        """
        if isinstance(way, dict):
            coords = way.get("coords", [])
            w_id = way.get("id", len(self.ways))
            hw = way.get("class") or way.get("highway", "track")
            tags = way.get("tags", {})
            if "highway" not in tags:
                tags["highway"] = hw
            if "penalty" in way and "penalty" not in tags:
                tags["_penalty"] = str(way["penalty"])
            osm_way = OsmWay(
                id=w_id,
                nodes=way.get("nodes", []),
                coords=[(float(c[0]), float(c[1])) for c in coords],
                tags=tags
            )
        else:
            osm_way = way

        way_idx = len(self.ways)
        self.ways.append(osm_way)
        self.ways_by_id[osm_way.id] = osm_way

        coords = osm_way.coords
        for seg_i in range(len(coords) - 1):
            lat1, lon1 = coords[seg_i]
            lat2, lon2 = coords[seg_i + 1]
            seg_len = haversine_distance_m(lat1, lon1, lat2, lon2)
            seg = OsmWaySegment(
                way_id=way_idx,
                seg_idx=seg_i,
                lat1=lat1,
                lon1=lon1,
                lat2=lat2,
                lon2=lon2,
                length_m=seg_len,
                highway=osm_way.highway,
                penalty_m=osm_way.penalty_m
            )
            self.segments.append(seg)

            gx1 = int(math.floor(lon1 / self.grid_size))
            gy1 = int(math.floor(lat1 / self.grid_size))
            gx2 = int(math.floor(lon2 / self.grid_size))
            gy2 = int(math.floor(lat2 / self.grid_size))

            min_gx, max_gx = min(gx1, gx2), max(gx1, gx2)
            min_gy, max_gy = min(gy1, gy2), max(gy1, gy2)

            for gx in range(min_gx, max_gx + 1):
                for gy in range(min_gy, max_gy + 1):
                    self.grid[(gx, gy)].append((way_idx, seg_i))

        return way_idx

    def load_from_overpass_json(self, data: Dict[str, Any]) -> int:
        """
        Parse Overpass JSON data and populate the road network.
        Handles both `out geom;` (embedded geometry) and node-referenced ways.

        Returns:
            Count of ways successfully indexed.
        """
        elements = data.get("elements", [])
        if not elements:
            return 0

        # First pass: index nodes if present
        nodes_dict: Dict[int, Tuple[float, float]] = {}
        for el in elements:
            if el.get("type") == "node" and "id" in el and "lat" in el and "lon" in el:
                nodes_dict[el["id"]] = (float(el["lat"]), float(el["lon"]))
                self.nodes[el["id"]] = OsmNode(
                    id=el["id"],
                    lat=float(el["lat"]),
                    lon=float(el["lon"]),
                    tags=el.get("tags", {})
                )

        added = 0
        # Second pass: construct ways
        for el in elements:
            if el.get("type") != "way":
                continue

            tags = el.get("tags", {})
            hw = tags.get("highway")
            if not hw:
                continue

            coords: List[Tuple[float, float]] = []
            node_ids = el.get("nodes", [])

            # Format 1: `out geom;` with embedded geometry list
            if "geometry" in el:
                coords = [(float(pt["lat"]), float(pt["lon"])) for pt in el["geometry"]]
            # Format 2: Node references
            elif node_ids and nodes_dict:
                coords = [nodes_dict[nid] for nid in node_ids if nid in nodes_dict]

            if len(coords) < 2:
                continue

            osm_way = OsmWay(
                id=int(el.get("id", len(self.ways))),
                nodes=node_ids,
                coords=coords,
                tags=tags
            )
            self.add_way(osm_way)
            added += 1

        self.build_adjacency()
        return added

    def load_from_geojson(self, data: Dict[str, Any]) -> int:
        """
        Parse GeoJSON FeatureCollection of LineString or MultiLineString features.

        Returns:
            Count of ways indexed.
        """
        features = data.get("features", [])
        added = 0
        for f in features:
            geom = f.get("geometry", {})
            g_type = geom.get("type")
            props = f.get("properties", {})
            f_id = f.get("id", len(self.ways))

            if g_type == "LineString":
                coords = [(float(c[1]), float(c[0])) for c in geom.get("coordinates", [])]
                if len(coords) >= 2:
                    self.add_way(OsmWay(id=int(f_id), nodes=[], coords=coords, tags=props))
                    added += 1
            elif g_type == "MultiLineString":
                for sub_line in geom.get("coordinates", []):
                    coords = [(float(c[1]), float(c[0])) for c in sub_line]
                    if len(coords) >= 2:
                        self.add_way(OsmWay(id=int(f_id), nodes=[], coords=coords, tags=props))
                        added += 1

        self.build_adjacency()
        return added

    def load_from_pmtiles(
        self,
        pmtiles_path: Optional[Union[Path, str, Sequence[Union[Path, str]]]] = None,
        track_points: Optional[Sequence[Sequence[float]]] = None,
        threshold_m: float = 50.0
    ) -> int:
        """
        Extract transportation features from corridor PMTiles at zoom 14 along the route track.
        Supports single PMTiles archive, directory of section archives, or list of archives.
        """
        target = pmtiles_path or self.pmtiles_path
        if not target:
            return 0

        target_paths: List[Path] = []
        if isinstance(target, (list, tuple, set)):
            for p in target:
                p_p = Path(p)
                if p_p.is_dir():
                    target_paths.extend(sorted(p_p.glob("*.pmtiles")))
                elif p_p.exists():
                    target_paths.append(p_p)
        else:
            p_p = Path(target)
            if p_p.is_dir():
                target_paths.extend(sorted(p_p.glob("*.pmtiles")))
            elif p_p.exists():
                target_paths.append(p_p)

        if not target_paths:
            return 0

        try:
            from pmtiles.reader import Reader, MmapSource
            import mapbox_vector_tile
            from shapely.geometry import LineString
            from shapely.ops import linemerge
            from engine.utils.tiles import get_intersecting_tiles, mvt_pixel_to_lonlat
            from engine.utils.spatial import BoundingBox
        except ImportError:
            return 0

        zoom = 14
        if track_points:
            from engine.utils.tiles import lonlat_to_tile
            tile_set = set()
            for p in track_points:
                tile_set.add(lonlat_to_tile(float(p[1]), float(p[0]), zoom))
            tiles = sorted(tile_set)
        else:
            query_bbox = BoundingBox(-85.0, -180.0, 85.0, 180.0)
            tiles = get_intersecting_tiles(query_bbox, zoom)

        ways_by_osm_id: Dict[int, Dict[str, Any]] = defaultdict(lambda: {'class': 'track', 'props': {}, 'segments': []})

        for p_path in target_paths:
            with open(p_path, "rb") as f:
                source = MmapSource(f)
                reader = Reader(source)

                for item in tiles:
                    if len(item) == 3:
                        z, x, y = item
                    else:
                        z, (x, y) = zoom, item
                    tile_bytes = reader.get(z, x, y)
                    if not tile_bytes:
                        continue

                    try:
                        if tile_bytes.startswith(b"\x1f\x8b"):
                            import gzip
                            tile_bytes = gzip.decompress(tile_bytes)
                        tile_data = mapbox_vector_tile.decode(tile_bytes)
                    except Exception:
                        continue

                    for layer_name in ("transportation", "road", "lines"):
                        layer = tile_data.get(layer_name)
                        if not layer:
                            continue

                        extent = layer.get('extent', 4096)
                        n = 2.0 ** z
                        inv_extent = 1.0 / extent
                        inv_n = 1.0 / n
                        factor_lon = 360.0 / n
                        offset_lon = (x / n) * 360.0 - 180.0
                        px_to_lon = factor_lon * inv_extent

                        for feat in layer.get('features', []):
                            props = feat.get('properties', {})
                            h_class = props.get('highway') or props.get('class')
                            if not h_class:
                                continue
                            if h_class in ('rail', 'transit', 'aerialway', 'ferry'):
                                continue

                            osm_id = props.get('osm_id', feat.get('id', 0))
                            geom = feat.get('geometry', {})
                            g_type = geom.get('type')
                            coords_raw = geom.get('coordinates', [])

                            if g_type == 'LineString':
                                lines = [coords_raw]
                            elif g_type == 'MultiLineString':
                                lines = coords_raw
                            else:
                                continue

                            for line in lines:
                                if len(line) < 2:
                                    continue
                                wgs_coords = []
                                for px, py in line:
                                    lon = offset_lon + px * px_to_lon
                                    y_norm = y + py * inv_extent
                                    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y_norm * inv_n))))
                                    wgs_coords.append((lat, lon))

                                ways_by_osm_id[osm_id]['class'] = h_class
                                ways_by_osm_id[osm_id]['props'] = props
                                ways_by_osm_id[osm_id]['segments'].append(wgs_coords)

        added = 0
        for osm_id, way_info in ways_by_osm_id.items():
            segs = way_info['segments']
            if not segs:
                continue

            hw = way_info['class']
            props = way_info.get('props', {})
            props['highway'] = hw

            if len(segs) == 1:
                c_list = segs[0]
                if len(c_list) >= 2:
                    self.add_way(OsmWay(id=int(osm_id), nodes=[], coords=c_list, tags=props))
                    added += 1
            else:
                shapely_segs = [LineString([(c[1], c[0]) for c in s]) for s in segs if len(s) >= 2]
                if not shapely_segs:
                    continue
                merged = linemerge(shapely_segs)
                if merged.geom_type == 'LineString':
                    lines = [merged]
                elif merged.geom_type == 'MultiLineString':
                    lines = list(merged.geoms)
                else:
                    continue

                for line in lines:
                    c_list = [(pt[1], pt[0]) for pt in line.coords]
                    if len(c_list) >= 2:
                        self.add_way(OsmWay(id=int(osm_id), nodes=[], coords=c_list, tags=props))
                        added += 1

        self.build_adjacency()
        return added

    def load_corridor_ways(
        self,
        track_points: Sequence[Sequence[float]],
        threshold_m: float = 50.0
    ) -> None:
        """
        Alias for load_from_pmtiles ensuring 100% compatibility with legacy unit test mocks.
        """
        self.load_from_pmtiles(track_points=track_points, threshold_m=threshold_m)

    def build_adjacency(self) -> None:
        """
        Analyze endpoints and vertices of all ways to discover topological connections.
        Intersects vertices across distinct ways within 25 meters.
        """
        self.adjacency.clear()
        self.connections.clear()

        # Vertex spatial index: (gx, gy) -> List of (way_idx, vertex_idx, lat, lon)
        v_grid_size = 0.0003  # ~30 meters
        v_grid: Dict[Tuple[int, int], List[Tuple[int, int, float, float]]] = defaultdict(list)

        for w_idx, way in enumerate(self.ways):
            coords = way.coords
            for v_idx, (lat, lon) in enumerate(coords):
                gx = int(math.floor(lon / v_grid_size))
                gy = int(math.floor(lat / v_grid_size))
                v_grid[(gx, gy)].append((w_idx, v_idx, lat, lon))

        for (gx, gy), v_list in v_grid.items():
            # Check within cell and 8 neighbors
            cand_vertices: List[Tuple[int, int, float, float]] = []
            for dgx in (-1, 0, 1):
                for dgy in (-1, 0, 1):
                    cand_vertices.extend(v_grid.get((gx + dgx, gy + dgy), []))

            for i in range(len(v_list)):
                w1, v1_idx, lat1, lon1 = v_list[i]
                for w2, v2_idx, lat2, lon2 in cand_vertices:
                    if w1 >= w2:
                        continue
                    d = haversine_distance_m(lat1, lon1, lat2, lon2)
                    if d <= 25.0:
                        self.adjacency[w1].add(w2)
                        self.adjacency[w2].add(w1)
                        if w2 not in self.connections[w1] or d < self.connections[w1][w2][2]:
                            self.connections[w1][w2] = (v1_idx, v2_idx, d)
                            self.connections[w2][w1] = (v2_idx, v1_idx, d)

    def are_ways_connected(self, way_id1: int, way_id2: int) -> bool:
        """
        Check if two ways are directly connected or connected within 3 hops.
        """
        if way_id1 == way_id2:
            return True
        if way_id2 in self.adjacency[way_id1]:
            return True

        # BFS within 3 hops
        visited: Set[int] = {way_id1}
        queue: deque = deque([(way_id1, 1)])
        while queue:
            curr, depth = queue.popleft()
            if depth >= 3:
                continue
            for neighbor in self.adjacency[curr]:
                if neighbor == way_id2:
                    return True
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, depth + 1))
        return False

    def find_way_path(
        self,
        start_way_id: int,
        end_way_id: int,
        max_hops: int = 10,
        max_distance_m: float = 2000.0
    ) -> Optional[List[int]]:
        """
        Find shortest path connecting start_way_id to end_way_id using Dijkstra traversal.
        """
        if start_way_id == end_way_id:
            return [start_way_id]

        # Priority queue: (cost_m, hops, current_way, path)
        pq: List[Tuple[float, int, int, List[int]]] = [(0.0, 0, start_way_id, [start_way_id])]
        visited: Dict[int, float] = {start_way_id: 0.0}

        while pq:
            cost, hops, curr, path = heapq.heappop(pq)
            if curr == end_way_id:
                return path

            if hops >= max_hops or cost > max_distance_m:
                continue

            for neighbor in self.adjacency[curr]:
                conn = self.connections[curr].get(neighbor)
                edge_dist = conn[2] if conn else 5.0
                new_cost = cost + edge_dist
                if neighbor not in visited or new_cost < visited[neighbor]:
                    visited[neighbor] = new_cost
                    heapq.heappush(pq, (new_cost, hops + 1, neighbor, path + [neighbor]))

        return None

    def extract_path_geometry(
        self,
        way_ids: List[int],
        start_point: Union[Tuple[float, float], Any],
        end_point: Union[Tuple[float, float], Any],
        include_start: bool = True
    ) -> List[Tuple[float, float]]:
        """
        Extract ordered coordinate vertices along the traversed sequence of ways,
        trimming intermediate curve vertices between start_point and end_point.
        """
        if not way_ids:
            if hasattr(end_point, "proj_lat"):
                return [(float(end_point.proj_lat), float(end_point.proj_lon))]
            elif isinstance(end_point, (tuple, list)) and len(end_point) >= 2:
                return [(float(end_point[0]), float(end_point[1]))]
            return []

        # Extract start coordinate and position
        if hasattr(start_point, "proj_lat"):
            p_start_lat, p_start_lon = float(start_point.proj_lat), float(start_point.proj_lon)
            s_start = float(start_point.seg_idx) + float(getattr(start_point, "t", 0.0))
        elif isinstance(start_point, (tuple, list)) and len(start_point) >= 2:
            p_start_lat, p_start_lon = float(start_point[0]), float(start_point[1])
            w0_coords = self.ways[way_ids[0]].coords
            s_start = 0.0
            if len(w0_coords) >= 2:
                best_d = float("inf")
                for s_i in range(len(w0_coords) - 1):
                    d_m, _, t_v, _ = dist_point_to_segment_m(
                        p_start_lat, p_start_lon,
                        w0_coords[s_i][0], w0_coords[s_i][1],
                        w0_coords[s_i + 1][0], w0_coords[s_i + 1][1]
                    )
                    if d_m < best_d:
                        best_d = d_m
                        s_start = float(s_i) + t_v
        else:
            p_start_lat, p_start_lon = 0.0, 0.0
            s_start = 0.0

        # Extract end coordinate and position
        if hasattr(end_point, "proj_lat"):
            p_end_lat, p_end_lon = float(end_point.proj_lat), float(end_point.proj_lon)
            s_end = float(end_point.seg_idx) + float(getattr(end_point, "t", 0.0))
        elif isinstance(end_point, (tuple, list)) and len(end_point) >= 2:
            p_end_lat, p_end_lon = float(end_point[0]), float(end_point[1])
            w_end_coords = self.ways[way_ids[-1]].coords
            s_end = float(len(w_end_coords) - 1)
            if len(w_end_coords) >= 2:
                best_d = float("inf")
                for s_i in range(len(w_end_coords) - 1):
                    d_m, _, t_v, _ = dist_point_to_segment_m(
                        p_end_lat, p_end_lon,
                        w_end_coords[s_i][0], w_end_coords[s_i][1],
                        w_end_coords[s_i + 1][0], w_end_coords[s_i + 1][1]
                    )
                    if d_m < best_d:
                        best_d = d_m
                        s_end = float(s_i) + t_v
        else:
            p_end_lat, p_end_lon = 0.0, 0.0
            s_end = 0.0

        pts: List[Tuple[float, float]] = []

        def add_pt(lat: float, lon: float):
            if not pts or haversine_distance_m(pts[-1][0], pts[-1][1], lat, lon) > 0.1:
                pts.append((lat, lon))

        if include_start:
            add_pt(p_start_lat, p_start_lon)

        # Case 1: Single way traversal
        if len(way_ids) == 1:
            w = way_ids[0]
            coords = self.ways[w].coords
            if s_end >= s_start:
                for v in range(int(math.floor(s_start)) + 1, int(math.ceil(s_end))):
                    if 0 <= v < len(coords):
                        add_pt(coords[v][0], coords[v][1])
            else:
                for v in range(int(math.ceil(s_start)) - 1, int(math.floor(s_end)), -1):
                    if 0 <= v < len(coords):
                        add_pt(coords[v][0], coords[v][1])
            add_pt(p_end_lat, p_end_lon)
            return pts

        # Case 2: Multi-way path
        w0 = way_ids[0]
        coords0 = self.ways[w0].coords
        conn0 = self.connections.get(w0, {}).get(way_ids[1])
        j_exit = conn0[0] if conn0 else len(coords0) - 1
        if j_exit >= s_start:
            for v in range(int(math.floor(s_start)) + 1, j_exit + 1):
                if 0 <= v < len(coords0):
                    add_pt(coords0[v][0], coords0[v][1])
        else:
            for v in range(int(math.ceil(s_start)) - 1, j_exit - 1, -1):
                if 0 <= v < len(coords0):
                    add_pt(coords0[v][0], coords0[v][1])

        for i in range(1, len(way_ids) - 1):
            w_curr = way_ids[i]
            coords_curr = self.ways[w_curr].coords
            conn_prev = self.connections.get(way_ids[i - 1], {}).get(w_curr)
            conn_next = self.connections.get(w_curr, {}).get(way_ids[i + 1])
            j_entry = conn_prev[1] if conn_prev else 0
            j_exit = conn_next[0] if conn_next else len(coords_curr) - 1
            if j_exit >= j_entry:
                for v in range(j_entry, j_exit + 1):
                    if 0 <= v < len(coords_curr):
                        add_pt(coords_curr[v][0], coords_curr[v][1])
            else:
                for v in range(j_entry, j_exit - 1, -1):
                    if 0 <= v < len(coords_curr):
                        add_pt(coords_curr[v][0], coords_curr[v][1])

        w_end = way_ids[-1]
        coords_end = self.ways[w_end].coords
        conn_end = self.connections.get(way_ids[-2], {}).get(w_end)
        j_entry = conn_end[1] if conn_end else 0
        if s_end >= j_entry:
            for v in range(j_entry, int(math.ceil(s_end))):
                if 0 <= v < len(coords_end):
                    add_pt(coords_end[v][0], coords_end[v][1])
        else:
            for v in range(j_entry, int(math.floor(s_end)), -1):
                if 0 <= v < len(coords_end):
                    add_pt(coords_end[v][0], coords_end[v][1])

        add_pt(p_end_lat, p_end_lon)
        return pts

    def query_nearby_segments(
        self,
        lat: float,
        lon: float,
        radius_m: float = 50.0
    ) -> List[OsmWaySegment]:
        """
        Spatial candidate query: retrieves all segments within radius_m of (lat, lon).
        """
        gx = int(math.floor(lon / self.grid_size))
        gy = int(math.floor(lat / self.grid_size))

        cand_segment_keys: Set[Tuple[int, int]] = set()
        for dgx in (-1, 0, 1):
            for dgy in (-1, 0, 1):
                cand_segment_keys.update(self.grid.get((gx + dgx, gy + dgy), []))

        results: List[OsmWaySegment] = []
        for w_idx, s_idx in cand_segment_keys:
            if w_idx >= len(self.ways):
                continue
            way = self.ways[w_idx]
            if s_idx >= len(way.coords) - 1:
                continue
            lat1, lon1 = way.coords[s_idx]
            lat2, lon2 = way.coords[s_idx + 1]
            dist_m, _, _, _ = dist_point_to_segment_m(lat, lon, lat1, lon1, lat2, lon2)
            if dist_m <= radius_m:
                seg_len = haversine_distance_m(lat1, lon1, lat2, lon2)
                results.append(OsmWaySegment(
                    way_id=w_idx,
                    seg_idx=s_idx,
                    lat1=lat1,
                    lon1=lon1,
                    lat2=lat2,
                    lon2=lon2,
                    length_m=seg_len,
                    highway=way.highway,
                    penalty_m=way.penalty_m
                ))
        return results

    def find_candidates_for_point(
        self,
        lat: float,
        lon: float,
        threshold_m: float = 50.0,
        max_candidates: int = 5,
        route_bearing: Optional[float] = None
    ) -> List[WayCandidate]:
        """
        Find road segment candidates within threshold_m, scored with preference
        and bearing deflection penalties. Always appends an off-road fallback candidate.

        Strict 50m threshold: candidates > threshold_m are strictly rejected.
        """
        gx = int(math.floor(lon / self.grid_size))
        gy = int(math.floor(lat / self.grid_size))

        cand_segment_keys: Set[Tuple[int, int]] = set()
        for dgx in (-1, 0, 1):
            for dgy in (-1, 0, 1):
                cand_segment_keys.update(self.grid.get((gx + dgx, gy + dgy), []))

        # Best candidate per unique way_idx
        best_per_way: Dict[int, WayCandidate] = {}

        for w_idx, s_idx in cand_segment_keys:
            if w_idx >= len(self.ways):
                continue
            way = self.ways[w_idx]
            if not way.is_cyclable:
                continue

            coords = way.coords
            if s_idx >= len(coords) - 1:
                continue

            lat1, lon1 = coords[s_idx]
            lat2, lon2 = coords[s_idx + 1]
            dist_m, t, proj_lat, proj_lon = dist_point_to_segment_m(lat, lon, lat1, lon1, lat2, lon2)

            # Strict 50m threshold enforcement
            if dist_m > threshold_m:
                continue

            # Bearing deflection penalty
            defl_deg = 0.0
            bearing_penalty = 0.0
            if route_bearing is not None:
                seg_b = initial_bearing(lat1, lon1, lat2, lon2)
                d1 = abs(deflection_angle(route_bearing, seg_b))
                d2 = abs(deflection_angle(route_bearing, (seg_b + 180.0) % 360.0))
                defl_deg = min(d1, d2)
                if defl_deg > 60.0:
                    bearing_penalty = (defl_deg - 60.0) * 0.5

            eff_dist = dist_m + way.penalty_m + bearing_penalty

            cand = WayCandidate(
                way_id=w_idx,
                seg_idx=s_idx,
                dist_m=dist_m,
                eff_dist_m=eff_dist,
                proj_lat=proj_lat,
                proj_lon=proj_lon,
                t=t,
                highway=way.highway,
                is_fallback=False,
                tags=way.tags,
                bearing_deflection_deg=defl_deg
            )

            if w_idx not in best_per_way or eff_dist < best_per_way[w_idx].eff_dist_m:
                best_per_way[w_idx] = cand

        candidates = sorted(best_per_way.values(), key=lambda c: c.eff_dist_m)[:max_candidates]

        # Off-road fallback candidate
        if not candidates:
            # When > 50m from all mapped ways: pure fallback with eff_dist=0.0
            fallback = WayCandidate(
                way_id=-1,
                seg_idx=-1,
                dist_m=0.0,
                eff_dist_m=0.0,
                proj_lat=lat,
                proj_lon=lon,
                t=0.0,
                highway="fallback",
                is_fallback=True
            )
            return [fallback]
        else:
            fallback = WayCandidate(
                way_id=-1,
                seg_idx=-1,
                dist_m=0.0,
                eff_dist_m=threshold_m + 8.0,
                proj_lat=lat,
                proj_lon=lon,
                t=0.0,
                highway="fallback",
                is_fallback=True
            )
            candidates.append(fallback)
            return candidates

    def find_nearest_way(
        self,
        lat: float,
        lon: float,
        threshold_m: float = 50.0,
        max_dist_m: Optional[float] = None
    ) -> Optional[WayCandidate]:
        """
        Find the single best candidate way within threshold_m, or None if none exist.
        """
        thresh = max_dist_m if max_dist_m is not None else threshold_m
        cands = self.find_candidates_for_point(lat, lon, threshold_m=thresh)
        road_cands = [c for c in cands if not c.is_fallback]
        return road_cands[0] if road_cands else None

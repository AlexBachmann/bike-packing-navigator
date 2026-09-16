"""
engine/tests/test_core_manifest.py - Comprehensive unit tests for route manifest management and synchronization.
"""

import json
from pathlib import Path
import pytest

from engine.core.manifest import (
    ManifestCorruptError,
    ManifestNotFoundError,
    MissingRouteDataError,
    RouteManifest,
    RouteManifestEntry,
    RouteVerificationResult,
    backup_manifest,
    load_manifest,
    register_route,
    save_manifest,
    verify_route_data_files,
)
from engine.core.models import RoutePoint, RouteTrack
from engine.utils.spatial import BoundingBox


class TestRouteManifestEntry:
    def test_entry_creation_and_to_dict(self) -> None:
        entry = RouteManifestEntry(
            id="test-route",
            name="Test Bikepacking Route",
            short_name="Test Route",
            badge="TR",
            start_location="Flagstaff, AZ",
            end_location="Phoenix, AZ",
            total_distance_km=250.0,
            total_distance_miles=155.3,
            elevation_gain_m=4200,
            elevation_gain_ft=13780,
            highest_elevation_m=2800,
            highest_elevation_ft=9186,
            highest_point="Humphreys Saddle",
            iconic_pass="Humphreys Saddle",
            iconic_checkpoints=["Flagstaff", "Mormon Lake", "Pine", "Phoenix"],
            description="An awesome traverse across central Arizona.",
            start_coordinates=(35.1983, -111.6513),
            bounds=[[33.4484, -112.0740], [35.1983, -111.6513]]
        )

        d = entry.to_dict()
        # Verify all 24 canonical keys and aliases
        expected_keys = [
            "id", "name", "shortName", "badge",
            "startLocation", "endLocation", "startPoint", "endPoint",
            "totalDistanceMiles", "totalDistanceKm", "distanceMiles", "distanceKm",
            "elevationGainFt", "elevationGainFeet", "elevationGainM", "elevationGainMeters",
            "highestElevationFeet", "highestElevationMeters", "highestPoint", "iconicPass",
            "iconicCheckpoints", "description", "startCoordinates", "bounds", "dataPath"
        ]
        for k in expected_keys:
            assert k in d, f"Missing key {k} in to_dict() output"

        assert d["id"] == "test-route"
        assert d["totalDistanceKm"] == 250.0
        assert d["distanceKm"] == 250.0
        assert d["totalDistanceMiles"] == 155.3
        assert d["distanceMiles"] == 155.3
        assert d["elevationGainM"] == 4200
        assert d["elevationGainMeters"] == 4200
        assert d["elevationGainFt"] == 13780
        assert d["elevationGainFeet"] == 13780
        assert d["dataPath"] == "/data/routes/test-route"

    def test_entry_from_dict_camel_case(self) -> None:
        data = {
            "id": "colorado-trail",
            "name": "The Colorado Trail",
            "shortName": "Colorado Trail",
            "badge": "CT",
            "startLocation": "Denver, CO",
            "endLocation": "Durango, CO",
            "totalDistanceMiles": 514.7,
            "totalDistanceKm": 828.4,
            "elevationGainFt": 83143,
            "elevationGainM": 25342,
            "highestElevationFeet": 13258,
            "highestElevationMeters": 4041,
            "highestPoint": "Coney Summit (13,258 ft)",
            "iconicPass": "Coney Summit (13,258 ft)",
            "iconicCheckpoints": ["Waterton Canyon", "Monarch Pass", "Durango"],
            "description": "Traversing Colorado.",
            "startCoordinates": [39.4909, -105.0942],
            "bounds": [[37.3314, -108.0387], [39.5516, -105.0942]],
            "dataPath": "/data/routes/colorado-trail"
        }
        entry = RouteManifestEntry.from_dict(data)
        assert entry.id == "colorado-trail"
        assert entry.name == "The Colorado Trail"
        assert entry.total_distance_km == 828.4
        assert entry.total_distance_miles == 514.7
        assert entry.elevation_gain_m == 25342
        assert entry.highest_point == "Coney Summit (13,258 ft)"
        assert entry.start_coordinates == (39.4909, -105.0942)

    def test_entry_from_dict_snake_case(self) -> None:
        data = {
            "id": "azt-300",
            "name": "Arizona Trail 300",
            "short_name": "AZT",
            "start_location": "Coronado, AZ",
            "end_location": "Superior, AZ",
            "total_distance_km": 490.8,
            "total_distance_miles": 305.0,
            "elevation_gain_m": 12000,
            "elevation_gain_ft": 39370,
            "highest_elevation_m": 2500,
            "highest_elevation_ft": 8202,
        }
        entry = RouteManifestEntry.from_dict(data)
        assert entry.id == "azt-300"
        assert entry.short_name == "AZT"
        assert entry.total_distance_km == 490.8
        assert entry.elevation_gain_m == 12000

    def test_entry_extra_fields_retention(self) -> None:
        data = {
            "id": "custom-route",
            "name": "Custom Route",
            "shortName": "Custom",
            "customTag": "bikepacking-roots",
            "corridorLayers": ["pmtiles", "osm"],
            "rating": 5
        }
        entry = RouteManifestEntry.from_dict(data)
        assert entry.extra_fields["customTag"] == "bikepacking-roots"
        assert entry.extra_fields["corridorLayers"] == ["pmtiles", "osm"]
        d = entry.to_dict()
        assert d["customTag"] == "bikepacking-roots"
        assert d["rating"] == 5

    def test_entry_center_and_bbox_properties(self) -> None:
        entry = RouteManifestEntry(
            id="test",
            name="Test",
            short_name="Test",
            badge="T",
            start_location="",
            end_location="",
            total_distance_km=0.0,
            total_distance_miles=0.0,
            elevation_gain_m=0,
            elevation_gain_ft=0,
            highest_elevation_m=0,
            highest_elevation_ft=0,
            bounds=[[30.0, -110.0], [40.0, -100.0]]
        )
        assert entry.center == (35.0, -105.0)
        assert entry.bbox == (-110.0, 30.0, -100.0, 40.0)


class TestRouteManifest:
    def test_manifest_crud_operations(self) -> None:
        manifest = RouteManifest(version=1, routes=[])
        e1 = RouteManifestEntry.from_dict({"id": "route-1", "name": "Route 1"})
        e2 = RouteManifestEntry.from_dict({"id": "route-2", "name": "Route 2"})

        assert manifest.upsert_route(e1) is False
        assert manifest.upsert_route(e2) is False
        assert len(manifest.routes) == 2
        assert manifest.has_route("route-1")
        assert manifest.has_route("route-2")
        assert not manifest.has_route("route-3")
        assert manifest.find_index("route-2") == 1

        assert manifest.remove_route("route-1") is True
        assert len(manifest.routes) == 1
        assert not manifest.has_route("route-1")

    def test_manifest_from_list_and_dict(self) -> None:
        # Array form
        arr = [{"id": "r1", "name": "R1"}, {"id": "r2", "name": "R2"}]
        m1 = RouteManifest.from_dict(arr)
        assert len(m1.routes) == 2

        # Dict form
        dct = {"version": 2, "defaultRouteId": "r1", "routes": arr}
        m2 = RouteManifest.from_dict(dct)
        assert m2.version == 2
        assert m2.default_route_id == "r1"
        assert len(m2.routes) == 2

    def test_manifest_upsert_ordering(self) -> None:
        manifest = RouteManifest(version=1, routes=[
            RouteManifestEntry.from_dict({"id": "r1", "name": "R1"}),
            RouteManifestEntry.from_dict({"id": "r2", "name": "Old R2 Name"}),
            RouteManifestEntry.from_dict({"id": "r3", "name": "R3"}),
        ])

        updated_e2 = RouteManifestEntry.from_dict({"id": "r2", "name": "New R2 Name"})
        is_update = manifest.upsert_route(updated_e2)
        assert is_update is True
        # Verify position 1 is preserved
        assert manifest.routes[1].id == "r2"
        assert manifest.routes[1].name == "New R2 Name"
        assert len(manifest.routes) == 3


class TestSlugification:
    def test_slugification_of_route_id(self) -> None:
        e = RouteManifestEntry.from_dict({"id": " Arizona Trail 300 ", "name": "AZT"})
        assert e.id == "arizona-trail-300"

    def test_slug_generation_from_name(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        entry = register_route(
            manifest_p,
            route_id="",
            name="Atlas Mountain Race 2026",
            create_backup=False
        )
        assert entry.id == "atlas-mountain-race-2026"

    def test_unicode_slugification(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        entry = register_route(
            manifest_p,
            route_id="Tizi N'Ait Imi",
            name="Tizi Pass",
            create_backup=False
        )
        assert entry.id == "tizi-n-ait-imi"


class TestConflictResolution:
    def test_update_preserves_custom_checkpoints(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        # 1. Initial route registration with 6 custom checkpoints
        custom_ckpts = ["Coronado", "Parker Lake", "Canelo Pass", "Patagonia", "Kentucky Camp", "Superior"]
        register_route(
            manifest_p,
            route_id="azt-300",
            name="Arizona Trail 300",
            checkpoints=custom_ckpts,
            create_backup=False
        )

        # 2. Update telemetry without passing checkpoints
        new_stats = {"total_km": 492.0, "total_miles": 305.7, "elevation_gain_m": 12500}
        updated = register_route(
            manifest_p,
            route_id="azt-300",
            name="Arizona Trail 300",
            stats=new_stats,
            create_backup=False
        )

        assert updated.total_distance_km == 492.0
        assert updated.iconic_checkpoints == custom_ckpts

    def test_update_preserves_custom_highest_point_and_pass(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        register_route(
            manifest_p,
            route_id="ct",
            name="Colorado Trail",
            highest_point="Coney Summit (13,258 ft)",
            create_backup=False
        )

        updated = register_route(
            manifest_p,
            route_id="ct",
            name="Colorado Trail",
            stats={"total_km": 829.0},
            create_backup=False
        )
        assert updated.highest_point == "Coney Summit (13,258 ft)"
        assert updated.iconic_pass == "Coney Summit (13,258 ft)"

    def test_update_preserves_custom_extra_metadata(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        register_route(
            manifest_p,
            route_id="route-meta",
            name="Meta Route",
            custom_metadata={"sponsor": "Tailwind", "officialRace": True},
            create_backup=False
        )

        updated = register_route(
            manifest_p,
            route_id="route-meta",
            name="Meta Route",
            stats={"total_km": 100.0},
            custom_metadata={"season": "Fall"},
            create_backup=False
        )
        assert updated.extra_fields.get("sponsor") == "Tailwind"
        assert updated.extra_fields.get("officialRace") is True
        assert updated.extra_fields.get("season") == "Fall"

    def test_update_preserves_bounds_and_start_coordinates(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        register_route(
            manifest_p,
            route_id="azt-300",
            name="Arizona Trail 300",
            stats={
                "total_km": 490.8,
                "total_miles": 305.0,
                "start_coordinates": [31.3387, -110.3379],
                "bounds": [[31.3387, -111.1763], [33.2720, -110.3319]],
                "elevation_gain_m": 12000,
                "highest_elevation_m": 2500,
            },
            create_backup=False,
        )

        # Re-register with partial stats omitting bounds and startCoordinates
        updated = register_route(
            manifest_p,
            route_id="azt-300",
            name="Arizona Trail 300",
            stats={
                "total_km": 492.5,
                "elevation_gain_m": 12850,
            },
            create_backup=False,
        )

        # Bounds and coordinates must be retained from previous registration
        assert updated.bounds == [[31.3387, -111.1763], [33.2720, -110.3319]]
        assert updated.start_coordinates == (31.3387, -110.3379)
        assert updated.total_distance_km == 492.5
        assert abs(updated.total_distance_miles - 306.0) < 0.2
        assert updated.elevation_gain_m == 12850
        assert updated.highest_elevation_m == 2500
        assert updated.highest_elevation_ft == 8202

    def test_re_registration_without_stats_preserves_telemetry_and_coordinates(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        register_route(
            manifest_p,
            route_id="ct",
            name="Colorado Trail",
            stats={
                "total_km": 828.4,
                "total_miles": 514.7,
                "start_coordinates": [39.4909, -105.0942],
                "bounds": [[37.3314, -108.0387], [39.5516, -105.0942]],
                "elevation_gain_m": 25342,
                "highest_elevation_m": 4041,
            },
            create_backup=False,
        )

        # Re-register solely updating description without stats dict
        updated = register_route(
            manifest_p,
            route_id="ct",
            name="Colorado Trail",
            description="The premier Colorado backcountry singletrack traverse.",
            create_backup=False,
        )

        assert updated.description == "The premier Colorado backcountry singletrack traverse."
        assert updated.bounds == [[37.3314, -108.0387], [39.5516, -105.0942]]
        assert updated.start_coordinates == (39.4909, -105.0942)
        assert updated.total_distance_km == 828.4
        assert updated.total_distance_miles == 514.7
        assert updated.elevation_gain_m == 25342
        assert updated.highest_elevation_m == 4041

    def test_re_registration_preserves_total_distance_miles_when_only_km_given(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        register_route(
            manifest_p,
            route_id="amr",
            name="Atlas Mountain Race",
            stats={
                "total_km": 1350.0,
                "total_miles": 838.8,
                "start_coordinates": [32.3333, -6.3500],
                "bounds": [[30.5000, -9.8000], [32.5000, -6.3000]],
            },
            create_backup=False,
        )

        # Re-register updating only total_km without total_miles
        updated = register_route(
            manifest_p,
            route_id="amr",
            name="Atlas Mountain Race",
            stats={"total_km": 1352.0},
            create_backup=False,
        )

        assert updated.total_distance_km == 1352.0
        # Automatically recalculates miles rather than defaulting to 0.0
        assert abs(updated.total_distance_miles - 840.1) < 0.2
        assert updated.distance_miles == updated.total_distance_miles
        assert updated.start_coordinates == (32.3333, -6.3500)
        assert updated.bounds == [[30.5000, -9.8000], [32.5000, -6.3000]]

    def test_new_route_appended(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        register_route(manifest_p, "route-a", "Route A", create_backup=False)
        register_route(manifest_p, "route-b", "Route B", create_backup=False)
        m = load_manifest(manifest_p)
        assert len(m.routes) == 2
        assert [r.id for r in m.routes] == ["route-a", "route-b"]


class TestManifestIO:
    def test_atomic_save_and_load(self, tmp_path: Path) -> None:
        p = tmp_path / "sub" / "routes.json"
        m = RouteManifest(version=1, routes=[
            RouteManifestEntry.from_dict({"id": "r1", "name": "Route 1"})
        ])
        save_manifest(p, m, create_backup=False)
        assert p.exists()
        reloaded = load_manifest(p)
        assert len(reloaded.routes) == 1
        assert reloaded.routes[0].id == "r1"

    def test_manifest_backup_creation(self, tmp_path: Path) -> None:
        p = tmp_path / "routes.json"
        m = RouteManifest(version=1, routes=[
            RouteManifestEntry.from_dict({"id": "r1", "name": "Version 1"})
        ])
        save_manifest(p, m, create_backup=False)

        # Second save with create_backup=True
        m.routes[0].name = "Version 2"
        save_manifest(p, m, create_backup=True)

        bak_p = tmp_path / "routes.json.bak"
        assert bak_p.exists()
        bak_data = json.loads(bak_p.read_text(encoding="utf-8"))
        assert bak_data["routes"][0]["name"] == "Version 1"

    def test_load_manifest_missing_file(self, tmp_path: Path) -> None:
        p = tmp_path / "missing.json"
        empty_m = load_manifest(p, default_if_missing=True)
        assert len(empty_m.routes) == 0

        with pytest.raises(ManifestNotFoundError):
            load_manifest(p, default_if_missing=False)

    def test_load_manifest_corrupt_json(self, tmp_path: Path) -> None:
        p = tmp_path / "corrupt.json"
        p.write_text("{ incomplete json: ", encoding="utf-8")
        with pytest.raises(ManifestCorruptError):
            load_manifest(p, auto_recover_backup=False)

    def test_load_manifest_auto_recovery_from_backup(self, tmp_path: Path) -> None:
        p = tmp_path / "routes.json"
        p_bak = tmp_path / "routes.json.bak"
        # Write valid backup
        valid_json = json.dumps({"version": 1, "routes": [{"id": "recovered", "name": "Recovered"}]})
        p_bak.write_text(valid_json, encoding="utf-8")
        # Corrupt primary
        p.write_text("{corrupted", encoding="utf-8")

        recovered = load_manifest(p, auto_recover_backup=True)
        assert len(recovered.routes) == 1
        assert recovered.routes[0].id == "recovered"


class TestRouteVerification:
    def test_verify_route_data_files_complete(self, tmp_path: Path) -> None:
        route_dir = tmp_path / "routes" / "my-route"
        route_dir.mkdir(parents=True, exist_ok=True)
        for f in ["route-track.json", "surfaces.json", "climbs.json", "passes.json", "milestones.json", "places.json"]:
            (route_dir / f).write_text("{}", encoding="utf-8")

        res = verify_route_data_files(route_dir)
        assert res.is_complete is True
        assert len(res.missing_required) == 0

    def test_verify_route_data_files_missing(self, tmp_path: Path) -> None:
        route_dir = tmp_path / "routes" / "partial-route"
        route_dir.mkdir(parents=True, exist_ok=True)
        (route_dir / "route-track.json").write_text("{}", encoding="utf-8")

        res = verify_route_data_files(route_dir)
        assert res.is_complete is False
        assert "climbs.json" in res.missing_required
        assert "places.json" in res.missing_required

    def test_register_route_strict_verify_failure(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "public" / "data" / "routes.json"
        manifest_p.parent.mkdir(parents=True, exist_ok=True)

        with pytest.raises(MissingRouteDataError, match="missing required data files"):
            register_route(
                manifest_p,
                route_id="incomplete-route",
                name="Incomplete",
                verify_files=True,
                strict_verify=True,
                create_backup=False
            )

    def test_register_route_with_track_object(self, tmp_path: Path) -> None:
        manifest_p = tmp_path / "routes.json"
        pts = [
            RoutePoint(34.0, -111.0, 1000.0, 0.0, 0.0),
            RoutePoint(34.1, -111.0, 1500.0, 20.0, 12.4),
        ]
        track = RouteTrack(
            points=pts,
            bbox=BoundingBox.from_points([(34.0, -111.0), (34.1, -111.0)]),
            total_distance_km=20.0,
            total_distance_mi=12.4,
            elevation_gain_m=500.0,
            elevation_loss_m=0.0,
            min_ele_m=1000.0,
            max_ele_m=1500.0
        )
        entry = register_route(
            manifest_p,
            route_id="track-route",
            name="Track Route",
            track=track,
            create_backup=False
        )
        assert entry.total_distance_km == 20.0
        assert entry.elevation_gain_m == 500
        assert entry.highest_elevation_m == 1500

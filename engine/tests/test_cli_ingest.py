"""
engine/tests/test_cli_ingest.py - Unit and integration tests for engine.cli.ingest and forwarders.
"""

import json
from pathlib import Path
import subprocess
import sys
from typing import Generator
import unittest.mock as mock
import pytest

from engine.cli.ingest import (
    IngestConfig,
    build_ingest_config,
    build_ingest_parser,
    main,
    run_ingest,
)


@pytest.fixture
def sample_gpx_file(tmp_path: Path) -> Path:
    """Generates a minimal, valid GPX track file for testing."""
    gpx_content = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bikepack Test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Test Trail Ride</name>
    <trkseg>
      <trkpt lat="37.7749" lon="-122.4194"><ele>10.0</ele></trkpt>
      <trkpt lat="37.7849" lon="-122.4094"><ele>50.0</ele></trkpt>
      <trkpt lat="37.7949" lon="-122.3994"><ele>120.0</ele></trkpt>
      <trkpt lat="37.8049" lon="-122.3894"><ele>180.0</ele></trkpt>
      <trkpt lat="37.8149" lon="-122.3794"><ele>150.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>"""
    p = tmp_path / "test-trail.gpx"
    p.write_text(gpx_content, encoding="utf-8")
    return p


@pytest.fixture
def initial_manifest_file(tmp_path: Path) -> Path:
    """Generates an initial routes.json manifest."""
    p = tmp_path / "routes.json"
    p.write_text(json.dumps({"version": 1, "routes": []}), encoding="utf-8")
    return p


class TestCLIIngestArguments:
    """Verifies argument parsing and metadata inference."""

    def test_missing_gpx_raises_error(self) -> None:
        parser = build_ingest_parser()
        with pytest.raises(SystemExit) as exc_info:
            parser.parse_args([])
        assert exc_info.value.code == 2

    def test_metadata_inference_from_stem(self, sample_gpx_file: Path) -> None:
        parser = build_ingest_parser()
        args = parser.parse_args(["--gpx", str(sample_gpx_file)])
        assert args.gpx == str(sample_gpx_file)
        assert args.densify_step == 100.0
        assert args.snap_dist == 50.0
        assert args.segment_km == 5.0

        config = build_ingest_config(args)
        assert config.gpx_path == sample_gpx_file
        assert config.route_id is None  # inferred inside run_ingest

    def test_explicit_metadata_overrides(self, sample_gpx_file: Path) -> None:
        parser = build_ingest_parser()
        args = parser.parse_args([
            "--gpx", str(sample_gpx_file),
            "--id", "custom-route-id",
            "--name", "Custom Route Name",
            "--short-name", "Custom",
            "--badge", "CR",
            "--start-location", "City A",
            "--end-location", "City B",
            "--description", "A great custom ride.",
        ])
        assert args.id == "custom-route-id"
        assert args.name == "Custom Route Name"
        assert args.short_name == "Custom"
        assert args.badge == "CR"
        assert args.start_location == "City A"
        assert args.end_location == "City B"

        config = build_ingest_config(args)
        assert config.route_id == "custom-route-id"
        assert config.name == "Custom Route Name"
        assert config.badge == "CR"


class TestCLIIngestPipelineExecution:
    """Tests end-to-end pipeline execution with mocked external services."""

    def test_full_pipeline_mock_execution(
        self,
        sample_gpx_file: Path,
        initial_manifest_file: Path,
        tmp_path: Path,
    ) -> None:
        routes_dir = tmp_path / "public" / "data" / "routes"
        routes_dir.mkdir(parents=True, exist_ok=True)

        args = [
            "--gpx", str(sample_gpx_file),
            "--output-dir", str(routes_dir),
            "--routes-json", str(initial_manifest_file),
            "--mock-places",
            "--id", "test-route",
            "--name", "Test Route",
            "--badge", "TR",
        ]

        exit_code = main(args)
        assert exit_code == 0

        route_dir = routes_dir / "test-route"
        assert route_dir.exists()

        # Verify all 6 required JSON datasets exist and parse cleanly
        required_files = [
            "route-track.json",
            "surfaces.json",
            "climbs.json",
            "passes.json",
            "milestones.json",
            "places.json",
        ]
        for fname in required_files:
            fpath = route_dir / fname
            assert fpath.exists(), f"Required dataset {fname} was not created!"
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
                assert data is not None

        # Verify auxiliary files
        aux_files = ["corridor.geojson", "turns.json", "water_access.json", "route.gpx", "route.geojson"]
        for fname in aux_files:
            fpath = route_dir / fname
            assert fpath.exists(), f"Auxiliary file {fname} was not created!"

        # Verify manifest registration
        with open(initial_manifest_file, "r", encoding="utf-8") as f:
            manifest = json.load(f)
            routes = manifest.get("routes", [])
            assert len(routes) == 1
            assert routes[0]["id"] == "test-route"
            assert routes[0]["name"] == "Test Route"
            assert routes[0]["badge"] == "TR"
            assert routes[0]["totalDistanceKm"] > 0

    def test_missing_gpx_file_returns_code_1(self, tmp_path: Path) -> None:
        """Non-existent GPX path returns exit code 1."""
        missing_path = tmp_path / "does_not_exist.gpx"
        exit_code = main(["--gpx", str(missing_path)])
        assert exit_code == 1

    def test_corrupt_gpx_file_returns_code_1(self, tmp_path: Path) -> None:
        """Unparseable XML in GPX returns exit code 1."""
        corrupt_gpx = tmp_path / "corrupt.gpx"
        corrupt_gpx.write_text("This is NOT xml", encoding="utf-8")
        exit_code = main(["--gpx", str(corrupt_gpx)])
        assert exit_code == 1

    def test_optional_pmtiles_fallback(
        self,
        sample_gpx_file: Path,
        initial_manifest_file: Path,
        tmp_path: Path,
    ) -> None:
        """When corridor.pmtiles is not present, road snapping is gracefully skipped."""
        routes_dir = tmp_path / "public" / "data" / "routes"
        args = [
            "--gpx", str(sample_gpx_file),
            "--output-dir", str(routes_dir),
            "--routes-json", str(initial_manifest_file),
            "--mock-places",
            "--id", "no-pmtiles-route",
        ]
        exit_code = main(args)
        assert exit_code == 0
        # Pipeline succeeds; guidance-track.json is skipped without crash
        assert not (routes_dir / "no-pmtiles-route" / "guidance-track.json").exists()

    def test_skip_places_flag(
        self,
        sample_gpx_file: Path,
        initial_manifest_file: Path,
        tmp_path: Path,
    ) -> None:
        """--skip-places should write places.json without calling Google API."""
        routes_dir = tmp_path / "public" / "data" / "routes"
        args = [
            "--gpx", str(sample_gpx_file),
            "--output-dir", str(routes_dir),
            "--routes-json", str(initial_manifest_file),
            "--skip-places",
            "--id", "skip-places-route",
        ]
        exit_code = main(args)
        assert exit_code == 0
        places_file = routes_dir / "skip-places-route" / "places.json"
        assert places_file.exists()

    def test_stage_timings_recorded(
        self,
        sample_gpx_file: Path,
        initial_manifest_file: Path,
        tmp_path: Path,
    ) -> None:
        """run_ingest must record StageTiming objects for each stage."""
        config = IngestConfig(
            gpx_path=sample_gpx_file,
            route_id="timings-route",
            output_dir=tmp_path / "out",
            routes_json=initial_manifest_file,
            mock_places=True,
        )
        result = run_ingest(config)
        assert result.success is True
        assert len(result.stages) >= 8
        stage_names = [s.stage_name for s in result.stages]
        assert "gpx_parsing" in stage_names
        assert "surfaces" in stage_names
        assert "climbs_passes" in stage_names
        assert "places" in stage_names
        assert "milestones" in stage_names


class TestForwarderScriptsSubprocess:
    """Verifies that legacy forwarder scripts in .agents/skills/.../scripts run via subprocess."""

    def test_ingest_pipeline_forwarder_help(self) -> None:
        """Invoking ingest_pipeline.py --help must succeed with exit code 0."""
        script_path = Path(".agents/skills/ingest-gpx-route/scripts/ingest_pipeline.py")
        if not script_path.exists():
            pytest.skip("Forwarder script not yet created")

        res = subprocess.run(
            [sys.executable, str(script_path), "--help"],
            capture_output=True,
            text=True,
        )
        assert res.returncode == 0
        assert "usage:" in res.stdout.lower()

    @pytest.mark.parametrize("script_name", [
        "parse_gpx.py",
        "densify_route_track.py",
        "extract_osm_corridor.py",
        "extract_18km_corridor.py",
        "extract_water_access.py",
        "generate_surfaces.py",
        "generate_surface_intervals.py",
        "extract_climbs_passes.py",
        "calculate_route_climbs.py",
        "extract_mountain_passes.py",
        "extract_milestones.py",
        "generate_milestones.py",
        "populate_places.py",
        "find_places.py",
        "mock_places.py",
        "snap_route_to_osm.py",
        "snap_to_roads.py",
        "register_manifest.py",
        "generate_corridor_pmtiles.py",
        "build_route_pmtiles.py",
        "pmtiles_corridor_clip.py",
        "slice_pmtiles_sections.py",
        "generate_turn_cues.py",
        "extract_osm_turns.py",
        "analyze_route_surfaces.py",
        "fetch_dem_cogs.py",
        "extract_gpx_waypoints.py",
    ])
    def test_all_individual_forwarders_help(self, script_name: str) -> None:
        """Every individual forwarder must accept --help and exit with code 0."""
        script_path = Path(".agents/skills/ingest-gpx-route/scripts") / script_name
        if not script_path.exists():
            pytest.skip(f"Forwarder {script_name} not yet created")

        res = subprocess.run(
            [sys.executable, str(script_path), "--help"],
            capture_output=True,
            text=True,
        )
        assert res.returncode == 0
        assert "usage:" in res.stdout.lower()

    def test_forwarder_functional_execution(self, sample_gpx_file: Path, tmp_path: Path) -> None:
        """Test executing densify_route_track.py functional run."""
        script_path = Path(".agents/skills/ingest-gpx-route/scripts/densify_route_track.py")
        out_track = tmp_path / "track.json"
        out_stats = tmp_path / ".stats.json"

        res = subprocess.run(
            [
                sys.executable, str(script_path),
                "--gpx", str(sample_gpx_file),
                "--output", str(out_track),
                "--stats", str(out_stats),
            ],
            capture_output=True,
            text=True,
        )
        assert res.returncode == 0
        assert out_track.exists()
        assert out_stats.exists()
        track_data = json.loads(out_track.read_text(encoding="utf-8"))
        assert "points" in track_data
        assert len(track_data["points"]) > 0

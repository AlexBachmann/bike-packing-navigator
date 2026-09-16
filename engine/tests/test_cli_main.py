"""
engine/tests/test_cli_main.py - Unit tests for top-level engine CLI entrypoint.
"""

import json
from pathlib import Path
import unittest.mock as mock
import pytest

from engine.cli.main import build_parser, main
from engine.cli.places import main as places_main
from engine.tiles.pmtiles import PMTilesArchive

SUBCOMMANDS = [
    "ingest",
    "places",
    "water",
    "climbs",
    "surfaces",
    "tiles",
    "manifest",
    "info",
]


class TestCLIMainHelpAndVersion:
    """Verifies help output, version flag, and usage instructions."""

    def test_main_no_args_shows_help(self, capsys: pytest.CaptureFixture) -> None:
        """Calling main with no arguments should display usage and exit code 0 or 2."""
        with pytest.raises(SystemExit) as exc_info:
            main([])
        assert exc_info.value.code in (0, 2)
        captured = capsys.readouterr()
        output = captured.out or captured.err
        assert "usage:" in output.lower()

    def test_main_help_flag(self, capsys: pytest.CaptureFixture) -> None:
        """Calling main(["--help"]) displays subcommands and exits 0."""
        with pytest.raises(SystemExit) as exc_info:
            main(["--help"])
        assert exc_info.value.code == 0
        captured = capsys.readouterr()
        for subcmd in SUBCOMMANDS:
            assert subcmd in captured.out, f"Missing subcommand {subcmd} in main --help"

    def test_main_version_flag(self, capsys: pytest.CaptureFixture) -> None:
        """Calling main(["--version"]) displays version and exits 0."""
        with pytest.raises(SystemExit) as exc_info:
            main(["--version"])
        assert exc_info.value.code == 0
        captured = capsys.readouterr()
        assert "bikepack-engine" in captured.out or "0.1.0" in captured.out

    @pytest.mark.parametrize("subcmd", SUBCOMMANDS)
    def test_subcommands_have_help(self, subcmd: str, capsys: pytest.CaptureFixture) -> None:
        """Each subcommand must support --help and exit with code 0."""
        with pytest.raises(SystemExit) as exc_info:
            main([subcmd, "--help"])
        assert exc_info.value.code == 0
        captured = capsys.readouterr()
        assert "usage:" in captured.out.lower()
        assert subcmd in captured.out.lower()


class TestCLIMainGlobalFlags:
    """Verifies global CLI flags like verbosity."""

    def test_verbose_flag(self) -> None:
        """--verbose should configure logging level to DEBUG."""
        parser = build_parser()
        args = parser.parse_args(["--verbose", "info", "--route-id", "colorado-trail"])
        assert args.verbose is True
        assert args.quiet is False

    def test_quiet_flag(self) -> None:
        """--quiet should configure logging level to WARNING/ERROR."""
        parser = build_parser()
        args = parser.parse_args(["--quiet", "info", "--route-id", "colorado-trail"])
        assert args.quiet is True
        assert args.verbose is False


COLORADO_TRACK = Path("public/data/routes/colorado-trail/route-track.json")


class TestCLIMainSubcommandDispatch:
    """Verifies that subcommands dispatch to their respective domain handlers."""

    @mock.patch("engine.cli.ingest.main")
    def test_dispatch_ingest(self, mock_ingest: mock.MagicMock) -> None:
        mock_ingest.return_value = 0
        exit_code = main(["ingest", "--gpx", "test.gpx"])
        assert exit_code == 0
        mock_ingest.assert_called_once()

    def test_dispatch_places_batch(self, tmp_path: Path) -> None:
        """Execute unmocked places batch subcommand using real track data and offline mock client."""
        out_p = tmp_path / "places.json"
        exit_code = main(["places", "--track", str(COLORADO_TRACK), "--output", str(out_p), "--mock"])
        assert exit_code == 0
        assert out_p.exists()
        data = json.loads(out_p.read_text(encoding="utf-8"))
        assert isinstance(data, list)
        assert len(data) > 0

    def test_dispatch_places_interactive_point(self, tmp_path: Path) -> None:
        """Execute unmocked places interactive subcommand using --point and --mock."""
        out_p = tmp_path / "places_point.json"
        exit_code = main(["places", "--point", "39.5,-105.0", "--output-json", str(out_p), "--mock"])
        assert exit_code == 0
        assert out_p.exists()
        data = json.loads(out_p.read_text(encoding="utf-8"))
        assert isinstance(data, list)
        assert len(data) > 0
        assert any(p["category"] in ("water", "grocery", "bike_shop", "hotel", "gas_station", "laundromat") for p in data)

    def test_dispatch_water(self, tmp_path: Path) -> None:
        """Execute unmocked water extraction subcommand on actual route track."""
        out_p = tmp_path / "water.json"
        exit_code = main(["water", "--track", str(COLORADO_TRACK), "--output", str(out_p)])
        assert exit_code == 0
        assert out_p.exists()
        data = json.loads(out_p.read_text(encoding="utf-8"))
        assert isinstance(data, list)

    def test_dispatch_climbs(self, tmp_path: Path) -> None:
        """Execute unmocked climbs and passes extraction subcommand on actual route track."""
        out_climbs = tmp_path / "climbs.json"
        out_passes = tmp_path / "passes.json"
        exit_code = main([
            "climbs",
            "--track", str(COLORADO_TRACK),
            "--output-climbs", str(out_climbs),
            "--output-passes", str(out_passes),
        ])
        assert exit_code == 0
        assert out_climbs.exists()
        assert out_passes.exists()
        climbs_data = json.loads(out_climbs.read_text(encoding="utf-8"))
        assert isinstance(climbs_data, list)

    def test_dispatch_surfaces(self, tmp_path: Path) -> None:
        """Execute unmocked surfaces extraction subcommand on actual route track."""
        out_p = tmp_path / "surfaces.json"
        exit_code = main(["surfaces", "--track", str(COLORADO_TRACK), "--output", str(out_p)])
        assert exit_code == 0
        assert out_p.exists()
        data = json.loads(out_p.read_text(encoding="utf-8"))
        assert isinstance(data, list)
        assert len(data) > 0
        assert isinstance(data[0], list)

    def test_dispatch_tiles_slice_missing_source_errors(self) -> None:
        """Tiles --slice without --source and --track returns exit code 1."""
        exit_code = main(["tiles", "--slice"])
        assert exit_code == 1

    def test_dispatch_tiles_no_action_errors(self) -> None:
        """Tiles with no action flags returns exit code 1."""
        exit_code = main(["tiles"])
        assert exit_code == 1

    def test_dispatch_tiles_source_missing_corridor_errors(self) -> None:
        """Tiles --source without --corridor returns exit code 1."""
        exit_code = main(["tiles", "--source", "public/data/routes/colorado-trail/corridor.pmtiles"])
        assert exit_code == 1

    def test_dispatch_tiles_source_nonexistent_source_errors(self, tmp_path: Path) -> None:
        """Tiles --source with nonexistent file returns exit code 1."""
        exit_code = main([
            "tiles",
            "--source", "/nonexistent.pmtiles",
            "--corridor", "public/data/routes/colorado-trail/corridor.geojson",
            "-o", str(tmp_path / "out.pmtiles"),
        ])
        assert exit_code == 1

    def test_dispatch_tiles_source_clipping_success(self, tmp_path: Path) -> None:
        """Tiles --source successfully clips PMTiles using corridor GeoJSON."""
        out_p = tmp_path / "clipped.pmtiles"
        exit_code = main([
            "tiles",
            "--source", "public/data/routes/colorado-trail/corridor.pmtiles",
            "--corridor", "public/data/routes/colorado-trail/corridor.geojson",
            "-o", str(out_p),
        ])
        assert exit_code == 0
        assert out_p.exists()
        with PMTilesArchive(out_p) as arch:
            assert arch.validate() is True
            assert arch.get_stats().tile_count > 0

    def test_dispatch_tiles_slice_success(self, tmp_path: Path) -> None:
        """Tiles --slice successfully slices corridor into sections."""
        out_d = tmp_path / "sliced_sections"
        exit_code = main([
            "tiles",
            "--slice",
            "--source", "public/data/routes/colorado-trail/corridor.pmtiles",
            "--track", str(COLORADO_TRACK),
            "-o", str(out_d),
        ])
        assert exit_code == 0
        assert (out_d / "section-3.pmtiles").exists()
        with PMTilesArchive(out_d / "section-3.pmtiles") as arch:
            assert arch.validate() is True

    def test_dispatch_tiles_validate_only(self) -> None:
        """Tiles --validate-only validates existing archive and exits 0."""
        exit_code = main([
            "tiles",
            "--validate-only",
            "-o", "public/data/routes/colorado-trail/corridor.pmtiles",
        ])
        assert exit_code == 0

    @mock.patch("engine.core.manifest.register_route")
    def test_dispatch_manifest(self, mock_manifest: mock.MagicMock, tmp_path: Path) -> None:
        mock_manifest.return_value = None
        dummy_manifest = tmp_path / "routes.json"
        dummy_manifest.write_text("{}", encoding="utf-8")
        exit_code = main([
            "manifest",
            "--routes-json", str(dummy_manifest),
            "--id", "route-1",
            "--name", "Route 1",
            "--description", "Desc",
        ])
        assert exit_code == 0
        mock_manifest.assert_called_once()


class TestPlacesCLIInteractive:
    """Verifies unmocked interactive engine.cli.places operations."""

    def test_interactive_point_search(self, tmp_path: Path) -> None:
        out_p = tmp_path / "point_search.json"
        exit_code = places_main([
            "--point", "39.7392,-104.9903",
            "--radius", "5000",
            "--output-json", str(out_p),
            "--mock",
        ])
        assert exit_code == 0
        assert out_p.exists()
        results = json.loads(out_p.read_text(encoding="utf-8"))
        assert len(results) > 0
        first = results[0]
        assert "id" in first
        assert "name" in first
        assert "category" in first
        assert "location" in first
        assert "distance_m" in first

    def test_interactive_mile_search(self, tmp_path: Path) -> None:
        out_p = tmp_path / "mile_search.json"
        exit_code = places_main([
            "--mile", "15.0",
            "--track", str(COLORADO_TRACK),
            "--output-json", str(out_p),
            "--mock",
        ])
        assert exit_code == 0
        assert out_p.exists()
        results = json.loads(out_p.read_text(encoding="utf-8"))
        assert len(results) > 0

    def test_interactive_category_filtering(self, tmp_path: Path) -> None:
        out_p = tmp_path / "filtered_search.json"
        exit_code = places_main([
            "--point", "39.5,-105.0",
            "--categories", "bike_shop,hotel",
            "--output-json", str(out_p),
            "--mock",
        ])
        assert exit_code == 0
        assert out_p.exists()
        results = json.loads(out_p.read_text(encoding="utf-8"))
        assert len(results) > 0
        assert all(p["category"] in ("bike_shop", "hotel") for p in results)


class TestCLIMainErrorHandling:
    """Verifies error conditions and exit code contracts."""

    def test_invalid_subcommand_exits_code_2(self) -> None:
        """Unknown subcommand should raise SystemExit(2) and output error."""
        with pytest.raises(SystemExit) as exc_info:
            main(["nonexistent-subcommand"])
        assert exc_info.value.code == 2

    @mock.patch("engine.cli.ingest.main")
    def test_subcommand_error_propagates_exit_code_1(self, mock_ingest: mock.MagicMock) -> None:
        """When handler raises an exception, main returns 1."""
        mock_ingest.side_effect = RuntimeError("Disk full error")
        exit_code = main(["ingest", "--gpx", "test.gpx"])
        assert exit_code == 1

"""
engine.cli - Command-line interface and master ingestion pipeline for Bikepack Navigator.
"""

from typing import Any

__all__ = [
    "build_parser",
    "main",
    "IngestConfig",
    "IngestResult",
    "run_ingest",
    "register_places_parser",
]


def __getattr__(name: str) -> Any:
    if name in ("build_parser", "main"):
        from engine.cli.main import build_parser, main
        return {"build_parser": build_parser, "main": main}[name]
    if name in ("IngestConfig", "IngestResult", "run_ingest"):
        from engine.cli.ingest import IngestConfig, IngestResult, run_ingest
        return {
            "IngestConfig": IngestConfig,
            "IngestResult": IngestResult,
            "run_ingest": run_ingest,
        }[name]
    if name == "register_places_parser":
        from engine.cli.places import register_places_parser
        return register_places_parser
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")

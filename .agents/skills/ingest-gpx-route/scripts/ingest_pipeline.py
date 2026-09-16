#!/usr/bin/env python3
"""
ingest_pipeline.py - Backward-compatible forwarder delegating to engine.cli.ingest.
"""

import sys
from pathlib import Path


def _find_project_root() -> Path:
    p = Path(__file__).resolve()
    for parent in p.parents:
        if (parent / "engine").is_dir():
            return parent
    return p.parents[4]


PROJECT_ROOT = _find_project_root()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from engine.cli.ingest import IngestConfig, IngestResult, main as ingest_main, run_ingest

__all__ = ["IngestConfig", "IngestResult", "run_ingest", "main"]


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    return ingest_main(argv)


if __name__ == "__main__":
    sys.exit(main())

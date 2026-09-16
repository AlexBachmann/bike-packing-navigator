"""
engine/tests/test_utils_io.py - Unit tests for safe atomic filesystem and JSON reading/writing.
"""

import json
import os
from pathlib import Path
import pytest
from engine.utils.io import (
    atomic_write_json,
    read_json,
    safe_read_json,
    atomic_write_text,
    read_text,
    atomic_write_bytes,
    ensure_directory,
)


@pytest.mark.unit
@pytest.mark.io
class TestAtomicIO:
    """Tests for safe atomic reading and writing of JSON and text files."""

    def test_atomic_write_and_read_json(self, tmp_path):
        target_file = tmp_path / "route_data.json"
        data = {
            "name": "Béni Mellal to Essaouira",
            "distance_km": 120.5,
            "waypoints": [
                {"name": "Spring 1", "ele": 1450.2},
                {"name": "Col de Tazerkount", "ele": 2230.0},
            ],
        }

        atomic_write_json(target_file, data, indent=2)
        assert target_file.exists()

        loaded = read_json(target_file)
        assert loaded == data

        # Test safe_read_json alias
        assert safe_read_json(target_file) == data

    def test_atomic_write_creates_nested_directories(self, tmp_path):
        target_file = tmp_path / "subdir" / "nested" / "output.json"
        atomic_write_json(target_file, {"status": "ok"})
        assert target_file.exists()
        assert read_json(target_file) == {"status": "ok"}

    def test_read_json_missing_file_without_default(self, tmp_path):
        target_file = tmp_path / "non_existent.json"
        with pytest.raises(FileNotFoundError):
            read_json(target_file)

    def test_read_json_missing_file_with_default(self, tmp_path):
        target_file = tmp_path / "non_existent.json"
        fallback = {"routes": []}
        result = read_json(target_file, default=fallback)
        assert result == fallback

    def test_read_json_corrupted_file(self, tmp_path):
        target_file = tmp_path / "corrupted.json"
        target_file.write_text("{ incomplete_json: ", encoding="utf-8")
        with pytest.raises(json.JSONDecodeError):
            read_json(target_file)

    def test_read_json_corrupted_file_with_default(self, tmp_path):
        target_file = tmp_path / "corrupted_default.json"
        target_file.write_text("{ incomplete_json: ", encoding="utf-8")
        fallback = {"status": "fallback"}
        assert read_json(target_file, default=fallback) == fallback
        assert safe_read_json(target_file, default=fallback) == fallback

    def test_read_json_empty_file_with_default(self, tmp_path):
        target_file = tmp_path / "empty.json"
        target_file.write_text("", encoding="utf-8")
        fallback = {"status": "empty_fallback"}
        assert read_json(target_file, default=fallback) == fallback
        assert safe_read_json(target_file, default=fallback) == fallback

    def test_read_json_empty_file_without_default(self, tmp_path):
        target_file = tmp_path / "empty_nodefault.json"
        target_file.write_text("", encoding="utf-8")
        with pytest.raises(json.JSONDecodeError):
            read_json(target_file)

    def test_read_json_invalid_unicode_with_default(self, tmp_path):
        target_file = tmp_path / "invalid_unicode.json"
        target_file.write_bytes(b"\xff\xfe\x00\x01\x80\x81")
        fallback = {"status": "unicode_fallback"}
        assert read_json(target_file, default=fallback) == fallback
        assert safe_read_json(target_file, default=fallback) == fallback

    def test_read_json_invalid_unicode_without_default(self, tmp_path):
        target_file = tmp_path / "invalid_unicode_nodefault.json"
        target_file.write_bytes(b"\xff\xfe\x00\x01\x80\x81")
        with pytest.raises(UnicodeDecodeError):
            read_json(target_file)

    def test_atomic_write_text_cleanup_on_failure(self, tmp_path, monkeypatch):
        target_file = tmp_path / "failed_text.txt"

        def fake_failing_replace(src, dst):
            raise OSError("Simulated filesystem error during atomic replace")

        monkeypatch.setattr(os, "replace", fake_failing_replace)

        with pytest.raises(OSError, match="Simulated filesystem error"):
            atomic_write_text(target_file, "some transient text")

        assert not target_file.exists()
        leaked_tmps = list(tmp_path.glob("*.tmp"))
        assert len(leaked_tmps) == 0

    def test_atomic_write_bytes_cleanup_on_failure(self, tmp_path, monkeypatch):
        target_file = tmp_path / "failed_bytes.bin"

        def fake_failing_replace(src, dst):
            raise OSError("Simulated filesystem error during atomic replace")

        monkeypatch.setattr(os, "replace", fake_failing_replace)

        with pytest.raises(OSError, match="Simulated filesystem error"):
            atomic_write_bytes(target_file, b"\x00\x01\x02\x03")

        assert not target_file.exists()
        leaked_tmps = list(tmp_path.glob("*.tmp"))
        assert len(leaked_tmps) == 0

    def test_atomic_write_and_read_text(self, tmp_path):
        target_file = tmp_path / "notes.txt"
        content = "Bikepacking Guidebook\nLine 2: High elevation pass\n"
        atomic_write_text(target_file, content)
        assert target_file.exists()
        assert read_text(target_file) == content

    def test_atomic_write_bytes(self, tmp_path):
        target_file = tmp_path / "binary.bin"
        data = b"\x00\x01\x02\xff\xfe"
        atomic_write_bytes(target_file, data)
        assert target_file.exists()
        assert target_file.read_bytes() == data

    def test_ensure_directory(self, tmp_path):
        nested = tmp_path / "a" / "b" / "c"
        result = ensure_directory(nested)
        assert result.exists()
        assert result.is_dir()

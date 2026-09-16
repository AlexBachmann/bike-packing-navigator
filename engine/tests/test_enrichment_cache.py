"""
Unit tests for engine.enrichment.cache: persistent disk cache, SHA-256 hashing,
TTL expiration, atomic replacement, and offline fallbacks.
"""

import json
from pathlib import Path
import time
import pytest

from engine.enrichment.cache import (
    APICache,
    CacheCorruptedError,
    CacheEntry,
    DEFAULT_TTL_PLACES_SEC,
)


class TestCacheEntry:
    def test_cache_entry_dataclass_properties_and_serialization(self):
        now = time.time()
        entry = CacheEntry(
            key="places:test:1",
            key_hash="abc123hash",
            namespace="places",
            data={"places": ["p1", "p2"]},
            created_at=now,
            ttl_seconds=3600.0,
            expires_at=now + 3600.0,
            metadata={"source": "test"}
        )

        assert not entry.is_expired
        d = entry.to_dict()
        assert d["key"] == "places:test:1"
        assert d["data"] == {"places": ["p1", "p2"]}
        assert d["ttl_seconds"] == 3600.0

        recreated = CacheEntry.from_dict(d)
        assert recreated.key == entry.key
        assert recreated.key_hash == entry.key_hash
        assert recreated.data == entry.data
        assert recreated.expires_at == entry.expires_at

    def test_cache_entry_expired(self):
        past = time.time() - 100.0
        entry = CacheEntry(
            key="k",
            key_hash="h",
            namespace="n",
            data="data",
            created_at=past - 50.0,
            ttl_seconds=10.0,
            expires_at=past
        )
        assert entry.is_expired

    def test_cache_entry_invalid_from_dict(self):
        with pytest.raises(CacheCorruptedError):
            CacheEntry.from_dict("not a dict")  # type: ignore

        with pytest.raises(CacheCorruptedError):
            CacheEntry.from_dict({"no_key": "val"})


class TestAPICache:
    @pytest.fixture
    def cache(self, tmp_path):
        return APICache(cache_dir=tmp_path / "cache", namespace="test_ns", default_ttl_seconds=3600.0)

    def test_hash_key_deterministic_and_sha256(self, cache):
        key = "test_endpoint_query"
        h1 = cache.hash_key(key)
        h2 = cache.hash_key(key)
        assert h1 == h2
        assert len(h1) == 64
        assert int(h1, 16) > 0

    def test_build_key_normalization(self, cache):
        params1 = {
            "lat": 39.12345678,
            "lon": -105.98765432,
            "radius": 5000,
            "types": ["supermarket", "bicycle_store"]
        }
        params2 = {
            "types": ["bicycle_store", "supermarket"],
            "radius": 5000,
            "lon": -105.98765,
            "lat": 39.12346
        }
        k1 = cache.build_key("searchNearby", params1)
        k2 = cache.build_key("searchNearby", params2)
        assert k1 == k2

    def test_atomic_set_and_get(self, cache):
        key = cache.build_key("endpoint", {"id": 42})
        data = {"result": "success", "count": 5}

        saved_path = cache.set(key, data)
        assert saved_path.exists()

        retrieved = cache.get(key)
        assert retrieved == data

    def test_get_cache_miss_returns_default(self, cache):
        assert cache.get("nonexistent_key") is None
        assert cache.get("nonexistent_key", default="fallback") == "fallback"

    def test_ttl_expiration_behavior(self, cache):
        key = "short_lived_key"
        cache.set(key, {"value": "ephemeral"}, ttl_seconds=0.05)

        assert cache.get(key) == {"value": "ephemeral"}
        time.sleep(0.08)

        # Expired: returns default unless allow_expired=True
        assert cache.get(key) is None
        assert cache.get(key, allow_expired=True) == {"value": "ephemeral"}

    def test_has_method(self, cache):
        key = "has_key"
        assert not cache.has(key)

        cache.set(key, "present", ttl_seconds=0.05)
        assert cache.has(key)

        time.sleep(0.08)
        assert not cache.has(key, allow_expired=False)
        assert cache.has(key, allow_expired=True)

    def test_delete_method(self, cache):
        key = "delete_key"
        cache.set(key, "to_delete")
        assert cache.has(key)

        assert cache.delete(key) is True
        assert not cache.has(key)
        assert cache.delete(key) is False

    def test_clear_method(self, cache):
        for i in range(5):
            cache.set(f"key_{i}", f"val_{i}")
        assert cache.clear() == 5
        assert cache.clear() == 0

    def test_prune_expired(self, cache):
        cache.set("fresh_key", "keep_me", ttl_seconds=100.0)
        cache.set("stale_key_1", "prune_me", ttl_seconds=0.02)
        cache.set("stale_key_2", "prune_me_too", ttl_seconds=0.02)

        time.sleep(0.05)
        pruned_count = cache.prune_expired()
        assert pruned_count == 2
        assert cache.has("fresh_key")
        assert not cache.has("stale_key_1")

    def test_get_or_compute(self, cache):
        call_counter = {"calls": 0}

        def expensive_computation():
            call_counter["calls"] += 1
            return {"result": 42}

        # First call computes
        res1 = cache.get_or_compute("compute_key", expensive_computation)
        assert res1 == {"result": 42}
        assert call_counter["calls"] == 1

        # Second call hits cache
        res2 = cache.get_or_compute("compute_key", expensive_computation)
        assert res2 == {"result": 42}
        assert call_counter["calls"] == 1

    def test_get_or_compute_fallback_on_error(self, cache):
        key = "compute_error_key"
        cache.set(key, "stale_result", ttl_seconds=0.02)
        time.sleep(0.05)

        def failing_computation():
            raise RuntimeError("API Offline")

        # Computes, fails, and gracefully returns stale cached data
        fallback = cache.get_or_compute(key, failing_computation, allow_expired_on_error=True)
        assert fallback == "stale_result"

    def test_import_legacy_dict(self, cache):
        legacy = {
            "39.4909,-105.0942_10000": [{"name": "Waterton General Store"}],
            "39.3875,-105.2711_10000": [{"name": "Buffalo Creek Outpost"}]
        }
        count = cache.import_legacy_dict(legacy)
        assert count == 2

        k1 = f"{cache.namespace}:legacy:39.4909,-105.0942_10000"
        assert cache.has(k1)
        assert cache.get(k1) == [{"name": "Waterton General Store"}]

    def test_corrupted_cache_file_handling(self, cache):
        key = "corrupt_key"
        h = cache.hash_key(key)
        path = cache.get_path(h)
        path.write_text("{ broken json: [")

        # Corrupted entry gracefully treated as cache miss
        assert cache.get(key) is None

"""
engine.enrichment.cache - Persistent, atomic, thread-safe disk caching for external APIs.

Provides SHA-256 deterministic key hashing, isolated namespaces, configurable TTLs,
POSIX-atomic file writes, and offline fallback mechanisms for external data queries.
"""

from dataclasses import dataclass, field
import hashlib
import json
import logging
import os
from pathlib import Path
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Union

from engine.utils.io import atomic_write_json, ensure_directory, read_json

logger = logging.getLogger(__name__)

DEFAULT_CACHE_ROOT = Path(".cache") / "enrichment"
DEFAULT_TTL_PLACES_SEC = 30.0 * 86400.0   # 30 days
DEFAULT_TTL_OVERPASS_SEC = 14.0 * 86400.0  # 14 days


class CacheError(Exception):
    """Base exception for caching errors."""
    pass


class CacheCorruptedError(CacheError):
    """Raised when a cached entry file cannot be decoded or is invalid."""
    pass


@dataclass
class CacheEntry:
    """
    Envelope representing a cached item with metadata and expiration tracking.
    """
    key: str
    key_hash: str
    namespace: str
    data: Any
    created_at: float
    ttl_seconds: Optional[float] = None
    expires_at: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_expired(self) -> bool:
        """Return True if entry has an expiration timestamp and current time exceeds it."""
        if self.expires_at is None:
            return False
        return time.time() > self.expires_at

    def to_dict(self) -> Dict[str, Any]:
        """Serialize CacheEntry to dictionary."""
        return {
            "key": self.key,
            "key_hash": self.key_hash,
            "namespace": self.namespace,
            "created_at": self.created_at,
            "ttl_seconds": self.ttl_seconds,
            "expires_at": self.expires_at,
            "metadata": self.metadata,
            "data": self.data,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CacheEntry":
        """Deserialize CacheEntry from dictionary."""
        if not isinstance(d, dict):
            raise CacheCorruptedError("Cache entry payload is not a dictionary")
        if "key" not in d or "data" not in d:
            raise CacheCorruptedError("Cache entry missing required fields 'key' or 'data'")

        return cls(
            key=str(d.get("key", "")),
            key_hash=str(d.get("key_hash", "")),
            namespace=str(d.get("namespace", "default")),
            data=d.get("data"),
            created_at=float(d.get("created_at", time.time())),
            ttl_seconds=float(d["ttl_seconds"]) if d.get("ttl_seconds") is not None else None,
            expires_at=float(d["expires_at"]) if d.get("expires_at") is not None else None,
            metadata=dict(d.get("metadata", {})),
        )


class APICache:
    """
    Persistent, thread-safe, atomic disk cache for external API responses.
    
    Each cached query is stored as an individual JSON file identified by the
    SHA-256 hash of its canonical query parameters.
    """

    def __init__(
        self,
        cache_dir: Optional[Union[Path, str]] = None,
        namespace: str = "places",
        default_ttl_seconds: Optional[float] = DEFAULT_TTL_PLACES_SEC,
    ):
        if cache_dir is None:
            env_dir = os.environ.get("ENGINE_CACHE_DIR")
            self.root_dir = Path(env_dir) if env_dir else DEFAULT_CACHE_ROOT
        else:
            self.root_dir = Path(cache_dir)

        self.namespace = namespace.strip() or "default"
        self.default_ttl = default_ttl_seconds
        self.namespace_dir = self.root_dir / self.namespace
        ensure_directory(self.namespace_dir)

    def hash_key(self, key: str) -> str:
        """Compute deterministic 64-character SHA-256 hex digest of key string."""
        return hashlib.sha256(key.encode("utf-8")).hexdigest()

    def build_key(self, endpoint: str, params: Dict[str, Any]) -> str:
        """
        Generate a canonical, deterministic key string for given endpoint and params.
        Floating point numbers are rounded to 5 decimal places and dicts/lists are sorted.
        """
        norm_params = self._normalize_params(params)
        payload_str = json.dumps(norm_params, sort_keys=True, ensure_ascii=False)
        return f"{self.namespace}:{endpoint}:{payload_str}"

    def _normalize_params(self, val: Any) -> Any:
        """Recursively normalize floating points and sort collections."""
        if isinstance(val, dict):
            return {str(k): self._normalize_params(v) for k, v in sorted(val.items())}
        elif isinstance(val, (list, tuple, set)):
            items = [self._normalize_params(v) for v in val]
            try:
                return sorted(items)
            except TypeError:
                return sorted(items, key=lambda x: json.dumps(x, sort_keys=True))
        elif isinstance(val, float):
            return round(val, 5)
        return val

    def get_path(self, key_hash: str) -> Path:
        """Return filesystem path for given key hash."""
        return self.namespace_dir / f"{key_hash}.json"

    def get(
        self,
        key: str,
        default: Any = None,
        allow_expired: bool = False
    ) -> Optional[Any]:
        """
        Retrieve data from cache.
        
        Args:
            key: Canonical key string.
            default: Fallback return value on cache miss.
            allow_expired: If True, returns stale data when expired (useful offline).
        """
        key_hash = self.hash_key(key)
        path = self.get_path(key_hash)

        if not path.exists():
            return default

        try:
            raw_dict = read_json(path)
            entry = CacheEntry.from_dict(raw_dict)
        except Exception as e:
            logger.warning(f"Cache entry unreadable or corrupted at {path}: {e}")
            return default

        if entry.is_expired and not allow_expired:
            return default

        return entry.data

    def set(
        self,
        key: str,
        data: Any,
        ttl_seconds: Optional[float] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Path:
        """
        Atomically write entry to disk cache.
        """
        key_hash = self.hash_key(key)
        path = self.get_path(key_hash)
        now = time.time()
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        expires_at = (now + ttl) if (ttl is not None and ttl > 0) else None

        entry = CacheEntry(
            key=key,
            key_hash=key_hash,
            namespace=self.namespace,
            data=data,
            created_at=now,
            ttl_seconds=ttl,
            expires_at=expires_at,
            metadata=metadata or {},
        )

        atomic_write_json(path, entry.to_dict(), indent=2)
        return path

    def has(self, key: str, allow_expired: bool = False) -> bool:
        """Check whether key exists in cache and is valid."""
        return self.get(key, default=None, allow_expired=allow_expired) is not None

    def delete(self, key: str) -> bool:
        """Delete specific cache entry if it exists."""
        key_hash = self.hash_key(key)
        path = self.get_path(key_hash)
        if path.exists():
            try:
                path.unlink()
                return True
            except OSError as e:
                logger.warning(f"Failed to unlink cache entry {path}: {e}")
        return False

    def clear(self) -> int:
        """Delete all cache entries in this namespace directory."""
        count = 0
        if not self.namespace_dir.exists():
            return 0
        for f in self.namespace_dir.glob("*.json"):
            try:
                f.unlink()
                count += 1
            except OSError:
                continue
        return count

    def prune_expired(self) -> int:
        """Scan and delete all expired entries in this namespace directory."""
        count = 0
        if not self.namespace_dir.exists():
            return 0
        now = time.time()
        for f in self.namespace_dir.glob("*.json"):
            try:
                raw_dict = read_json(f)
                entry = CacheEntry.from_dict(raw_dict)
                if entry.expires_at is not None and now > entry.expires_at:
                    f.unlink()
                    count += 1
            except Exception:
                # Corrupted or unreadable files can also be pruned or skipped
                continue
        return count

    def get_or_compute(
        self,
        key: str,
        compute_fn: Callable[[], Any],
        ttl_seconds: Optional[float] = None,
        metadata: Optional[Dict[str, Any]] = None,
        allow_expired_on_error: bool = True
    ) -> Any:
        """Convenience method: get from cache or compute and store."""
        cached = self.get(key, default=None)
        if cached is not None:
            return cached

        try:
            computed_data = compute_fn()
            self.set(key, computed_data, ttl_seconds=ttl_seconds, metadata=metadata)
            return computed_data
        except Exception as err:
            if allow_expired_on_error:
                stale = self.get(key, default=None, allow_expired=True)
                if stale is not None:
                    logger.warning(f"compute_fn failed ({err}), falling back to stale cache for {key}")
                    return stale
            raise

    def import_legacy_dict(self, legacy_dict: Dict[str, Any]) -> int:
        """Import entries from legacy single-file cache into hashed individual files."""
        count = 0
        for legacy_key, data in legacy_dict.items():
            key = f"{self.namespace}:legacy:{legacy_key}"
            self.set(key, data, metadata={"legacy_key": str(legacy_key)})
            count += 1
        return count

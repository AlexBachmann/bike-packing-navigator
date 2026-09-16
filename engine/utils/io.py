"""
engine.utils.io - Atomic file operations and safe JSON reading/writing.

Guarantees data integrity by writing to a temporary file in the destination
directory before performing an atomic POSIX rename (`os.replace`).
Prevents partial writes or corrupted JSON files if execution is interrupted.
"""

from pathlib import Path
from typing import Any, Optional, Union
import json
import os
import tempfile


def ensure_directory(path: Union[Path, str]) -> Path:
    """Ensure that the target directory (or parent directory) exists."""
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def atomic_write_text(
    path: Union[Path, str],
    content: str,
    encoding: str = "utf-8"
) -> None:
    """
    Atomically write text content to path using a temporary file and replace.

    Args:
        path: Destination filepath.
        content: Text content to write.
        encoding: Character encoding (default: utf-8).
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    tmp_name: Optional[str] = None
    success = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding=encoding,
            dir=target.parent,
            delete=False,
            suffix=".tmp"
        ) as tf:
            tmp_name = tf.name
            tf.write(content)

        os.replace(tmp_name, target)
        success = True
    finally:
        if not success and tmp_name is not None and os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except OSError:
                pass


def atomic_write_bytes(
    path: Union[Path, str],
    data: bytes
) -> None:
    """Atomically write binary data to path using a temporary file and replace."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    tmp_name: Optional[str] = None
    success = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=target.parent,
            delete=False,
            suffix=".tmp"
        ) as tf:
            tmp_name = tf.name
            tf.write(data)

        os.replace(tmp_name, target)
        success = True
    finally:
        if not success and tmp_name is not None and os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except OSError:
                pass


def atomic_write_json(
    path: Union[Path, str],
    data: Any,
    indent: Optional[int] = 2,
    sort_keys: bool = False,
    ensure_ascii: bool = False
) -> None:
    """
    Atomically serialize and write data as formatted JSON.

    Args:
        path: Target filepath.
        data: JSON-serializable Python data structure.
        indent: Indentation spaces (default: 2).
        sort_keys: Whether to sort dictionary keys.
        ensure_ascii: If False, writes authentic UTF-8 characters.
    """
    content = json.dumps(
        data,
        indent=indent,
        sort_keys=sort_keys,
        ensure_ascii=ensure_ascii
    ) + "\n"
    atomic_write_text(path, content, encoding="utf-8")


def read_json(
    path: Union[Path, str],
    default: Optional[Any] = None
) -> Any:
    """
    Safely read and parse a JSON file.

    Args:
        path: Path to JSON file.
        default: Fallback return value if file does not exist.
                 If None and file does not exist, raises FileNotFoundError.

    Returns:
        Parsed JSON data structure.
    """
    p = Path(path)
    if not p.exists():
        if default is not None:
            return default
        raise FileNotFoundError(f"JSON file not found: {p}")

    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError):
        if default is not None:
            return default
        raise


safe_read_json = read_json


def read_text(
    path: Union[Path, str],
    encoding: str = "utf-8"
) -> str:
    """
    Read text content from a file.

    Args:
        path: Filepath to read.
        encoding: Character encoding (default: utf-8).

    Returns:
        String content of file.
    """
    p = Path(path)
    with open(p, "r", encoding=encoding) as f:
        return f.read()

"""Shared disk-cache helper used across all pipeline modules.

Every external API call should go through ``disk_cached`` so re-running the
pipeline on the same inputs is instant. The cache key is the hash of an
arbitrary JSON-serializable payload (request params, prompt, etc).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


def hash_key(payload: Any) -> str:
    """8-char stable hex hash of a JSON-serializable payload."""
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()[:8]


def disk_cached(
    cache_dir: Path,
    label: str,
    key: Any,
    fn: Callable[[], T],
    *,
    parser: Callable[[str], T] | None = None,
    serializer: Callable[[T], str] | None = None,
) -> T:
    """Run ``fn()`` unless a cached result exists at ``cache_dir/{label}__{hash}.json``.

    If ``parser`` is provided, it's used to deserialize cached text to ``T``.
    Otherwise: Pydantic models are auto-serialized via ``model_dump_json``,
    everything else via ``json.dumps``.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{label}__{hash_key(key)}.json"

    if path.exists():
        if parser is not None:
            return parser(path.read_text())
        return json.loads(path.read_text())

    result = fn()

    if serializer is not None:
        path.write_text(serializer(result))
    elif isinstance(result, BaseModel):
        path.write_text(result.model_dump_json(indent=2))
    else:
        path.write_text(json.dumps(result, default=str, indent=2))

    return result

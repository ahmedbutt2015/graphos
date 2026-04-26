"""Canonical, deterministic JSON serialization used for state hashing.

Sorted keys + circular-reference safety. Used by LoopGuard (state mode) and
MCPGuard (call fingerprints) so that semantically-equal payloads produce
identical strings regardless of object key order.
"""

from __future__ import annotations

import json
from typing import Any


def canonical(value: Any) -> str:
    seen: set[int] = set()

    def walk(v: Any) -> Any:
        if v is None or isinstance(v, (bool, int, float, str)):
            return v
        if isinstance(v, list | tuple):
            return [walk(item) for item in v]
        if isinstance(v, dict):
            obj_id = id(v)
            if obj_id in seen:
                return "[Circular]"
            seen.add(obj_id)
            out = {k: walk(v[k]) for k in sorted(v)}
            seen.discard(obj_id)
            return out
        # Pydantic / dataclass-ish — fall back to dict-like
        if hasattr(v, "model_dump"):
            return walk(v.model_dump())
        if hasattr(v, "__dict__"):
            obj_id = id(v)
            if obj_id in seen:
                return "[Circular]"
            seen.add(obj_id)
            out = {k: walk(getattr(v, k)) for k in sorted(vars(v))}
            seen.discard(obj_id)
            return out
        # last resort — string repr
        return repr(v)

    return json.dumps(walk(value), separators=(",", ":"), sort_keys=False)


__all__ = ["canonical"]

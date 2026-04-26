"""LoopGuard — halt when a node loops too many times."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal, TypeAlias

from .._canonical import canonical
from ..types import NodeExecution, PolicyContext, PolicyDecision, cont, halt

LoopGuardMode: TypeAlias = Literal["state", "node"]

_DEFAULT_MAX_REPEATS = 3


class LoopGuard:
    """Halt the run when a node is revisited too many times.

    Two modes:

    * ``mode="state"`` (default) — counts identical-state revisits to a node.
      Catches deterministic ping-pong loops where the agent is stuck.
    * ``mode="node"`` — counts node visits regardless of state. Use this for
      real LangGraph agents whose ``messages`` array grows on every iteration,
      so "identical state" never actually triggers.
    """

    name = "LoopGuard"

    def __init__(
        self,
        *,
        max_repeats: int = _DEFAULT_MAX_REPEATS,
        mode: LoopGuardMode = "state",
        key: Callable[[NodeExecution[Any]], str] | None = None,
    ) -> None:
        self._max_repeats = max_repeats
        self._mode: LoopGuardMode = mode
        if key is not None:
            self._key_fn = key
        elif mode == "node":
            self._key_fn = self._node_key
        else:
            self._key_fn = self._state_key
        self._counts: dict[str, int] = {}

    def observe(
        self, execution: NodeExecution[Any], _ctx: PolicyContext
    ) -> PolicyDecision:
        key = self._key_fn(execution)
        next_count = self._counts.get(key, 0) + 1
        self._counts[key] = next_count
        if next_count > self._max_repeats:
            if self._mode == "node":
                reason = (
                    f'node "{execution.node}" visited {next_count} times '
                    f"(limit {self._max_repeats})"
                )
            else:
                reason = (
                    f'node "{execution.node}" revisited with identical state '
                    f"{next_count} times (limit {self._max_repeats})"
                )
            return halt(
                self.name,
                reason,
                {
                    "node": execution.node,
                    "count": next_count,
                    "step": execution.step,
                    "mode": self._mode,
                },
            )
        return cont()

    def reset(self, _ctx: PolicyContext) -> None:
        self._counts = {}

    @staticmethod
    def _state_key(exec_: NodeExecution[Any]) -> str:
        return canonical([exec_.node, exec_.state])

    @staticmethod
    def _node_key(exec_: NodeExecution[Any]) -> str:
        return exec_.node


__all__ = ["LoopGuard", "LoopGuardMode"]

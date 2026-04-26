"""Errors raised by graphos_io."""

from __future__ import annotations

from typing import Any

from .types import _Halt


class PolicyViolationError(RuntimeError):
    """Raised by `wrap()` when a policy returns a halt decision.

    Attributes mirror the halt payload so callers can branch on policy name
    without re-parsing the message string.
    """

    policy: str
    reason: str
    details: Any | None

    def __init__(self, decision: _Halt) -> None:
        super().__init__(f"{decision.policy}: {decision.reason}")
        self.policy = decision.policy
        self.reason = decision.reason
        self.details = decision.details


__all__ = ["PolicyViolationError"]

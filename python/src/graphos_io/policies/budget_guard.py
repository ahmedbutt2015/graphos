"""BudgetGuard — cap cumulative cost per session."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from ..types import NodeExecution, PolicyContext, PolicyDecision, cont, halt


class BudgetGuard:
    """Halt when cumulative cost exceeds ``usd_limit``.

    Pair with :func:`graphos_io.token_cost` for the common LangChain case.
    """

    name = "BudgetGuard"

    def __init__(
        self,
        *,
        usd_limit: float,
        cost: Callable[[NodeExecution[Any]], float],
    ) -> None:
        if usd_limit <= 0:
            raise ValueError("BudgetGuard: usd_limit must be > 0")
        self._usd_limit = usd_limit
        self._cost_fn = cost
        self._spent = 0.0

    def observe(
        self, execution: NodeExecution[Any], _ctx: PolicyContext
    ) -> PolicyDecision:
        step_cost = self._cost_fn(execution)
        if (
            not isinstance(step_cost, (int, float))
            or math.isnan(step_cost)
            or math.isinf(step_cost)
            or step_cost < 0
        ):
            return halt(
                self.name,
                f'cost extractor returned invalid value {step_cost!r} '
                f'for node "{execution.node}"',
                {
                    "node": execution.node,
                    "step": execution.step,
                    "value": step_cost,
                },
            )
        self._spent += float(step_cost)
        if self._spent > self._usd_limit:
            return halt(
                self.name,
                f"session cost ${self._spent:.4f} exceeded limit ${self._usd_limit:.4f}",
                {
                    "node": execution.node,
                    "step": execution.step,
                    "spent": self._spent,
                    "limit": self._usd_limit,
                },
            )
        return cont()

    def reset(self, _ctx: PolicyContext) -> None:
        self._spent = 0.0


__all__ = ["BudgetGuard"]

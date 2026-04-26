from __future__ import annotations

from typing import Any

from graphos_io import NodeExecution, PolicyContext


def make_exec(node: str, state: Any, step: int = 0) -> NodeExecution[Any]:
    return NodeExecution(
        sessionId="sess_1",
        node=node,
        state=state,
        step=step,
        timestamp=0,
    )


CTX = PolicyContext(sessionId="sess_1")

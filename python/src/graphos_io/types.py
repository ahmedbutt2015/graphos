"""Public types and event schema for graphos_io.

These mirror the JSON wire format used by the GraphOS dashboard so that
Python and TypeScript SDKs can stream into the same trace store.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Generic, Literal, Protocol, TypeAlias, TypeVar, runtime_checkable

from pydantic import BaseModel, ConfigDict

SessionId: TypeAlias = str
NodeId: TypeAlias = str
SessionOutcome: TypeAlias = Literal["complete", "halted", "error"]

TState = TypeVar("TState")


class NodeExecution(BaseModel, Generic[TState]):
    """One step's worth of context handed to each policy."""

    model_config = ConfigDict(arbitrary_types_allowed=True, frozen=True)

    sessionId: SessionId
    node: NodeId
    state: TState
    step: int
    timestamp: int


class _Cont(BaseModel):
    model_config = ConfigDict(frozen=True)
    kind: Literal["continue"] = "continue"


class _Halt(BaseModel):
    model_config = ConfigDict(frozen=True)
    kind: Literal["halt"] = "halt"
    policy: str
    reason: str
    details: Any | None = None


PolicyDecision: TypeAlias = _Cont | _Halt


def cont() -> PolicyDecision:
    """Return a continue decision."""
    return _Cont()


def halt(policy: str, reason: str, details: Any | None = None) -> PolicyDecision:
    """Return a halt decision tagged with the policy name and a human reason."""
    return _Halt(policy=policy, reason=reason, details=details)


class PolicyContext(BaseModel):
    model_config = ConfigDict(frozen=True)
    sessionId: SessionId


@runtime_checkable
class Policy(Protocol, Generic[TState]):
    """Implement this protocol to add a custom guard.

    `observe` runs once per node step. Returning `halt(...)` aborts the
    session and raises `PolicyViolationError` from the wrapped graph.
    """

    name: str

    def observe(
        self, execution: NodeExecution[TState], ctx: PolicyContext
    ) -> PolicyDecision: ...

    def reset(self, ctx: PolicyContext) -> None:  # pragma: no cover - optional
        ...


class MCPToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    server: str | None = None
    tool: str
    args: Any | None = None


class MCPToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    content: Any | None = None
    isError: bool | None = None
    raw: Any | None = None


# --------------------------------------------------------------------------- #
# Trace events. Field names match the TypeScript SDK exactly so the dashboard
# can consume both wire formats interchangeably.
# --------------------------------------------------------------------------- #


class _BaseEvent(BaseModel):
    model_config = ConfigDict(extra="allow")
    sessionId: SessionId
    timestamp: int


class SessionStartEvent(_BaseEvent):
    kind: Literal["session.start"] = "session.start"
    projectId: str | None = None
    input: Any | None = None


class StepEvent(_BaseEvent, Generic[TState]):
    kind: Literal["step"] = "step"
    node: NodeId
    state: TState
    step: int


class PolicyHaltEvent(_BaseEvent):
    kind: Literal["policy.halt"] = "policy.halt"
    policy: str
    reason: str
    step: int
    details: Any | None = None


class SessionEndEvent(_BaseEvent):
    kind: Literal["session.end"] = "session.end"
    outcome: SessionOutcome
    error: dict[str, str] | None = None


class MCPCallEvent(_BaseEvent):
    kind: Literal["mcp.call"] = "mcp.call"
    server: str | None = None
    tool: str
    args: Any | None = None
    source: Literal["graph", "proxy"]
    step: int | None = None


class MCPResultEvent(_BaseEvent):
    kind: Literal["mcp.result"] = "mcp.result"
    server: str | None = None
    tool: str
    result: MCPToolResult
    source: Literal["graph", "proxy"]
    step: int | None = None


class MCPBlockedEvent(_BaseEvent):
    kind: Literal["mcp.blocked"] = "mcp.blocked"
    server: str | None = None
    tool: str
    reason: str
    details: Any | None = None
    source: Literal["graph", "proxy"]
    step: int | None = None


TraceEvent: TypeAlias = (
    SessionStartEvent
    | StepEvent[Any]
    | PolicyHaltEvent
    | SessionEndEvent
    | MCPCallEvent
    | MCPResultEvent
    | MCPBlockedEvent
)

TraceListener: TypeAlias = Callable[[TraceEvent], None | Awaitable[None]]


__all__ = [
    "MCPBlockedEvent",
    "MCPCallEvent",
    "MCPResultEvent",
    "MCPToolCall",
    "MCPToolResult",
    "NodeExecution",
    "NodeId",
    "Policy",
    "PolicyContext",
    "PolicyDecision",
    "PolicyHaltEvent",
    "SessionEndEvent",
    "SessionId",
    "SessionOutcome",
    "SessionStartEvent",
    "StepEvent",
    "TraceEvent",
    "TraceListener",
    "cont",
    "halt",
]

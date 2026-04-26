"""GraphOS.wrap — observe + guard a compiled LangGraph (Python).

The wrap is async-first because LangGraph Python's stream is ``astream()``.
We default to ``stream_mode="updates"`` and ``subgraphs=True`` so that
subgraph steps surface as qualified node names like ``response_agent/llm_call``
(matching the TypeScript SDK).
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import time
from collections.abc import AsyncIterator, Iterable, Sequence
from typing import Any, Generic, Protocol, TypeGuard, TypeVar, runtime_checkable

from .errors import PolicyViolationError
from .policies.mcp_guard import extract_mcp_tool_calls
from .types import (
    MCPCallEvent,
    NodeExecution,
    NodeId,
    Policy,
    PolicyContext,
    PolicyHaltEvent,
    SessionEndEvent,
    SessionId,
    SessionStartEvent,
    StepEvent,
    TraceEvent,
    TraceListener,
    _Halt,
)

_LOGGER = logging.getLogger("graphos_io.wrap")

TInput = TypeVar("TInput")
TOutput = TypeVar("TOutput")
TState = TypeVar("TState")


@runtime_checkable
class CompiledGraph(Protocol):
    """Protocol matching LangGraph Python's compiled graph surface."""

    def astream(
        self, input: Any, config: Any | None = None, **kwargs: Any
    ) -> AsyncIterator[Any]: ...


def _now_ms() -> int:
    return int(time.time() * 1000)


_session_counter = 0


def _new_session_id() -> SessionId:
    global _session_counter
    sid = f"gos_{_now_ms():x}_{_session_counter:x}"
    _session_counter += 1
    return sid


def _is_plain_object(v: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(v, dict)


def _merge_state(
    acc: dict[str, Any], update: dict[str, Any]
) -> dict[str, Any]:
    """Generic state merger.

    Last-write-wins for scalars; concatenation for ``messages``; recursive
    merge for nested dicts. Matches LangGraph's default reducer plus
    ``add_messages`` for the most common shape.
    """

    out = dict(acc)
    for k, v in update.items():
        prev = out.get(k)
        if k == "messages":
            prev_arr: list[Any] = list(prev) if isinstance(prev, list) else []
            if isinstance(v, list):
                out[k] = prev_arr + list(v)
            elif v is not None:
                out[k] = [*prev_arr, v]
            else:
                out[k] = prev_arr
        elif _is_plain_object(prev) and _is_plain_object(v):
            out[k] = _merge_state(prev, v)
        else:
            out[k] = v
    return out


async def _emit(listener: TraceListener | None, event: TraceEvent) -> None:
    if listener is None:
        return
    try:
        result = listener(event)
        if inspect.isawaitable(result):
            await result
    except Exception:
        # Listener errors must never crash the wrapped graph.
        _LOGGER.warning("graphos_io: on_trace listener raised", exc_info=True)


def _normalize_chunk(raw: Any) -> tuple[Sequence[str], dict[str, Any]]:
    """Unpack a stream tuple ``(path, chunk)`` if subgraphs=True yielded one."""

    if (
        isinstance(raw, tuple)
        and len(raw) == 2
        and isinstance(raw[0], (list, tuple))
    ):
        path, chunk = raw
        if not isinstance(chunk, dict):
            return list(path), {}
        return list(path), chunk
    if isinstance(raw, dict):
        return [], raw
    return [], {}


def _qualified_node(prefix: Sequence[str], node: str) -> NodeId:
    if not prefix:
        return node
    cleaned = [seg.split(":", 1)[0] for seg in prefix if seg]
    if not cleaned:
        return node
    return f"{'/'.join(cleaned)}/{node}"


class WrappedGraph(Generic[TInput, TOutput]):
    """Returned by :func:`wrap`. Provides ``invoke`` and ``stream``."""

    def __init__(
        self,
        graph: CompiledGraph,
        *,
        policies: Sequence[Policy[Any]],
        session_id: SessionId | None,
        project_id: str | None,
        on_trace: TraceListener | None,
    ) -> None:
        self._graph = graph
        self._policies = list(policies)
        self._session_id = session_id
        self._project_id = project_id
        self._on_trace = on_trace

    async def invoke(self, input: TInput, config: Any | None = None) -> TOutput:
        """Run the graph to completion and return the merged final state."""

        merged: dict[str, Any] = dict(input) if _is_plain_object(input) else {}
        async for chunk in self.stream(input, config):
            for state_update in chunk.values():
                if _is_plain_object(state_update):
                    merged = _merge_state(merged, state_update)
        return merged  # type: ignore[return-value]

    async def stream(
        self, input: TInput, config: Any | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        """Async-iterate the graph's node updates with policy enforcement."""

        session_id = self._session_id or _new_session_id()
        ctx = PolicyContext(sessionId=session_id)
        for policy in self._policies:
            reset = getattr(policy, "reset", None)
            if reset is not None:
                reset(ctx)

        await _emit(
            self._on_trace,
            SessionStartEvent(
                sessionId=session_id,
                projectId=self._project_id,
                timestamp=_now_ms(),
                input=input,
            ),
        )

        base_config: dict[str, Any] = dict(config) if _is_plain_object(config) else {}
        if "subgraphs" not in base_config:
            base_config["subgraphs"] = True
        if "stream_mode" not in base_config:
            base_config["stream_mode"] = "updates"

        step = 0
        try:
            iterable = self._graph.astream(input, base_config)
            async for raw in iterable:
                path, chunk = _normalize_chunk(raw)
                for node, state in chunk.items():
                    qualified = _qualified_node(path, node)
                    execution: NodeExecution[Any] = NodeExecution(
                        sessionId=session_id,
                        node=qualified,
                        state=state,
                        step=step,
                        timestamp=_now_ms(),
                    )
                    step += 1

                    await _emit(
                        self._on_trace,
                        StepEvent(
                            sessionId=session_id,
                            node=qualified,
                            state=state,
                            step=execution.step,
                            timestamp=execution.timestamp,
                        ),
                    )

                    for mcp_call in extract_mcp_tool_calls(execution):
                        await _emit(
                            self._on_trace,
                            MCPCallEvent(
                                sessionId=session_id,
                                timestamp=execution.timestamp,
                                step=execution.step,
                                server=mcp_call.server,
                                tool=mcp_call.tool,
                                args=mcp_call.args,
                                source="graph",
                            ),
                        )

                    for policy in self._policies:
                        decision = policy.observe(execution, ctx)
                        if isinstance(decision, _Halt):
                            await _emit(
                                self._on_trace,
                                PolicyHaltEvent(
                                    sessionId=session_id,
                                    policy=decision.policy,
                                    reason=decision.reason,
                                    details=decision.details,
                                    step=execution.step,
                                    timestamp=_now_ms(),
                                ),
                            )
                            await _emit(
                                self._on_trace,
                                SessionEndEvent(
                                    sessionId=session_id,
                                    timestamp=_now_ms(),
                                    outcome="halted",
                                ),
                            )
                            raise PolicyViolationError(decision)
                yield chunk

            await _emit(
                self._on_trace,
                SessionEndEvent(
                    sessionId=session_id,
                    timestamp=_now_ms(),
                    outcome="complete",
                ),
            )
        except PolicyViolationError:
            raise
        except (asyncio.CancelledError, KeyboardInterrupt):
            raise
        except Exception as exc:
            await _emit(
                self._on_trace,
                SessionEndEvent(
                    sessionId=session_id,
                    timestamp=_now_ms(),
                    outcome="error",
                    error={"message": str(exc)},
                ),
            )
            raise


def wrap(
    graph: CompiledGraph,
    *,
    policies: Iterable[Policy[Any]] | None = None,
    session_id: SessionId | None = None,
    project_id: str | None = None,
    on_trace: TraceListener | None = None,
) -> WrappedGraph[Any, Any]:
    """Wrap a compiled LangGraph with policies and telemetry.

    Returns a :class:`WrappedGraph` exposing ``invoke`` and ``stream``.
    """

    return WrappedGraph(
        graph,
        policies=list(policies) if policies else [],
        session_id=session_id,
        project_id=project_id,
        on_trace=on_trace,
    )


__all__ = ["CompiledGraph", "WrappedGraph", "wrap"]

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from graphos_io import (
    BudgetGuard,
    LoopGuard,
    NodeExecution,
    PolicyContext,
    PolicyDecision,
    PolicyViolationError,
    TraceEvent,
    cont,
    halt,
    wrap,
)


class FakeGraph:
    """Async iterator standing in for a compiled LangGraph."""

    def __init__(
        self,
        chunks: list[Any],
        *,
        throw_at: int | None = None,
    ) -> None:
        self._chunks = chunks
        self._throw_at = throw_at

    def astream(
        self, input: Any, config: Any | None = None, **_kwargs: Any
    ) -> AsyncIterator[Any]:
        del input, config

        async def gen() -> AsyncIterator[Any]:
            for i, chunk in enumerate(self._chunks):
                if self._throw_at == i:
                    raise RuntimeError("boom")
                yield chunk

        return gen()


async def test_emits_session_start_step_session_end() -> None:
    events: list[TraceEvent] = []
    managed = wrap(
        FakeGraph([{"A": {"x": 1}}, {"B": {"x": 2}}]),
        project_id="demo",
        on_trace=lambda e: events.append(e),
    )
    await managed.invoke({})

    kinds = [e.kind for e in events]
    assert kinds == ["session.start", "step", "step", "session.end"]
    assert events[0].sessionId.startswith("gos_")
    end = events[-1]
    assert end.kind == "session.end"
    assert end.outcome == "complete"


async def test_step_events_use_qualified_node_names_for_subgraphs() -> None:
    events: list[TraceEvent] = []
    managed = wrap(
        FakeGraph([(["sub:abc"], {"inner_node": {"x": 1}})]),
        on_trace=lambda e: events.append(e),
    )
    await managed.invoke({})
    step_events = [e for e in events if e.kind == "step"]
    assert step_events[0].node == "sub/inner_node"


async def test_halts_when_policy_returns_halt() -> None:
    class StopAtStep1:
        name = "Stopper"

        def observe(
            self, e: NodeExecution[Any], _ctx: PolicyContext
        ) -> PolicyDecision:
            return halt(self.name, "nope") if e.step == 1 else cont()

        def reset(self, _ctx: PolicyContext) -> None:
            return None

    events: list[TraceEvent] = []
    managed = wrap(
        FakeGraph([{"A": {}}, {"B": {}}, {"C": {}}]),
        policies=[StopAtStep1()],
        on_trace=lambda e: events.append(e),
    )
    with pytest.raises(PolicyViolationError) as exc_info:
        await managed.invoke({})
    assert exc_info.value.policy == "Stopper"

    kinds = [e.kind for e in events]
    assert kinds == [
        "session.start",
        "step",
        "step",
        "policy.halt",
        "session.end",
    ]
    end = events[-1]
    assert end.kind == "session.end"
    assert end.outcome == "halted"


async def test_emits_session_end_error_when_underlying_graph_raises() -> None:
    events: list[TraceEvent] = []
    managed = wrap(
        FakeGraph([{"A": {}}, {"B": {}}], throw_at=1),
        on_trace=lambda e: events.append(e),
    )
    with pytest.raises(RuntimeError, match="boom"):
        await managed.invoke({})
    last = events[-1]
    assert last.kind == "session.end"
    assert last.outcome == "error"
    assert last.error is not None and last.error["message"] == "boom"


async def test_listener_that_throws_does_not_crash_run() -> None:
    def bad_listener(_e: TraceEvent) -> None:
        raise RuntimeError("listener blew up")

    managed = wrap(FakeGraph([{"A": {"x": 1}}]), on_trace=bad_listener)
    result = await managed.invoke({})
    assert result == {"x": 1}


async def test_async_listener_that_rejects_does_not_crash_run() -> None:
    async def bad_listener(_e: TraceEvent) -> None:
        raise RuntimeError("async listener blew up")

    managed = wrap(FakeGraph([{"A": {"x": 1}}]), on_trace=bad_listener)
    result = await managed.invoke({})
    assert result == {"x": 1}


async def test_session_id_consistent_across_events() -> None:
    events: list[TraceEvent] = []
    managed = wrap(
        FakeGraph([{"A": {}}, {"B": {}}]),
        on_trace=lambda e: events.append(e),
    )
    await managed.invoke({})
    assert len({e.sessionId for e in events}) == 1


async def test_user_supplied_session_id_is_respected() -> None:
    events: list[TraceEvent] = []
    managed = wrap(
        FakeGraph([{"A": {}}]),
        session_id="my-session",
        on_trace=lambda e: events.append(e),
    )
    await managed.invoke({})
    assert events[0].sessionId == "my-session"


class TestInvokeMergedState:
    async def test_returns_merged_final_state_not_last_chunk(self) -> None:
        managed = wrap(FakeGraph([{"nodeA": {"a": 1}}, {"nodeB": {"b": 2}}]))
        result = await managed.invoke({})
        assert result == {"a": 1, "b": 2}

    async def test_starts_from_input_as_initial_state(self) -> None:
        managed = wrap(FakeGraph([{"nodeA": {"ran": True}}]))
        result = await managed.invoke({"start": "hello"})
        assert result == {"start": "hello", "ran": True}

    async def test_concatenates_messages_across_steps(self) -> None:
        managed = wrap(
            FakeGraph(
                [
                    {"nodeA": {"messages": [{"role": "user", "content": "hi"}]}},
                    {"nodeB": {"messages": [{"role": "assistant", "content": "hello"}]}},
                ]
            )
        )
        result = await managed.invoke({"messages": []})
        assert [m["role"] for m in result["messages"]] == ["user", "assistant"]

    async def test_appends_single_message_update_to_messages_array(self) -> None:
        managed = wrap(
            FakeGraph([{"nodeA": {"messages": {"role": "assistant", "content": "hi"}}}])
        )
        result = await managed.invoke({"messages": []})
        assert result["messages"] == [{"role": "assistant", "content": "hi"}]

    async def test_last_write_wins_for_scalars(self) -> None:
        managed = wrap(
            FakeGraph(
                [{"nodeA": {"status": "running"}}, {"nodeB": {"status": "done"}}]
            )
        )
        result = await managed.invoke({})
        assert result["status"] == "done"


class TestMCPCallEvents:
    async def test_emits_mcp_call_when_step_contains_mcp_tool_calls(self) -> None:
        events: list[TraceEvent] = []
        managed = wrap(
            FakeGraph(
                [
                    {
                        "agent": {
                            "messages": [
                                {
                                    "tool_calls": [
                                        {
                                            "name": "filesystem__read_file",
                                            "args": {"path": "/tmp/demo.txt"},
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                ]
            ),
            on_trace=lambda e: events.append(e),
        )
        await managed.invoke({})
        mcp_events = [e for e in events if e.kind == "mcp.call"]
        assert len(mcp_events) == 1
        ev = mcp_events[0]
        assert ev.kind == "mcp.call"
        assert ev.server == "filesystem"
        assert ev.tool == "read_file"
        assert ev.source == "graph"


class TestPolicyIntegration:
    async def test_loop_guard_node_mode_halts_real_graph(self) -> None:
        events: list[TraceEvent] = []
        chunks = [
            {"agent": {"messages": [i]}} for i in range(10)
        ]  # same node, different state
        managed = wrap(
            FakeGraph(chunks),
            policies=[LoopGuard(mode="node", max_repeats=3)],
            on_trace=lambda e: events.append(e),
        )
        with pytest.raises(PolicyViolationError) as exc_info:
            await managed.invoke({})
        assert exc_info.value.policy == "LoopGuard"

    async def test_budget_guard_halts_when_cost_exceeds_limit(self) -> None:
        events: list[TraceEvent] = []
        chunks = [{"node": {"i": i}} for i in range(10)]
        managed = wrap(
            FakeGraph(chunks),
            policies=[BudgetGuard(usd_limit=0.05, cost=lambda _e: 0.02)],
            on_trace=lambda e: events.append(e),
        )
        with pytest.raises(PolicyViolationError) as exc_info:
            await managed.invoke({})
        assert exc_info.value.policy == "BudgetGuard"

from __future__ import annotations

from graphos_io import LoopGuard

from .conftest import CTX, make_exec


def test_continues_when_every_node_state_pair_is_unique() -> None:
    guard = LoopGuard(max_repeats=3)
    for i in range(10):
        d = guard.observe(make_exec("count", {"n": i}, i), CTX)
        assert d.kind == "continue"


def test_halts_when_same_node_state_exceeds_max_repeats() -> None:
    guard = LoopGuard(max_repeats=3)
    for i in range(3):
        assert guard.observe(make_exec("A", {"n": 1}, i), CTX).kind == "continue"
    halted = guard.observe(make_exec("A", {"n": 1}, 3), CTX)
    assert halted.kind == "halt"
    assert halted.policy == "LoopGuard"
    assert "A" in halted.reason


def test_detects_pingpong_when_state_converges() -> None:
    guard = LoopGuard(max_repeats=2)
    seq = ["A", "B", "A", "B", "A", "B"]
    decisions = [
        guard.observe(make_exec(node, {"done": False}, i), CTX)
        for i, node in enumerate(seq)
    ]
    assert all(d.kind == "continue" for d in decisions[:4])
    assert decisions[5].kind == "halt"


def test_does_not_halt_when_pingpong_state_mutates() -> None:
    guard = LoopGuard(max_repeats=2)
    seq = [("A", 1), ("B", 1), ("A", 2), ("B", 2), ("A", 3), ("B", 3)]
    for i, (node, n) in enumerate(seq):
        d = guard.observe(make_exec(node, {"n": n}, i), CTX)
        assert d.kind == "continue"


def test_canonicalizes_object_key_order() -> None:
    guard = LoopGuard(max_repeats=1)
    assert guard.observe(make_exec("A", {"a": 1, "b": 2}, 0), CTX).kind == "continue"
    d = guard.observe(make_exec("A", {"b": 2, "a": 1}, 1), CTX)
    assert d.kind == "halt"


def test_custom_key_function() -> None:
    guard = LoopGuard(max_repeats=2, key=lambda e: e.node)
    assert guard.observe(make_exec("A", {"n": 1}, 0), CTX).kind == "continue"
    assert guard.observe(make_exec("A", {"n": 2}, 1), CTX).kind == "continue"
    d = guard.observe(make_exec("A", {"n": 3}, 2), CTX)
    assert d.kind == "halt"


def test_reset_clears_history() -> None:
    guard = LoopGuard(max_repeats=1)
    assert guard.observe(make_exec("A", {"n": 1}, 0), CTX).kind == "continue"
    assert guard.observe(make_exec("A", {"n": 1}, 1), CTX).kind == "halt"
    guard.reset(CTX)
    assert guard.observe(make_exec("A", {"n": 1}, 0), CTX).kind == "continue"


class TestNodeMode:
    def test_halts_when_node_revisited_even_with_changing_state(self) -> None:
        guard = LoopGuard(mode="node", max_repeats=3)
        for i in range(3):
            d = guard.observe(make_exec("llm_call", {"messages": [0] * (i + 1)}, i), CTX)
            assert d.kind == "continue"
        halted = guard.observe(make_exec("llm_call", {"messages": [0, 0, 0, 0]}, 3), CTX)
        assert halted.kind == "halt"
        assert "visited 4 times" in halted.reason
        assert halted.details is not None
        assert halted.details["mode"] == "node"

    def test_tracks_different_nodes_independently(self) -> None:
        guard = LoopGuard(mode="node", max_repeats=2)
        assert guard.observe(make_exec("A", None, 0), CTX).kind == "continue"
        assert guard.observe(make_exec("B", None, 1), CTX).kind == "continue"
        assert guard.observe(make_exec("A", None, 2), CTX).kind == "continue"
        assert guard.observe(make_exec("B", None, 3), CTX).kind == "continue"
        assert guard.observe(make_exec("A", None, 4), CTX).kind == "halt"

    def test_explicit_key_overrides_mode(self) -> None:
        guard = LoopGuard(
            mode="node",
            max_repeats=1,
            key=lambda e: f"{e.node}:{e.state['n']}",
        )
        assert guard.observe(make_exec("A", {"n": 1}, 0), CTX).kind == "continue"
        assert guard.observe(make_exec("A", {"n": 2}, 1), CTX).kind == "continue"
        d = guard.observe(make_exec("A", {"n": 1}, 2), CTX)
        assert d.kind == "halt"

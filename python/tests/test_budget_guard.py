from __future__ import annotations

import math

import pytest

from graphos_io import BudgetGuard

from .conftest import CTX, make_exec


def test_continues_while_below_limit() -> None:
    guard = BudgetGuard(usd_limit=0.1, cost=lambda _e: 0.02)
    for i in range(5):
        assert guard.observe(make_exec("n", None, i), CTX).kind == "continue"


def test_halts_first_step_above_limit() -> None:
    guard = BudgetGuard(usd_limit=0.05, cost=lambda _e: 0.03)
    assert guard.observe(make_exec("n", None, 0), CTX).kind == "continue"
    d = guard.observe(make_exec("n", None, 1), CTX)
    assert d.kind == "halt"
    assert d.policy == "BudgetGuard"
    assert "0.0600" in d.reason and "0.0500" in d.reason


def test_zero_cost_steps_never_halt() -> None:
    guard = BudgetGuard(usd_limit=0.01, cost=lambda _e: 0)
    for i in range(100):
        assert guard.observe(make_exec("n", None, i), CTX).kind == "continue"


def test_negative_cost_halts() -> None:
    guard = BudgetGuard(usd_limit=1.0, cost=lambda _e: -0.01)
    d = guard.observe(make_exec("n", None, 0), CTX)
    assert d.kind == "halt"
    assert "invalid" in d.reason


def test_nan_cost_halts() -> None:
    guard = BudgetGuard(usd_limit=1.0, cost=lambda _e: math.nan)
    d = guard.observe(make_exec("n", None, 0), CTX)
    assert d.kind == "halt"


def test_inf_cost_halts() -> None:
    guard = BudgetGuard(usd_limit=1.0, cost=lambda _e: math.inf)
    d = guard.observe(make_exec("n", None, 0), CTX)
    assert d.kind == "halt"


def test_construction_rejects_non_positive_limit() -> None:
    with pytest.raises(ValueError):
        BudgetGuard(usd_limit=0, cost=lambda _e: 0)
    with pytest.raises(ValueError):
        BudgetGuard(usd_limit=-1, cost=lambda _e: 0)


def test_reset_zeroes_spent() -> None:
    guard = BudgetGuard(usd_limit=0.05, cost=lambda _e: 0.03)
    guard.observe(make_exec("n", None, 0), CTX)
    assert guard.observe(make_exec("n", None, 1), CTX).kind == "halt"
    guard.reset(CTX)
    assert guard.observe(make_exec("n", None, 0), CTX).kind == "continue"


def test_uses_state_via_cost_extractor() -> None:
    guard = BudgetGuard(
        usd_limit=0.01,
        cost=lambda e: e.state["tokens"] * 0.000001,
    )
    assert guard.observe(make_exec("n", {"tokens": 1_000}, 0), CTX).kind == "continue"
    assert guard.observe(make_exec("n", {"tokens": 5_000}, 1), CTX).kind == "continue"
    assert guard.observe(make_exec("n", {"tokens": 10_000}, 2), CTX).kind == "halt"

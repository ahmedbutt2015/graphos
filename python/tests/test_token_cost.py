from __future__ import annotations

from typing import Any, Literal

import pytest

from graphos_io import DEFAULT_PRICES, PriceEntry, token_cost

from .conftest import make_exec

Shape = Literal["usage_metadata", "response_metadata.usage", "response_metadata.tokenUsage"]


def ai_message(
    model: str,
    inp: int,
    out: int,
    shape: Shape = "usage_metadata",
) -> dict[str, Any]:
    if shape == "usage_metadata":
        return {
            "role": "assistant",
            "content": "...",
            "usage_metadata": {
                "input_tokens": inp,
                "output_tokens": out,
                "total_tokens": inp + out,
            },
            "response_metadata": {"model_name": model},
        }
    if shape == "response_metadata.usage":
        return {
            "role": "assistant",
            "content": "...",
            "response_metadata": {
                "model": model,
                "usage": {"input_tokens": inp, "output_tokens": out},
            },
        }
    return {
        "role": "assistant",
        "content": "...",
        "response_metadata": {
            "model_name": model,
            "tokenUsage": {"promptTokens": inp, "completionTokens": out},
        },
    }


def test_zero_for_state_with_no_messages() -> None:
    cost = token_cost()
    assert cost(make_exec("n", {"foo": "bar"})) == 0


def test_prices_gpt_4o_mini_with_default_table() -> None:
    cost = token_cost()
    state = {"messages": [ai_message("gpt-4o-mini", 1000, 500)]}
    # 1000*0.15/1M + 500*0.60/1M = 0.00045
    assert cost(make_exec("n", state)) == pytest.approx(0.00045, abs=1e-8)


def test_response_metadata_usage_shape() -> None:
    cost = token_cost()
    state = {
        "messages": [
            ai_message("claude-3-5-sonnet", 2000, 1000, "response_metadata.usage")
        ]
    }
    # 2000*3/1M + 1000*15/1M = 0.021
    assert cost(make_exec("n", state)) == pytest.approx(0.021, abs=1e-6)


def test_response_metadata_token_usage_shape() -> None:
    cost = token_cost()
    state = {"messages": [ai_message("gpt-4o", 500, 200, "response_metadata.tokenUsage")]}
    # 500*2.5/1M + 200*10/1M = 0.00325
    assert cost(make_exec("n", state)) == pytest.approx(0.00325, abs=1e-8)


def test_sums_multiple_messages() -> None:
    cost = token_cost()
    state = {
        "messages": [
            ai_message("gpt-4o-mini", 1000, 500),
            ai_message("gpt-4o-mini", 500, 250),
        ]
    }
    assert cost(make_exec("n", state)) == pytest.approx(0.000675, abs=1e-8)


def test_fallback_flat_number() -> None:
    cost = token_cost(fallback=0.01)
    state = {"messages": [ai_message("some-weird-model-v99", 1000, 500)]}
    assert cost(make_exec("n", state)) == 0.01


def test_fallback_price_entry() -> None:
    cost = token_cost(fallback=PriceEntry(input=1, output=2))
    state = {"messages": [ai_message("unknown-model", 1_000_000, 1_000_000)]}
    assert cost(make_exec("n", state)) == pytest.approx(3.0, abs=1e-6)


def test_default_fallback_is_zero() -> None:
    cost = token_cost()
    state = {"messages": [ai_message("unknown-model", 1000, 500)]}
    assert cost(make_exec("n", state)) == 0


def test_longest_substring_match_for_dated_ids() -> None:
    cost = token_cost()
    state = {"messages": [ai_message("claude-3-5-sonnet-20241022", 1000, 500)]}
    # claude-3-5-sonnet: 3 in / 15 out → 0.0105
    assert cost(make_exec("n", state)) == pytest.approx(0.0105, abs=1e-6)


def test_ignores_messages_without_usage() -> None:
    cost = token_cost()
    state = {
        "messages": [
            {"role": "user", "content": "hi"},
            ai_message("gpt-4o-mini", 100, 50),
        ]
    }
    assert cost(make_exec("n", state)) == pytest.approx(0.000045, abs=1e-8)


def test_finds_messages_in_subgraph_state_updates() -> None:
    cost = token_cost()
    state = {"response_agent": {"messages": [ai_message("gpt-4o-mini", 1000, 500)]}}
    assert cost(make_exec("n", state)) == pytest.approx(0.00045, abs=1e-8)


def test_custom_price_table() -> None:
    cost = token_cost(prices={"my-model": PriceEntry(1, 1)})
    state = {
        "messages": [
            {
                "role": "assistant",
                "usage_metadata": {
                    "input_tokens": 1_000_000,
                    "output_tokens": 1_000_000,
                },
                "response_metadata": {"model_name": "my-model"},
            }
        ]
    }
    assert cost(make_exec("n", state)) == pytest.approx(2.0, abs=1e-6)


def test_default_prices_export_is_stable() -> None:
    assert DEFAULT_PRICES["gpt-4o"] == PriceEntry(input=2.5, output=10)


def test_handles_langchain_pydantic_aimessage() -> None:
    """Real LangChain Python messages are Pydantic models, not dicts.

    Regression for v1.0.0 where `_find_messages` only recognized dicts and
    silently skipped every `AIMessage`, so BudgetGuard never tripped.
    """

    pytest.importorskip("langchain_core")
    from langchain_core.messages import AIMessage

    msg = AIMessage(content="hello")
    msg.usage_metadata = {  # type: ignore[assignment]
        "input_tokens": 1000,
        "output_tokens": 500,
        "total_tokens": 1500,
    }
    msg.response_metadata = {"model_name": "gpt-4o-mini"}

    cost = token_cost()
    state = {"messages": [msg]}
    assert cost(make_exec("n", state)) == pytest.approx(0.00045, abs=1e-8)

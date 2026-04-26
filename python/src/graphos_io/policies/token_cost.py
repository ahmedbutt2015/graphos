"""token_cost — drop-in cost extractor for BudgetGuard.

Walks ``execution.state`` for LangChain-style messages, extracts usage from
``usage_metadata`` / ``response_metadata.usage`` / ``tokenUsage``, and applies
a per-model price table. The default table covers the most common OpenAI and
Anthropic models. Substring-match handles dated IDs like
``claude-3-5-sonnet-20241022``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeGuard

from ..types import NodeExecution


@dataclass(frozen=True, slots=True)
class PriceEntry:
    """USD per 1,000,000 tokens, separately for input and output."""

    input: float
    output: float


@dataclass(frozen=True, slots=True)
class TokenUsage:
    input: int
    output: int


# Prices in USD per 1M tokens (publicly listed list prices at time of writing).
DEFAULT_PRICES: dict[str, PriceEntry] = {
    "gpt-4o-mini": PriceEntry(0.15, 0.60),
    "gpt-4o": PriceEntry(2.50, 10.00),
    "gpt-4-turbo": PriceEntry(10.00, 30.00),
    "gpt-4": PriceEntry(30.00, 60.00),
    "gpt-3.5-turbo": PriceEntry(0.50, 1.50),
    "o1-mini": PriceEntry(3.00, 12.00),
    "o1-preview": PriceEntry(15.00, 60.00),
    "o1": PriceEntry(15.00, 60.00),
    "claude-3-5-haiku": PriceEntry(0.80, 4.00),
    "claude-3-5-sonnet": PriceEntry(3.00, 15.00),
    "claude-3-7-sonnet": PriceEntry(3.00, 15.00),
    "claude-3-haiku": PriceEntry(0.25, 1.25),
    "claude-3-sonnet": PriceEntry(3.00, 15.00),
    "claude-3-opus": PriceEntry(15.00, 75.00),
    "claude-haiku-4": PriceEntry(1.00, 5.00),
    "claude-sonnet-4": PriceEntry(3.00, 15.00),
    "claude-opus-4": PriceEntry(15.00, 75.00),
}


def _is_object(v: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(v, dict)


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None  # bool is a subclass of int in Python; reject explicitly
    if isinstance(v, (int, float)) and not _is_nan_or_inf(v):
        return float(v)
    return None


def _is_nan_or_inf(v: float) -> bool:
    return v != v or v in (float("inf"), float("-inf"))


def _extract_usage(msg: dict[str, Any]) -> TokenUsage | None:
    direct = msg.get("usage_metadata")
    if _is_object(direct):
        in_t = _num(direct.get("input_tokens"))
        out_t = _num(direct.get("output_tokens"))
        if in_t is not None or out_t is not None:
            return TokenUsage(int(in_t or 0), int(out_t or 0))

    meta = msg.get("response_metadata")
    if _is_object(meta):
        token_usage = meta.get("tokenUsage")
        if _is_object(token_usage):
            in_t = _num(token_usage.get("promptTokens"))
            out_t = _num(token_usage.get("completionTokens"))
            if in_t is not None or out_t is not None:
                return TokenUsage(int(in_t or 0), int(out_t or 0))
        usage = meta.get("usage")
        if _is_object(usage):
            in_t = _num(usage.get("input_tokens"))
            if in_t is None:
                in_t = _num(usage.get("prompt_tokens"))
            out_t = _num(usage.get("output_tokens"))
            if out_t is None:
                out_t = _num(usage.get("completion_tokens"))
            if in_t is not None or out_t is not None:
                return TokenUsage(int(in_t or 0), int(out_t or 0))

    return None


def _extract_model(msg: dict[str, Any]) -> str | None:
    meta = msg.get("response_metadata")
    if _is_object(meta):
        m = meta.get("model_name") or meta.get("model")
        if isinstance(m, str) and m:
            return m
    lc = msg.get("lc_kwargs")
    if _is_object(lc):
        meta2 = lc.get("response_metadata")
        if _is_object(meta2):
            m = meta2.get("model_name") or meta2.get("model")
            if isinstance(m, str) and m:
                return m
    return None


def _find_messages(state: Any, max_depth: int = 4) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[int] = set()

    def walk(v: Any, depth: int) -> None:
        if depth > max_depth:
            return
        if isinstance(v, list):
            for item in v:
                if _is_object(item) and (
                    "usage_metadata" in item or "response_metadata" in item
                ):
                    out.append(item)
            return
        if not _is_object(v):
            return
        obj_id = id(v)
        if obj_id in seen:
            return
        seen.add(obj_id)
        messages = v.get("messages")
        if isinstance(messages, list):
            for m in messages:
                if _is_object(m):
                    out.append(m)
        for key, child in v.items():
            if key == "messages":
                continue
            walk(child, depth + 1)

    walk(state, 0)
    return out


def _find_price(prices: dict[str, PriceEntry], model: str) -> PriceEntry | None:
    if model in prices:
        return prices[model]
    best: tuple[str, PriceEntry] | None = None
    for key, entry in prices.items():
        if key in model and (best is None or len(key) > len(best[0])):
            best = (key, entry)
    return best[1] if best else None


def token_cost(
    *,
    prices: dict[str, PriceEntry] | None = None,
    fallback: PriceEntry | float | None = None,
) -> Callable[[NodeExecution[Any]], float]:
    """Return a cost function suitable for ``BudgetGuard(cost=...)``.

    ``prices`` overrides the default price table. ``fallback`` is used when a
    message's model is not in the price table — pass either a flat USD per
    step or a custom :class:`PriceEntry`.
    """

    table = prices if prices is not None else DEFAULT_PRICES
    fb: PriceEntry | float = fallback if fallback is not None else 0.0

    def apply(usage: TokenUsage, price: PriceEntry) -> float:
        return (usage.input * price.input + usage.output * price.output) / 1_000_000

    def cost_fn(execution: NodeExecution[Any]) -> float:
        total = 0.0
        for msg in _find_messages(execution.state):
            usage = _extract_usage(msg)
            if usage is None:
                continue
            model = _extract_model(msg)
            price = _find_price(table, model) if model else None
            if price is not None:
                total += apply(usage, price)
            elif isinstance(fb, PriceEntry):
                total += apply(usage, fb)
            else:
                total += float(fb)
        return total

    return cost_fn


__all__ = [
    "DEFAULT_PRICES",
    "PriceEntry",
    "TokenUsage",
    "token_cost",
]

"""MCPGuard — allow/deny + call caps for MCP-style tool calls."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any, TypeGuard

from .._canonical import canonical
from ..types import MCPToolCall, NodeExecution, PolicyContext, PolicyDecision, cont, halt


def _is_object(v: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(v, dict)


def _parse_qualified_tool_name(raw: str) -> tuple[str | None, str]:
    """Split common qualified tool-name patterns into (server, tool).

    Recognized forms:
      * ``mcp__server__tool`` (Anthropic Claude desktop convention)
      * ``server__tool`` / ``server/tool`` / ``server:tool``

    Falls back to ``(None, raw)`` when no delimiter matches.
    """

    trimmed = raw.strip()
    if trimmed.startswith("mcp__"):
        parts = [p for p in trimmed.split("__") if p]
        if len(parts) >= 3:
            return parts[1], "__".join(parts[2:])

    for delimiter in ("__", "/", ":"):
        idx = trimmed.find(delimiter)
        if 0 < idx < len(trimmed) - len(delimiter):
            return trimmed[:idx], trimmed[idx + len(delimiter) :]

    return None, trimmed


def _normalize_tool_call(value: Any) -> MCPToolCall | None:
    if not _is_object(value):
        return None

    fn = value.get("function") if _is_object(value.get("function")) else None
    meta = value.get("metadata") if _is_object(value.get("metadata")) else None
    mcp = value.get("mcp") if _is_object(value.get("mcp")) else None

    raw_name: str | None = None
    if isinstance(value.get("name"), str):
        raw_name = value["name"]
    elif fn and isinstance(fn.get("name"), str):
        raw_name = fn["name"]
    if raw_name is None:
        return None

    parsed_server, parsed_tool = _parse_qualified_tool_name(raw_name)

    server: str | None = None
    if isinstance(value.get("server"), str):
        server = value["server"]
    elif meta and isinstance(meta.get("server"), str):
        server = meta["server"]
    elif mcp and isinstance(mcp.get("server"), str):
        server = mcp["server"]
    else:
        server = parsed_server

    tool = value["tool"] if isinstance(value.get("tool"), str) else parsed_tool
    if not tool:
        return None

    args: Any = (
        value.get("args")
        or value.get("arguments")
        or (fn.get("arguments") if fn else None)
        or value.get("input")
    )

    if server is None and parsed_server is None and mcp is None and (
        meta is None or not _is_object(meta.get("mcp"))
    ):
        return None

    return MCPToolCall(server=server, tool=tool, args=args)


def _collect_last_message_payloads(state: Any) -> list[Any]:
    seen: set[int] = set()
    payloads: list[Any] = []

    def walk(value: Any) -> None:
        if isinstance(value, list):
            for child in value:
                walk(child)
            return
        if not _is_object(value):
            return
        obj_id = id(value)
        if obj_id in seen:
            return
        seen.add(obj_id)
        if "messages" in value:
            messages = value["messages"]
            if isinstance(messages, list) and len(messages) > 0:
                payloads.append(messages[-1])
            elif messages is not None:
                payloads.append(messages)
        for child in value.values():
            walk(child)

    walk(state)
    return payloads


def extract_mcp_tool_calls(execution: NodeExecution[Any]) -> list[MCPToolCall]:
    """Pull MCP-style tool calls out of any state shape we recognize.

    Looks at the most recent message in any ``messages`` array (top-level or
    nested), and for each ``tool_calls`` entry tries to pick out a server and
    tool name. Mirrors the TypeScript SDK's ``extractMCPToolCalls``.
    """

    calls: list[MCPToolCall] = []
    for payload in _collect_last_message_payloads(execution.state):
        obj = payload if _is_object(payload) else None
        if obj is None:
            continue
        raw_calls: Any = []
        if isinstance(obj.get("tool_calls"), list):
            raw_calls = obj["tool_calls"]
        elif _is_object(obj.get("additional_kwargs")) and isinstance(
            obj["additional_kwargs"].get("tool_calls"), list
        ):
            raw_calls = obj["additional_kwargs"]["tool_calls"]

        for raw_call in raw_calls:
            call = _normalize_tool_call(raw_call)
            if call is not None:
                calls.append(call)

    return calls


def _includes(needle: str | None, haystack: Sequence[str] | None) -> bool:
    if not needle or not haystack:
        return False
    return needle in haystack


class MCPGuard:
    """Allow/deny lists and per-session/per-tool call caps for MCP tool calls.

    The ``extract_calls`` hook can be overridden if your graph stores MCP
    calls somewhere outside the standard ``messages[].tool_calls`` shape.
    """

    name = "MCPGuard"

    def __init__(
        self,
        *,
        allow_servers: Sequence[str] | None = None,
        deny_servers: Sequence[str] | None = None,
        allow_tools: Sequence[str] | None = None,
        deny_tools: Sequence[str] | None = None,
        max_calls_per_session: int | None = None,
        max_calls_per_tool: int | None = None,
        extract_calls: Callable[[NodeExecution[Any]], list[MCPToolCall]] | None = None,
    ) -> None:
        self._allow_servers = list(allow_servers) if allow_servers else None
        self._deny_servers = list(deny_servers) if deny_servers else None
        self._allow_tools = list(allow_tools) if allow_tools else None
        self._deny_tools = list(deny_tools) if deny_tools else None
        self._max_calls_per_session = max_calls_per_session
        self._max_calls_per_tool = max_calls_per_tool
        self._extract_calls = extract_calls or extract_mcp_tool_calls
        self._seen_calls: set[str] = set()
        self._total_calls = 0
        self._tool_counts: dict[str, int] = {}

    def observe(
        self, execution: NodeExecution[Any], _ctx: PolicyContext
    ) -> PolicyDecision:
        for call in self._extract_calls(execution):
            fingerprint = canonical(
                [
                    execution.step,
                    call.server or "",
                    call.tool,
                    call.args,
                ]
            )
            if fingerprint in self._seen_calls:
                continue
            self._seen_calls.add(fingerprint)

            if _includes(call.server, self._deny_servers):
                return halt(
                    self.name,
                    f'server "{call.server}" is denied',
                    {
                        "node": execution.node,
                        "step": execution.step,
                        "server": call.server,
                        "tool": call.tool,
                    },
                )

            if self._allow_servers and not _includes(call.server, self._allow_servers):
                return halt(
                    self.name,
                    f'server "{call.server or "unknown"}" is not in the allow-list',
                    {
                        "node": execution.node,
                        "step": execution.step,
                        "server": call.server,
                        "tool": call.tool,
                    },
                )

            if _includes(call.tool, self._deny_tools):
                return halt(
                    self.name,
                    f'tool "{call.tool}" is denied',
                    {
                        "node": execution.node,
                        "step": execution.step,
                        "server": call.server,
                        "tool": call.tool,
                    },
                )

            if self._allow_tools and not _includes(call.tool, self._allow_tools):
                return halt(
                    self.name,
                    f'tool "{call.tool}" is not in the allow-list',
                    {
                        "node": execution.node,
                        "step": execution.step,
                        "server": call.server,
                        "tool": call.tool,
                    },
                )

            self._total_calls += 1
            if (
                self._max_calls_per_session is not None
                and self._total_calls > self._max_calls_per_session
            ):
                return halt(
                    self.name,
                    f"MCP call count {self._total_calls} exceeded session limit "
                    f"{self._max_calls_per_session}",
                    {
                        "node": execution.node,
                        "step": execution.step,
                        "server": call.server,
                        "tool": call.tool,
                        "count": self._total_calls,
                        "limit": self._max_calls_per_session,
                    },
                )

            key = f"{call.server or 'unknown'}::{call.tool}"
            next_count = self._tool_counts.get(key, 0) + 1
            self._tool_counts[key] = next_count
            if (
                self._max_calls_per_tool is not None
                and next_count > self._max_calls_per_tool
            ):
                return halt(
                    self.name,
                    f'tool "{call.tool}" exceeded per-tool limit '
                    f"{self._max_calls_per_tool}",
                    {
                        "node": execution.node,
                        "step": execution.step,
                        "server": call.server,
                        "tool": call.tool,
                        "count": next_count,
                        "limit": self._max_calls_per_tool,
                    },
                )

        return cont()

    def reset(self, _ctx: PolicyContext) -> None:
        self._seen_calls.clear()
        self._total_calls = 0
        self._tool_counts.clear()


__all__ = ["MCPGuard", "extract_mcp_tool_calls"]

from __future__ import annotations

from graphos_io import MCPGuard, MCPToolCall, extract_mcp_tool_calls

from .conftest import CTX, make_exec


class TestExtractMCPToolCalls:
    def test_extracts_server_tool_from_qualified_name(self) -> None:
        calls = extract_mcp_tool_calls(
            make_exec(
                "agent",
                {
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
                },
            )
        )
        assert calls == [
            MCPToolCall(
                server="filesystem", tool="read_file", args={"path": "/tmp/demo.txt"}
            )
        ]

    def test_extracts_server_from_explicit_metadata(self) -> None:
        calls = extract_mcp_tool_calls(
            make_exec(
                "agent",
                {
                    "nested": {
                        "messages": [
                            {
                                "tool_calls": [
                                    {
                                        "function": {
                                            "name": "read_file",
                                            "arguments": '{"path":"/tmp/a"}',
                                        },
                                        "mcp": {"server": "filesystem"},
                                    }
                                ]
                            }
                        ]
                    }
                },
            )
        )
        assert calls == [
            MCPToolCall(
                server="filesystem", tool="read_file", args='{"path":"/tmp/a"}'
            )
        ]

    def test_uses_additional_kwargs_tool_calls_fallback(self) -> None:
        calls = extract_mcp_tool_calls(
            make_exec(
                "agent",
                {
                    "messages": [
                        {
                            "additional_kwargs": {
                                "tool_calls": [
                                    {"name": "search/docs", "args": {"q": "hi"}}
                                ]
                            }
                        }
                    ]
                },
            )
        )
        assert calls == [MCPToolCall(server="search", tool="docs", args={"q": "hi"})]

    def test_ignores_calls_with_no_server_hint(self) -> None:
        calls = extract_mcp_tool_calls(
            make_exec(
                "agent",
                {
                    "messages": [
                        {"tool_calls": [{"name": "plain_tool", "args": {}}]}
                    ]
                },
            )
        )
        assert calls == []


class TestMCPGuard:
    def test_halts_on_denied_server(self) -> None:
        guard = MCPGuard(deny_servers=["filesystem"])
        d = guard.observe(
            make_exec(
                "agent",
                {
                    "messages": [
                        {"tool_calls": [{"name": "filesystem__read_file", "args": {}}]}
                    ]
                },
            ),
            CTX,
        )
        assert d.kind == "halt"
        assert 'server "filesystem"' in d.reason

    def test_halts_when_allow_list_excludes_tool(self) -> None:
        guard = MCPGuard(allow_tools=["search_docs"])
        d = guard.observe(
            make_exec(
                "agent",
                {
                    "messages": [
                        {"tool_calls": [{"name": "filesystem__read_file", "args": {}}]}
                    ]
                },
            ),
            CTX,
        )
        assert d.kind == "halt"
        assert 'tool "read_file"' in d.reason

    def test_halts_when_per_tool_limit_exceeded(self) -> None:
        guard = MCPGuard(max_calls_per_tool=1)
        first = guard.observe(
            make_exec(
                "agent",
                {
                    "messages": [
                        {
                            "tool_calls": [
                                {"name": "filesystem__read_file", "args": {"path": "a"}}
                            ]
                        }
                    ]
                },
                0,
            ),
            CTX,
        )
        second = guard.observe(
            make_exec(
                "agent",
                {
                    "messages": [
                        {
                            "tool_calls": [
                                {"name": "filesystem__read_file", "args": {"path": "b"}}
                            ]
                        }
                    ]
                },
                1,
            ),
            CTX,
        )
        assert first.kind == "continue"
        assert second.kind == "halt"

    def test_halts_when_session_limit_exceeded(self) -> None:
        guard = MCPGuard(max_calls_per_session=2)
        for i, args in enumerate([{"path": "a"}, {"path": "b"}, {"path": "c"}]):
            d = guard.observe(
                make_exec(
                    "agent",
                    {
                        "messages": [
                            {
                                "tool_calls": [
                                    {"name": "filesystem__read_file", "args": args}
                                ]
                            }
                        ]
                    },
                    i,
                ),
                CTX,
            )
            if i < 2:
                assert d.kind == "continue", f"step {i}"
            else:
                assert d.kind == "halt"
                assert "session limit 2" in d.reason

    def test_reset_clears_counters(self) -> None:
        guard = MCPGuard(max_calls_per_session=1)
        first = guard.observe(
            make_exec(
                "agent",
                {
                    "messages": [
                        {
                            "tool_calls": [
                                {"name": "filesystem__read_file", "args": {"p": "a"}}
                            ]
                        }
                    ]
                },
                0,
            ),
            CTX,
        )
        guard.reset(CTX)
        second = guard.observe(
            make_exec(
                "agent",
                {
                    "messages": [
                        {
                            "tool_calls": [
                                {"name": "filesystem__read_file", "args": {"p": "b"}}
                            ]
                        }
                    ]
                },
                0,
            ),
            CTX,
        )
        assert first.kind == "continue"
        assert second.kind == "continue"

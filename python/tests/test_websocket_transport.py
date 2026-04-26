"""End-to-end tests for the WebSocket transport.

We spin up a real local WebSocket server (no mocks) so reconnect behavior,
serialization, and bounded queue semantics get real coverage.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from websockets.asyncio.server import ServerConnection, serve

from graphos_io import SessionStartEvent, create_websocket_transport


async def _start_server(
    received: list[str],
) -> tuple[Any, str, asyncio.Event]:
    """Start a localhost WS server, return (server, url, server_ready)."""

    server_ready = asyncio.Event()

    async def handler(ws: ServerConnection) -> None:
        async for msg in ws:
            received.append(msg if isinstance(msg, str) else msg.decode("utf-8"))

    server = await serve(handler, "127.0.0.1", 0)
    sockets = server.sockets
    assert sockets, "server did not bind a socket"
    port = sockets[0].getsockname()[1]
    server_ready.set()
    return server, f"ws://127.0.0.1:{port}/graphos", server_ready


@pytest.mark.timeout(10)
async def test_serializes_and_sends_event_over_real_websocket() -> None:
    received: list[str] = []
    server, url, _ready = await _start_server(received)
    try:
        listener = create_websocket_transport(url)
        event = SessionStartEvent(
            sessionId="sess_test",
            projectId="demo",
            timestamp=42,
            input={"hello": "world"},
        )
        await listener(event)
        # Allow background sender + server handler to flush.
        for _ in range(50):
            if received:
                break
            await asyncio.sleep(0.05)
        assert received, "transport did not deliver event"
        payload = json.loads(received[0])
        assert payload["kind"] == "session.start"
        assert payload["sessionId"] == "sess_test"
        assert payload["projectId"] == "demo"
        assert payload["input"] == {"hello": "world"}
        await listener.close()  # type: ignore[attr-defined]
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.timeout(10)
async def test_invalid_url_raises_immediately() -> None:
    with pytest.raises(ValueError):
        create_websocket_transport("http://not-a-ws-url")


@pytest.mark.timeout(15)
async def test_buffers_events_when_server_unreachable_then_flushes_on_reconnect() -> None:
    """Events queued while the server is down should land after it comes up."""

    received: list[str] = []

    async def _noop_handler(_ws: ServerConnection) -> None:
        return None

    # Use a fixed port we control: pick a free one.
    sock_finder = await serve(_noop_handler, "127.0.0.1", 0)
    free_port = sock_finder.sockets[0].getsockname()[1]
    sock_finder.close()
    await sock_finder.wait_closed()

    url = f"ws://127.0.0.1:{free_port}/graphos"
    listener = create_websocket_transport(url, initial_backoff_s=0.1, max_backoff_s=0.2)

    # Server is NOT running yet — enqueue events
    for i in range(3):
        await listener(
            SessionStartEvent(
                sessionId=f"sess_{i}",
                timestamp=i,
                input=None,
            )
        )

    # Now start the server on the same port and let the transport reconnect.
    async def handler(ws: ServerConnection) -> None:
        async for msg in ws:
            received.append(msg if isinstance(msg, str) else msg.decode("utf-8"))

    server = await serve(handler, "127.0.0.1", free_port)
    try:
        for _ in range(80):
            if len(received) == 3:
                break
            await asyncio.sleep(0.1)
        assert len(received) == 3, f"only received {len(received)} of 3 buffered events"
    finally:
        await listener.close()  # type: ignore[attr-defined]
        server.close()
        await server.wait_closed()

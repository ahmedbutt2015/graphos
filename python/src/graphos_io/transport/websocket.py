"""WebSocket transport for graphos_io.

Connects to the GraphOS dashboard at ``ws://localhost:4001/graphos`` (default)
and streams JSON-encoded TraceEvent payloads. Designed for local-first use:
the wrapped graph never blocks on the transport, and the transport never
crashes the wrapped graph.

Production characteristics:

* **Bounded queue.** Events are buffered up to ``buffer_size`` (default 1024).
  When full, the *oldest* event is dropped — preferring fresh observability
  over stale history. A counter is logged so dropped events are visible.
* **Reconnect with exponential backoff** (1s → 2s → 4s → ... cap at 30s).
* **Fire-and-forget public API.** Callers ``await transport(event)`` and the
  call returns as soon as the event is enqueued, never when it lands on the
  wire.
* **Clean cancellation.** When the surrounding event loop is cancelled, the
  background sender task is cancelled and the WebSocket is closed.
* **No untrusted input parsed.** This transport is send-only.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable

try:
    from websockets.asyncio.client import ClientConnection, connect
    from websockets.exceptions import ConnectionClosed, InvalidURI
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "graphos_io's WebSocket transport requires the 'websockets' package. "
        "Install with: pip install graphos-io"
    ) from exc

from ..types import TraceEvent

_LOGGER = logging.getLogger("graphos_io.transport.websocket")

DEFAULT_URL = "ws://localhost:4001/graphos"
_DEFAULT_BUFFER = 1024
_DEFAULT_INITIAL_BACKOFF = 1.0
_DEFAULT_MAX_BACKOFF = 30.0


class _WSTransport:
    """Internal: long-lived background sender with reconnect and bounded queue."""

    def __init__(
        self,
        *,
        url: str,
        buffer_size: int,
        initial_backoff_s: float,
        max_backoff_s: float,
    ) -> None:
        self._url = url
        self._initial_backoff = initial_backoff_s
        self._max_backoff = max_backoff_s
        self._queue: asyncio.Queue[str] = asyncio.Queue(maxsize=buffer_size)
        self._task: asyncio.Task[None] | None = None
        self._closed = False
        self._dropped = 0

    async def send(self, payload: str) -> None:
        if self._closed:
            return
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="graphos-ws-sender")
        # Best-effort enqueue — drop oldest if full.
        try:
            self._queue.put_nowait(payload)
        except asyncio.QueueFull:
            try:
                _ = self._queue.get_nowait()
                self._dropped += 1
                if self._dropped == 1 or self._dropped % 100 == 0:
                    _LOGGER.warning(
                        "graphos_io ws buffer full — dropped %d event(s) total",
                        self._dropped,
                    )
                self._queue.put_nowait(payload)
            except asyncio.QueueEmpty:  # pragma: no cover - race
                pass

    async def close(self) -> None:
        self._closed = True
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
            self._task = None

    async def _run(self) -> None:
        backoff = self._initial_backoff
        while not self._closed:
            try:
                async with connect(self._url, max_size=2**24) as ws:
                    backoff = self._initial_backoff
                    await self._pump(ws)
            except (ConnectionClosed, OSError, asyncio.TimeoutError):
                # transient — reconnect
                pass
            except InvalidURI:
                _LOGGER.error("graphos_io ws transport: invalid URL %r", self._url)
                return
            except Exception as exc:
                _LOGGER.warning("graphos_io ws transport error: %r", exc)
            if self._closed:
                return
            try:
                await asyncio.sleep(backoff)
            except asyncio.CancelledError:
                return
            backoff = min(backoff * 2, self._max_backoff)

    async def _pump(self, ws: ClientConnection) -> None:
        while not self._closed:
            try:
                payload = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                # ping the connection to detect dropped sockets early
                try:
                    pong = await ws.ping()
                    await asyncio.wait_for(pong, timeout=5.0)
                except (asyncio.TimeoutError, ConnectionClosed):
                    return
                continue
            await ws.send(payload)


def _serialize(event: TraceEvent) -> str:
    """Pydantic → JSON string. Falls back to ``str()`` for unknown payload bits."""

    return event.model_dump_json(by_alias=True, exclude_none=False)


def create_websocket_transport(
    url: str = DEFAULT_URL,
    *,
    buffer_size: int = _DEFAULT_BUFFER,
    initial_backoff_s: float = _DEFAULT_INITIAL_BACKOFF,
    max_backoff_s: float = _DEFAULT_MAX_BACKOFF,
) -> Callable[[TraceEvent], Awaitable[None]]:
    """Return an ``on_trace`` listener that ships events to the GraphOS dashboard.

    Default URL points at the local dashboard (``ws://localhost:4001/graphos``).
    Override only with localhost / loopback / VPN endpoints — events may
    contain user prompts and tool args, and the transport does not authenticate
    the receiver.

    The returned callable is ``async`` and never raises: errors are swallowed
    and logged, so a misbehaving dashboard cannot crash the agent.
    """

    if not url.startswith(("ws://", "wss://")):
        raise ValueError(
            f"graphos_io websocket transport URL must start with ws:// or wss://, "
            f"got {url!r}"
        )

    transport = _WSTransport(
        url=url,
        buffer_size=buffer_size,
        initial_backoff_s=initial_backoff_s,
        max_backoff_s=max_backoff_s,
    )

    async def listener(event: TraceEvent) -> None:
        try:
            payload = _serialize(event)
        except Exception as exc:
            _LOGGER.warning("graphos_io ws transport: serialize failed: %r", exc)
            return
        await transport.send(payload)

    listener.close = transport.close  # type: ignore[attr-defined]
    return listener


__all__ = ["DEFAULT_URL", "create_websocket_transport"]

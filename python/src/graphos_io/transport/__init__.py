"""Transports for shipping trace events out of the wrap."""

from .websocket import create_websocket_transport

__all__ = ["create_websocket_transport"]

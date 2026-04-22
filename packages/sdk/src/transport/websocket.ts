import WebSocket from "ws";
import type { TraceListener } from "@graphos/core";

export interface WebSocketTransportOptions {
  url?: string;
  onError?: (err: Error) => void;
}

const DEFAULT_URL = "ws://localhost:4001/graphos";

export const createWebSocketTransport = (
  options: WebSocketTransportOptions = {}
): TraceListener => {
  const url = options.url ?? DEFAULT_URL;
  const onError =
    options.onError ??
    ((err: Error) => {
      console.error("[graphos] ws transport:", err.message);
    });

  const buffer: string[] = [];
  let ws: WebSocket | null = null;
  let connecting = false;

  const flush = (): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (buffer.length > 0) {
      const msg = buffer.shift();
      if (msg !== undefined) ws.send(msg);
    }
  };

  const connect = (): void => {
    if (connecting) return;
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    connecting = true;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      connecting = false;
      onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    ws.on("open", () => {
      connecting = false;
      flush();
    });
    ws.on("close", () => {
      connecting = false;
      ws = null;
    });
    ws.on("error", (err: Error) => {
      connecting = false;
      onError(err);
    });
  };

  return (event) => {
    buffer.push(JSON.stringify(event));
    if (ws && ws.readyState === WebSocket.OPEN) {
      flush();
    } else {
      connect();
    }
  };
};

#!/usr/bin/env node
import { WebSocketServer } from "ws";

const WS_PORT = Number(process.env.GRAPHOS_WS_PORT ?? 4001);
const MAX_EVENTS_PER_SESSION = 5_000;

const sessions = new Map();
const clients = new Set();

const broadcast = (message, except) => {
  for (const client of clients) {
    if (client === except) continue;
    if (client.readyState !== 1) continue;
    client.send(message);
  }
};

const ingest = (event) => {
  if (!event || typeof event !== "object" || typeof event.sessionId !== "string") {
    return;
  }
  let bucket = sessions.get(event.sessionId);
  if (!bucket) {
    bucket = [];
    sessions.set(event.sessionId, bucket);
  }
  bucket.push(event);
  if (bucket.length > MAX_EVENTS_PER_SESSION) {
    bucket.splice(0, bucket.length - MAX_EVENTS_PER_SESSION);
  }
};

const snapshot = () => {
  const out = [];
  for (const bucket of sessions.values()) {
    for (const ev of bucket) out.push(ev);
  }
  return out;
};

const wss = new WebSocketServer({ port: WS_PORT, path: "/graphos" });

wss.on("connection", (ws) => {
  clients.add(ws);

  ws.send(JSON.stringify({ kind: "hello", sessions: sessions.size }));
  for (const event of snapshot()) {
    ws.send(JSON.stringify(event));
  }

  ws.on("message", (raw) => {
    const text = raw.toString();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    ingest(parsed);
    broadcast(text, ws);
  });

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

wss.on("listening", () => {
  console.log(`[graphos] telemetry ws://localhost:${WS_PORT}/graphos`);
});

const shutdown = () => {
  console.log("[graphos] shutting down ws server");
  wss.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

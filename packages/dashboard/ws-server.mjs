#!/usr/bin/env node
import { WebSocketServer } from "ws";
import { createTraceStore } from "./lib/trace-store.mjs";

const WS_PORT = Number(process.env.GRAPHOS_WS_PORT ?? 4001);
const store = createTraceStore();
const clients = new Set();

const broadcast = (message, except) => {
  for (const client of clients) {
    if (client === except) continue;
    if (client.readyState !== 1) continue;
    client.send(message);
  }
};

const wss = new WebSocketServer({ port: WS_PORT, path: "/graphos" });

wss.on("connection", (ws) => {
  clients.add(ws);

  const { sessions, events } = store.stats();
  ws.send(JSON.stringify({ kind: "hello", sessions, events }));
  for (const event of store.recent()) {
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
    store.insert(parsed);
    broadcast(text, ws);
  });

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

wss.on("listening", () => {
  console.log(`[graphos] telemetry ws://localhost:${WS_PORT}/graphos`);
  console.log(`[graphos] traces db: ${store.path}`);
});

const shutdown = () => {
  console.log("[graphos] shutting down ws server");
  wss.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

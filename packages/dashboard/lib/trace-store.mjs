import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const MAX_REPLAY_EVENTS = 5_000;

export const defaultDbPath = () =>
  process.env.GRAPHOS_DB_PATH ?? join(homedir(), ".graphos", "traces.db");

export const createTraceStore = (dbPath = defaultDbPath()) => {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT    NOT NULL,
      kind       TEXT    NOT NULL,
      ts         INTEGER NOT NULL,
      payload    TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, id);
    CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(ts);
  `);

  const insertStmt = db.prepare(
    "INSERT INTO events (session_id, kind, ts, payload) VALUES (?, ?, ?, ?)"
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM events");
  const distinctSessionsStmt = db.prepare(
    "SELECT COUNT(DISTINCT session_id) AS n FROM events"
  );
  const recentStmt = db.prepare(
    "SELECT payload FROM events ORDER BY id DESC LIMIT ?"
  );

  const insert = (event) => {
    if (!event || typeof event !== "object") return;
    const { sessionId, kind } = event;
    if (typeof sessionId !== "string" || typeof kind !== "string") return;
    const ts = typeof event.timestamp === "number" ? event.timestamp : Date.now();
    insertStmt.run(sessionId, kind, ts, JSON.stringify(event));
  };

  const recent = (limit = MAX_REPLAY_EVENTS) => {
    const rows = recentStmt.all(limit);
    return rows.reverse().map((row) => JSON.parse(row.payload));
  };

  const stats = () => ({
    events: Number(countStmt.get().n),
    sessions: Number(distinctSessionsStmt.get().n),
  });

  const close = () => db.close();

  return { insert, recent, stats, close, path: dbPath };
};

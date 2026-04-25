import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const MAX_REPLAY_EVENTS = 5_000;

const DEFAULT_RETENTION_SESSIONS = 200;
const PRUNE_EVERY_N_INSERTS = 500;

const parseRetention = () => {
  const raw = process.env.GRAPHOS_RETENTION_SESSIONS;
  if (!raw) return DEFAULT_RETENTION_SESSIONS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RETENTION_SESSIONS;
  return Math.floor(n);
};

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
  const listSessionsStmt = db.prepare(`
    SELECT
      session_id,
      MIN(ts) AS started_at,
      MAX(ts) AS ended_at,
      SUM(CASE WHEN kind = 'step' THEN 1 ELSE 0 END) AS step_count,
      COUNT(*) AS event_count
    FROM events
    GROUP BY session_id
    ORDER BY started_at DESC
  `);
  const lifecycleEventsStmt = db.prepare(`
    SELECT session_id, kind, payload
    FROM events
    WHERE kind IN ('session.start', 'session.end')
    ORDER BY id ASC
  `);
  const sessionEventsStmt = db.prepare(`
    SELECT payload FROM events
    WHERE session_id = ?
    ORDER BY id ASC
  `);

  const oldestSessionsStmt = db.prepare(`
    SELECT session_id, MIN(id) AS first_id
    FROM events
    GROUP BY session_id
    ORDER BY first_id ASC
    LIMIT ?
  `);
  const deleteSessionStmt = db.prepare(
    "DELETE FROM events WHERE session_id = ?"
  );

  const retention = parseRetention();
  let insertsSincePrune = 0;

  const prune = () => {
    const total = Number(distinctSessionsStmt.get().n);
    if (total <= retention) return 0;
    const drop = total - retention;
    const victims = oldestSessionsStmt.all(drop);
    let removed = 0;
    for (const row of victims) {
      const result = deleteSessionStmt.run(row.session_id);
      removed += Number(result.changes ?? 0);
    }
    return removed;
  };

  const insert = (event) => {
    if (!event || typeof event !== "object") return;
    const { sessionId, kind } = event;
    if (typeof sessionId !== "string" || typeof kind !== "string") return;
    const ts = typeof event.timestamp === "number" ? event.timestamp : Date.now();
    insertStmt.run(sessionId, kind, ts, JSON.stringify(event));
    insertsSincePrune += 1;
    if (insertsSincePrune >= PRUNE_EVERY_N_INSERTS) {
      insertsSincePrune = 0;
      prune();
    }
  };

  const recent = (limit = MAX_REPLAY_EVENTS) => {
    const rows = recentStmt.all(limit);
    return rows.reverse().map((row) => JSON.parse(row.payload));
  };

  const stats = () => ({
    events: Number(countStmt.get().n),
    sessions: Number(distinctSessionsStmt.get().n),
  });

  const listSessions = () => {
    const lifecycles = new Map();
    for (const row of lifecycleEventsStmt.all()) {
      const existing = lifecycles.get(row.session_id) ?? {};
      const parsed = JSON.parse(row.payload);
      if (row.kind === "session.start") existing.start = parsed;
      else if (row.kind === "session.end") existing.end = parsed;
      lifecycles.set(row.session_id, existing);
    }
    return listSessionsStmt.all().map((row) => {
      const lc = lifecycles.get(row.session_id) ?? {};
      return {
        sessionId: row.session_id,
        projectId: lc.start?.projectId,
        startedAt: Number(row.started_at),
        endedAt: lc.end ? Number(row.ended_at) : undefined,
        outcome: lc.end?.outcome,
        stepCount: Number(row.step_count),
        eventCount: Number(row.event_count),
      };
    });
  };

  const sessionEvents = (sessionId) => {
    if (typeof sessionId !== "string" || sessionId.length === 0) return [];
    return sessionEventsStmt
      .all(sessionId)
      .map((row) => JSON.parse(row.payload));
  };

  const close = () => db.close();

  return {
    insert,
    recent,
    stats,
    listSessions,
    sessionEvents,
    prune,
    retention,
    close,
    path: dbPath,
  };
};

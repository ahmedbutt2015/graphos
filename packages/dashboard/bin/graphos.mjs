#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const argv = process.argv.slice(2);
const subcommand = argv[0];

const PORT = process.env.GRAPHOS_PORT ?? "4000";

const usage = () => {
  process.stdout.write(`graphos — local dashboard for LangGraph agents

Usage:
  graphos dashboard          start the dashboard (HTTP + WebSocket)
  graphos --help             show this help

Environment:
  GRAPHOS_PORT                 dashboard HTTP port (default 4000)
  GRAPHOS_WS_PORT              telemetry WS port (default 4001)
  GRAPHOS_DB_PATH              sqlite db path (default ~/.graphos/traces.db)
  GRAPHOS_RETENTION_SESSIONS   max sessions kept on disk (default 200)
`);
};

if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
  usage();
  process.exit(0);
}

if (subcommand !== "dashboard") {
  process.stderr.write(`graphos: unknown command "${subcommand}"\n\n`);
  usage();
  process.exit(1);
}

const wsServer = resolve(pkgRoot, "ws-server.mjs");
const builtMarker = resolve(pkgRoot, ".next/BUILD_ID");
const nextBin = resolve(pkgRoot, "node_modules/.bin/next");
const nextBinAlt = resolve(pkgRoot, "../../node_modules/.bin/next");
const nextEntry =
  (existsSync(nextBin) && nextBin) ||
  (existsSync(nextBinAlt) && nextBinAlt) ||
  null;

if (!nextEntry) {
  process.stderr.write(
    "graphos: cannot find the next binary. Reinstall @graphos/dashboard.\n"
  );
  process.exit(1);
}

const children = [];

const launch = (cmd, args, label, env = process.env) => {
  const child = spawn(cmd, args, {
    cwd: pkgRoot,
    stdio: ["inherit", "pipe", "pipe"],
    env,
  });
  const prefix = `[${label}] `;
  child.stdout.on("data", (d) => process.stdout.write(prefix + d.toString()));
  child.stderr.on("data", (d) => process.stderr.write(prefix + d.toString()));
  child.on("exit", (code) => {
    process.stdout.write(`${prefix}exited (code ${code})\n`);
    for (const c of children) if (c !== child) c.kill("SIGTERM");
    process.exit(code ?? 0);
  });
  children.push(child);
};

const shutdown = () => {
  for (const c of children) c.kill("SIGTERM");
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (existsSync(builtMarker)) {
  launch(nextEntry, ["start", "-p", PORT], "next");
} else {
  launch(nextEntry, ["dev", "-p", PORT], "next");
}
launch(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", wsServer],
  "ws"
);

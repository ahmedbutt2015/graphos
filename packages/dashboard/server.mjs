#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const children = [];

const launch = (cmd, args, label) => {
  const child = spawn(cmd, args, {
    cwd: here,
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
  const prefix = `[${label}] `;
  child.stdout.on("data", (d) => process.stdout.write(prefix + d.toString()));
  child.stderr.on("data", (d) => process.stderr.write(prefix + d.toString()));
  child.on("exit", (code) => {
    console.log(`${prefix}exited with code ${code}`);
    for (const c of children) if (c !== child) c.kill("SIGTERM");
    process.exit(code ?? 0);
  });
  children.push(child);
};

const next = resolve(here, "node_modules/.bin/next");
launch(next, ["dev", "-p", "4000"], "next");
launch(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", resolve(here, "ws-server.mjs")],
  "ws"
);

const shutdown = () => {
  for (const c of children) c.kill("SIGTERM");
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

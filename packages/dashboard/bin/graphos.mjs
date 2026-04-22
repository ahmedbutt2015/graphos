#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const subcommand = process.argv[2];

if (subcommand !== "dashboard") {
  console.error("usage: graphos dashboard");
  process.exit(1);
}

const child = spawn(process.execPath, [resolve(pkgRoot, "server.mjs")], {
  cwd: pkgRoot,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));

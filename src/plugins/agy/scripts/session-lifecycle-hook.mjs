#!/usr/bin/env node
// session-lifecycle-hook.mjs
// Lightweight SessionStart / SessionEnd hook. It only ensures the plugin's state
// directory exists and records the current session/repo. It must never fail the
// session, so every path exits 0.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

try {
  const phase = process.argv[2] || "SessionStart";
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const root = (top.stdout || "").trim() || process.cwd();
  const id = createHash("sha1").update(root).digest("hex").slice(0, 12);
  const dir = join(homedir(), ".agy-plugin-cc", "jobs", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, ".session.json"),
    JSON.stringify({ phase, root, at: new Date().toISOString() }, null, 2),
  );
} catch {
  /* never block the session */
}
process.exit(0);

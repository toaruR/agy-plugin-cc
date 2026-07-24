// Test helpers: build an isolated environment (temp HOME, temp git repo, a PATH
// containing only symlinked tools + a fake `agy` shim) and run the companion.
//
// POSIX-targeted (macOS/Linux), matching the reference plugin's CI. The fake agy
// is a Node shebang script placed on PATH.

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  chmodSync,
  symlinkSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const COMPANION = join(HERE, "..", "plugins", "agy", "scripts", "agy-companion.mjs");

// Tools the companion (and the fake agy shebang) need available on the isolated PATH.
const TOOLS = ["node", "git", "npm", "script", "env", "bash", "sh", "dirname", "uname"];

function which(cmd) {
  const r = spawnSync("bash", ["-lc", `command -v ${cmd}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const FAKE_AGY = `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === "--version") {
  process.stdout.write((process.env.FAKE_AGY_VERSION || "agy 1.1.5") + "\\n");
  process.exit(0);
}
// Emulate upstream bug #76: emit only under a real TTY when FAKE_AGY_TTY_ONLY=1.
if (process.env.FAKE_AGY_TTY_ONLY === "1" && !process.stdout.isTTY) process.exit(0);
process.stdout.write("[fake-agy] " + JSON.stringify(a) + "\\n");
process.exit(0);
`;

export function makeEnv({ withAgy = true, agyVersion = "agy 1.1.5", ttyOnly = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "agytest-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  for (const d of [home, repo, bin]) mkdirSync(d, { recursive: true });

  for (const t of TOOLS) {
    const p = which(t);
    if (p && !existsSync(join(bin, t))) {
      try {
        symlinkSync(p, join(bin, t));
      } catch {
        /* ignore */
      }
    }
  }
  if (!existsSync(join(bin, "node"))) symlinkSync(process.execPath, join(bin, "node"));

  if (withAgy) {
    writeFileSync(join(bin, "agy"), FAKE_AGY);
    chmodSync(join(bin, "agy"), 0o755);
  }

  const gitEnv = {
    PATH: bin,
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  execSync(
    'git init -q && git config user.email t@t.co && git config user.name t && ' +
      'echo hi > a.txt && git add a.txt && git commit -qm init',
    { cwd: repo, env: gitEnv },
  );

  return { root, home, repo, bin, agyVersion, ttyOnly };
}

// Run the companion. `argStr` is passed as ONE argument, mirroring how the slash
// commands invoke it with a single quoted "$ARGUMENTS" string.
export function run(env, sub, argStr = "") {
  const runEnv = {
    PATH: env.bin,
    HOME: env.home,
    GIT_CONFIG_GLOBAL: join(env.home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    FAKE_AGY_VERSION: env.agyVersion,
    FAKE_AGY_TTY_ONLY: env.ttyOnly ? "1" : "0",
  };
  const args = [COMPANION, sub];
  if (argStr) args.push(argStr);
  const r = spawnSync("node", args, { cwd: env.repo, env: runEnv, encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// Mutate the repo so there is something to review.
export function changeWorkingTree(env) {
  appendFileSync(join(env.repo, "a.txt"), "a changed line\n");
  writeFileSync(join(env.repo, "b.txt"), "brand new untracked file\n");
}

// Read all tracked jobs from the isolated HOME.
export function jobs(env) {
  const base = join(env.home, ".agy-plugin-cc", "jobs");
  if (!existsSync(base)) return [];
  const out = [];
  for (const d of readdirSync(base)) {
    const dir = join(base, d);
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".json") && f !== ".session.json") {
        try {
          out.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
        } catch {
          /* ignore */
        }
      }
    }
  }
  return out;
}

export function scriptAvailable() {
  return !!which("script");
}

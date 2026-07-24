#!/usr/bin/env node
// agy-companion.mjs
// Runtime broker between Claude Code and the Antigravity CLI (`agy`).
//
// Subcommands:
//   setup   [--json]                         Check whether agy is installed / configured.
//   review  [--base <ref>] [--background]    Run a read-only code review of local git state.
//   task    "<prompt>" [flags]               Delegate a task to agy (write-capable by default).
//   status  [<job-id>]                       Show running / recent jobs for this repo.
//   result  [<job-id>]                       Print the stored output of a finished job.
//   cancel  [<job-id>]                       Cancel a running job.
//   task-resume-candidate [--json]           Report whether a prior agy task exists to continue.
//
// Key detail: `agy -p` prints nothing when stdout is not a real terminal, so it must be
// run inside a pseudo-terminal. On macOS/Linux we allocate one with `script`. On Windows
// (no `script`) we fall back to a direct spawn and warn the user.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function stripAnsi(s) {
  // Remove ANSI escape sequences and lone carriage returns from PTY output.
  return String(s)
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "") // OSC sequences
    .replace(/\x1B[@-Z\\-_]/g, "") // single-char escapes
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
    .replace(/\r(?!\n)/g, "\n")
    .replace(/\r/g, "");
}

function shQuote(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

// Tokenize a raw argument string, honoring single/double quotes.
function tokenize(raw) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) out.push(m[1].replace(/\\(.)/g, "$1"));
    else if (m[2] !== undefined) out.push(m[2]);
    else out.push(m[3]);
  }
  return out;
}

// Pull flags out of a token list. Returns { flags, positionals }.
// `withValue` = flag names that consume the next token.
function extractFlags(tokens, boolFlags, valueFlags) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (valueFlags.includes(t)) {
      flags[t.replace(/^--?/, "")] = tokens[++i];
    } else if (boolFlags.includes(t)) {
      flags[t.replace(/^--?/, "")] = true;
    } else {
      positionals.push(t);
    }
  }
  return { flags, positionals };
}

// ---------------------------------------------------------------------------
// Git / state helpers
// ---------------------------------------------------------------------------

function git(args, opts = {}) {
  const r = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return { code: r.status ?? 1, out: r.stdout || "", err: r.stderr || "" };
}

function repoRoot() {
  const r = git(["rev-parse", "--show-toplevel"]);
  if (r.code === 0 && r.out.trim()) return r.out.trim();
  return process.cwd();
}

function repoId() {
  return createHash("sha1").update(repoRoot()).digest("hex").slice(0, 12);
}

function stateRoot() {
  return join(homedir(), ".agy-plugin-cc");
}

function jobsDir() {
  const dir = join(stateRoot(), "jobs", repoId());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function newJobId(kind) {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `job-${kind}-${ts}-${randomBytes(3).toString("hex")}`;
}

function jobPath(id) {
  return join(jobsDir(), `${id}.json`);
}

function saveJob(job) {
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2));
}

function loadJob(id) {
  const p = jobPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function listJobs() {
  const dir = jobsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

function latestJob(filter) {
  return listJobs().find((j) => (filter ? filter(j) : true)) || null;
}

// ---------------------------------------------------------------------------
// agy discovery & execution
// ---------------------------------------------------------------------------

function findAgy() {
  const probe = spawnSync("agy", ["--version"], { encoding: "utf8" });
  if (probe.error) {
    return { installed: false, version: null };
  }
  const version = (probe.stdout || probe.stderr || "").trim().split("\n")[0];
  return { installed: true, version: version || "unknown" };
}

function isConfigured() {
  // agy stores auth/settings under ~/.gemini/antigravity-cli/
  return existsSync(join(homedir(), ".gemini", "antigravity-cli"));
}

// Run `agy` directly. `agy -p` / `--print` is the official non-interactive mode.
function runAgyDirect(agyArgs, opts) {
  return spawnSync("agy", agyArgs, opts);
}

// Fallback: run `agy` inside a pseudo-terminal (POSIX only) in case a given agy
// build withholds output when stdout is not a TTY (upstream bug #76, agy <= 1.0.6).
function runAgyPty(agyArgs, opts) {
  if (IS_MAC) {
    // BSD script: `script -q /dev/null <cmd> [args...]`
    return spawnSync("script", ["-q", "/dev/null", "agy", ...agyArgs], opts);
  }
  // util-linux script: `script -qec "<command>" /dev/null` (-e returns child exit code)
  const command = ["agy", ...agyArgs].map(shQuote).join(" ");
  return spawnSync("script", ["-qec", command, "/dev/null"], opts);
}

// Last-resort fallback for Windows builds that gate stdout on a TTY: hand the prompt
// to agy-headless-bridge (`agy-bridge`) if it is installed. This is lossy — it only
// forwards the prompt and --model (bridge has no --effort/--mode/-c/permission flags).
function runAgyBridge(agyArgs, opts) {
  const pIdx = agyArgs.indexOf("-p");
  const prompt = pIdx >= 0 ? agyArgs[pIdx + 1] : agyArgs.filter((a) => !a.startsWith("-")).join(" ");
  const mIdx = agyArgs.indexOf("--model");
  const bridgeArgs = [];
  if (mIdx >= 0) bridgeArgs.push("--model", agyArgs[mIdx + 1]);
  bridgeArgs.push(prompt);
  return spawnSync("agy-bridge", bridgeArgs, opts);
}

// Run `agy` and return { code, output }. Direct first — this matches the official CLI and
// works on current agy (1.1.x returns output to a non-TTY stdout). Only if the run comes
// back empty (older/gated builds) do we retry: `script` on POSIX, `agy-bridge` on Windows.
function runAgy(agyArgs, { cwd } = {}) {
  const opts = { cwd: cwd || process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };

  let r = runAgyDirect(agyArgs, opts);
  if (r.error) {
    return { code: 1, output: `agy could not be launched: ${r.error.message}` };
  }
  let output = stripAnsi(r.stdout || "");

  if (!output.trim()) {
    const retry = IS_WIN ? runAgyBridge(agyArgs, opts) : runAgyPty(agyArgs, opts);
    if (process.env.AGY_PTY_DEBUG) {
      process.stderr.write(
        "[pty-debug] " +
          JSON.stringify({
            platform: process.platform,
            hasDevTty: existsSync("/dev/tty"),
            term: process.env.TERM || null,
            retryStatus: retry?.status ?? null,
            retrySignal: retry?.signal ?? null,
            retryError: retry?.error ? retry.error.message : null,
            retryStdoutLen: (retry?.stdout || "").length,
            retryStderrLen: (retry?.stderr || "").length,
            retryStderr: stripAnsi(retry?.stderr || "").slice(0, 300),
          }) +
          "\n",
      );
    }
    if (retry && !retry.error) {
      const retryOut = stripAnsi(retry.stdout || "");
      if (retryOut.trim()) {
        output = retryOut;
        r = retry;
      }
    }
  }

  if (!output.trim()) {
    const err = stripAnsi(r.stderr || "").trim();
    output = err
      ? `agy returned no stdout. stderr:\n${err}`
      : IS_WIN
        ? "agy produced no output. Your agy build may gate stdout on a TTY. Install " +
          "agy-headless-bridge (`pip install agy-headless-bridge`) or run inside WSL."
        : "agy produced no output. Ensure the `script` command is available, or install " +
          "agy-headless-bridge as a fallback.";
  }
  return { code: r.status ?? 0, output };
}

// Execute an agy run, tracking it as a job and printing the output verbatim.
function runTracked(kind, agyArgs, meta = {}) {
  const cwd = repoRoot();
  const job = {
    id: newJobId(kind),
    kind,
    status: "running",
    startedAt: new Date().toISOString(),
    endedAt: null,
    pid: process.pid,
    cwd,
    args: agyArgs,
    output: "",
    ...meta,
  };
  saveJob(job);

  const { code, output } = runAgy(agyArgs, { cwd });

  job.status = code === 0 ? "completed" : "failed";
  job.endedAt = new Date().toISOString();
  job.exitCode = code;
  job.output = output;
  saveJob(job);

  process.stdout.write(output.endsWith("\n") ? output : output + "\n");
  process.stdout.write(`\n[agy job ${job.id} — ${job.status}]\n`);
  process.exit(code === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function cmdSetup(tokens) {
  const wantsJson = tokens.includes("--json");
  const { installed, version } = findAgy();
  const configured = isConfigured();
  const npm = !spawnSync("npm", ["--version"], { encoding: "utf8" }).error;
  const installHint = IS_WIN
    ? "irm https://antigravity.google/cli/install.ps1 | iex"
    : "curl -fsSL https://antigravity.google/cli/install.sh | bash";

  if (wantsJson) {
    process.stdout.write(
      JSON.stringify(
        { installed, version, configured, npmAvailable: npm, installHint },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const lines = [];
  if (!installed) {
    lines.push("Antigravity CLI (agy) is NOT installed.");
    lines.push(`Install it with:\n    ${installHint}`);
    lines.push("Then run `agy install` to configure PATH and shell settings.");
  } else {
    lines.push(`Antigravity CLI (agy) is installed (${version}).`);
    if (!configured) {
      lines.push(
        "It does not look authenticated yet. Run `!agy` once and sign in, then retry.",
      );
    } else {
      lines.push("agy looks configured and ready.");
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
}

function collectDiff(base) {
  if (base) {
    const d = git(["diff", `${base}...HEAD`]);
    return { label: `branch vs ${base}`, diff: d.out, hasWork: !!d.out.trim() };
  }
  const staged = git(["diff", "--cached"]).out;
  const unstaged = git(["diff"]).out;
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).out.trim();
  const diff = [staged, unstaged].filter(Boolean).join("\n");
  const hasWork = !!(diff.trim() || untracked);
  const untrackedNote = untracked
    ? `\n\nUntracked files (not shown in diff):\n${untracked}`
    : "";
  return { label: "working tree", diff: diff + untrackedNote, hasWork };
}

function cmdReview(rawTokens) {
  const { flags } = extractFlags(
    rawTokens,
    ["--background", "--wait"],
    ["--base"],
  );
  const { installed } = findAgy();
  if (!installed) {
    process.stdout.write("agy is not installed. Run `/agy:setup` first.\n");
    process.exit(1);
  }

  const { label, diff, hasWork } = collectDiff(flags.base);
  if (!hasWork) {
    process.stdout.write(`Nothing to review (${label} is clean).\n`);
    process.exit(0);
  }

  const MAX = 180_000;
  let body;
  if (diff.length <= MAX) {
    body = `Here is the ${label} diff to review:\n\n\`\`\`diff\n${diff}\n\`\`\``;
  } else {
    const scopeCmd = flags.base ? `git diff ${flags.base}...HEAD` : "git diff HEAD";
    body =
      `The ${label} change is large. Inspect it yourself in READ-ONLY mode by running ` +
      `\`${scopeCmd}\` and reading the relevant files. Do not modify anything.`;
  }

  const prompt = [
    "You are performing a strict, read-only code review.",
    "Do NOT edit, create, or delete any files. Do NOT run write commands.",
    "Report concrete issues grouped by severity (blocker / high / medium / low),",
    "each with file:line references and a short suggested fix. If you find nothing",
    "material, say so plainly.",
    "",
    body,
  ].join("\n");

  runTracked("review", ["-p", prompt], { scope: label, base: flags.base || null });
}

function cmdTask(rawTokens) {
  const { flags, positionals } = extractFlags(
    rawTokens,
    ["--background", "--wait", "--resume", "--resume-last", "--fresh", "--read-only", "--write"],
    ["--model", "--effort", "--mode"],
  );

  const { installed } = findAgy();
  if (!installed) {
    process.stdout.write("agy is not installed. Run `/agy:setup` first.\n");
    process.exit(1);
  }

  const taskText = positionals.join(" ").trim();
  if (!taskText) {
    process.stdout.write("No task text provided. Tell agy what to investigate or fix.\n");
    process.exit(1);
  }

  const agyArgs = ["-p", taskText];
  if (flags.model) agyArgs.push("--model", flags.model);
  if (flags.effort) agyArgs.push("--effort", flags.effort);
  if (flags.mode) agyArgs.push("--mode", flags.mode);

  // Continue the most recent agy conversation when asked to resume.
  const resume = (flags.resume || flags["resume-last"]) && !flags.fresh;
  if (resume) agyArgs.push("-c");

  // Write-capable by default (like a rescue). Headless agy cannot answer permission
  // prompts, so auto-approve tools when writing. Read-only skips that.
  const readOnly = flags["read-only"] && !flags.write;
  if (!readOnly) agyArgs.push("--dangerously-skip-permissions");

  runTracked("task", agyArgs, {
    model: flags.model || null,
    effort: flags.effort || null,
    mode: flags.mode || null,
    writeCapable: !readOnly,
    resumed: !!resume,
    taskText,
  });
}

function fmtJob(j) {
  const dur = j.endedAt
    ? `${Math.max(0, (Date.parse(j.endedAt) - Date.parse(j.startedAt)) / 1000).toFixed(0)}s`
    : "…";
  const summary =
    j.kind === "task" ? (j.taskText || "").slice(0, 60) : j.scope || "";
  return `${j.id}  [${j.kind}]  ${j.status}  ${dur}  ${summary}`;
}

function cmdStatus(tokens) {
  const id = tokens.find((t) => t.startsWith("job-"));
  if (id) {
    const j = loadJob(id);
    if (!j) {
      process.stdout.write(`No job found with id ${id}.\n`);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(j, (k, v) => (k === "output" ? undefined : v), 2) + "\n");
    return;
  }
  const jobs = listJobs();
  if (jobs.length === 0) {
    process.stdout.write("No agy jobs recorded for this repository yet.\n");
    return;
  }
  process.stdout.write("Recent agy jobs (newest first):\n");
  for (const j of jobs.slice(0, 15)) process.stdout.write("  " + fmtJob(j) + "\n");
}

function cmdResult(tokens) {
  const id = tokens.find((t) => t.startsWith("job-"));
  const j = id ? loadJob(id) : latestJob((x) => x.status !== "running");
  if (!j) {
    process.stdout.write(id ? `No job found with id ${id}.\n` : "No finished jobs found.\n");
    process.exit(1);
  }
  if (j.status === "running") {
    process.stdout.write(`Job ${j.id} is still running. Check \`/agy:status\`.\n`);
    return;
  }
  process.stdout.write(`# ${j.id} (${j.kind}, ${j.status})\n\n`);
  process.stdout.write((j.output || "(no output captured)") + "\n");
}

function cmdCancel(tokens) {
  const id = tokens.find((t) => t.startsWith("job-"));
  const j = id ? loadJob(id) : latestJob((x) => x.status === "running");
  if (!j) {
    process.stdout.write(id ? `No job found with id ${id}.\n` : "No running job to cancel.\n");
    process.exit(1);
  }
  if (j.status !== "running") {
    process.stdout.write(`Job ${j.id} is already ${j.status}.\n`);
    return;
  }
  try {
    if (j.pid) process.kill(j.pid, "SIGTERM");
  } catch {
    /* process already gone */
  }
  j.status = "cancelled";
  j.endedAt = new Date().toISOString();
  saveJob(j);
  process.stdout.write(`Cancelled job ${j.id}.\n`);
}

function cmdResumeCandidate(tokens) {
  const wantsJson = tokens.includes("--json");
  const j = latestJob((x) => x.kind === "task" && x.status === "completed");
  const payload = { available: !!j, jobId: j ? j.id : null };
  if (wantsJson) {
    process.stdout.write(JSON.stringify(payload) + "\n");
  } else {
    process.stdout.write(
      payload.available ? `Resumable task: ${payload.jobId}\n` : "No resumable task.\n",
    );
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function main() {
  const sub = process.argv[2];
  // Everything after the subcommand may arrive as one quoted string or many args.
  const raw = process.argv.slice(3).join(" ");
  const tokens = tokenize(raw);

  switch (sub) {
    case "setup":
      return cmdSetup(tokens);
    case "review":
      return cmdReview(tokens);
    case "task":
      return cmdTask(tokens);
    case "status":
      return cmdStatus(tokens);
    case "result":
      return cmdResult(tokens);
    case "cancel":
      return cmdCancel(tokens);
    case "task-resume-candidate":
      return cmdResumeCandidate(tokens);
    default:
      process.stdout.write(
        "Usage: agy-companion.mjs <setup|review|task|status|result|cancel|task-resume-candidate> [args]\n",
      );
      process.exit(sub ? 1 : 0);
  }
}

main();

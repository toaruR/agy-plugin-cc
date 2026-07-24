import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, run, jobs, changeWorkingTree, scriptAvailable } from "./helpers.mjs";

test("setup: reports installed agy and version", () => {
  const env = makeEnv({ agyVersion: "agy 1.1.5" });
  const { out } = run(env, "setup", "--json");
  const j = JSON.parse(out);
  assert.equal(j.installed, true);
  assert.match(j.version, /1\.1\.5/);
});

test("setup: reports missing agy with an install hint", () => {
  const env = makeEnv({ withAgy: false });
  const { out } = run(env, "setup", "--json");
  const j = JSON.parse(out);
  assert.equal(j.installed, false);
  assert.match(j.installHint, /antigravity\.google/);
});

test("review: nothing to review on a clean repo", () => {
  const env = makeEnv();
  const { out } = run(env, "review", "");
  assert.match(out, /Nothing to review/);
});

test("review: runs on working-tree changes and records a completed job", () => {
  const env = makeEnv();
  changeWorkingTree(env);
  const { out } = run(env, "review", "");
  assert.match(out, /\[fake-agy\]/);
  const reviewJobs = jobs(env).filter((j) => j.kind === "review");
  assert.equal(reviewJobs.length, 1);
  assert.equal(reviewJobs[0].status, "completed");
});

test("review: read-only prompt is passed and never enables writes", () => {
  const env = makeEnv();
  changeWorkingTree(env);
  const { out } = run(env, "review", "");
  // The review prompt goes through -p; it must not auto-approve writes.
  assert.match(out, /"-p"/);
  assert.doesNotMatch(out, /--dangerously-skip-permissions/);
});

test("review: --base with an empty branch diff reports nothing to review", () => {
  const env = makeEnv();
  changeWorkingTree(env);
  const { out } = run(env, "review", "--base HEAD");
  assert.match(out, /Nothing to review/);
});

test("task: write-capable by default (auto-approves for headless edits)", () => {
  const env = makeEnv();
  const { out } = run(env, "task", "fix the failing test");
  assert.match(out, /"-p"/);
  assert.match(out, /fix the failing test/);
  assert.match(out, /--dangerously-skip-permissions/);
});

test("task: --read-only never auto-approves writes", () => {
  const env = makeEnv();
  const { out } = run(env, "task", "--read-only audit for race conditions");
  assert.match(out, /audit for race conditions/);
  assert.doesNotMatch(out, /--dangerously-skip-permissions/);
});

test("task: --resume continues the latest conversation via agy -c", () => {
  const env = makeEnv();
  const { out } = run(env, "task", "--resume keep going");
  assert.match(out, /"-c"/);
});

test("task: --model/--effort/--mode are forwarded, not folded into the prompt", () => {
  const env = makeEnv();
  const { out } = run(
    env,
    "task",
    "--model gemini-3-pro --effort high --mode plan refactor the parser",
  );
  assert.match(out, /"--model","gemini-3-pro"/);
  assert.match(out, /"--effort","high"/);
  assert.match(out, /"--mode","plan"/);
  // Flags must not leak into the prompt text.
  assert.match(out, /"-p","refactor the parser"/);
});

test("status: lists recorded jobs newest-first", () => {
  const env = makeEnv();
  run(env, "task", "first task");
  run(env, "task", "second task");
  const { out } = run(env, "status", "");
  assert.match(out, /\[task\]/);
  assert.match(out, /job-task-/);
});

test("result: prints the stored output of the latest finished job", () => {
  const env = makeEnv();
  run(env, "task", "do the thing");
  const { out } = run(env, "result", "");
  assert.match(out, /\[fake-agy\]/);
});

test("cancel: reports when there is no running job", () => {
  const env = makeEnv();
  const { out } = run(env, "cancel", "");
  assert.match(out, /No running job/);
});

test("task-resume-candidate: available after a completed task", () => {
  const env = makeEnv();
  run(env, "task", "seed a completed task");
  const { out } = run(env, "task-resume-candidate", "--json");
  const j = JSON.parse(out);
  assert.equal(j.available, true);
  assert.match(j.jobId, /^job-task-/);
});

test(
  "TTY-gated agy is recovered by the PTY fallback",
  {
    // GitHub Actions macOS runners wire job-step stdin to a socket, not a tty/pty;
    // BSD `script` fails outright (tcgetattr/ioctl on socket) so this can't run there
    // (see CLAUDE.md gotchas).
    skip: process.platform === "win32" || !scriptAvailable() || !!process.env.CI,
  },
  () => {
    const env = makeEnv({ ttyOnly: true }); // direct spawn returns empty
    const { out } = run(env, "task", "still works under a pty");
    assert.match(out, /\[fake-agy\]/);
  },
);

test("unknown subcommand prints usage", () => {
  const env = makeEnv();
  const { out } = run(env, "bogus", "");
  assert.match(out, /Usage:/);
});

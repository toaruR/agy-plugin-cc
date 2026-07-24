# Antigravity (agy) plugin for Claude Code

Use the [Antigravity CLI](https://antigravity.google/docs/cli/overview) (`agy`) from inside
Claude Code for code reviews or to delegate tasks to agy.

This is a community plugin modeled on the mechanism of
[`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc), reworked for Google's
Antigravity CLI. It is not affiliated with Google.

## What you get

- `/agy:review` — a read-only agy code review of your current work
- `/agy:delegate` — hand a task (investigate, fix, continue) to the `agy:agy-runner` subagent
- `/agy:status`, `/agy:result`, `/agy:cancel` — manage background jobs
- `/agy:setup` — check whether agy is installed and authenticated

## Requirements

- **Antigravity CLI (`agy`)** installed and signed in. Install with
  `curl -fsSL https://antigravity.google/cli/install.sh | bash` (macOS/Linux) or
  `irm https://antigravity.google/cli/install.ps1 | iex` (Windows), then `agy install`.
- **Node.js 18+**.
- **Works on Windows, macOS, and Linux.** Current agy (1.1.x) returns output to a non-TTY
  stdout, so the companion just captures `agy -p` directly. Older agy builds (<= 1.0.6) gated
  stdout on a TTY and returned nothing ([upstream bug #76](https://github.com/rhishi99/agy-headless-bridge));
  if you hit that, the companion automatically retries via the `script` command on macOS/Linux,
  or via [`agy-headless-bridge`](https://github.com/rhishi99/agy-headless-bridge)
  (`pip install agy-headless-bridge`) on Windows if it is installed.

## Install

### Claude Code (CLI)

Add the marketplace:

```
/plugin marketplace add toaruR/agy-plugin-cc
```

Install the plugin:

```
/plugin install agy@antigravity-agy
```

Reload plugins, then run:

```
/agy:setup
```

### Claude Code for VS Code

The VS Code extension's chat has no `/plugin` command. Clone the repo locally, then add it as a
marketplace by file path through the **Customize → Manage plugins** UI panel (not chat):

```
git clone https://github.com/toaruR/agy-plugin-cc.git
```

1. Open **Customize → Manage plugins** in the extension.
2. Add a marketplace pointing at the local `agy-plugin-cc` path (not the GitHub URL).
3. Install/enable `agy@antigravity-agy` from that marketplace.
4. Start a new chat session, then run `/agy:setup`.

A simple first run:

```
/agy:review --background
/agy:status
/agy:result
```

## Usage

### `/agy:review`

Runs a strict, read-only review of your current git changes. Supports `--base <ref>` for a
branch review, plus `--wait` and `--background`.

```
/agy:review
/agy:review --base main
/agy:review --background
```

The companion collects the diff (`git diff`, staged, and untracked), builds a read-only review
prompt, and runs it through agy. It never edits code.

### `/agy:delegate`

Hands a task to agy through the `agy:agy-runner` subagent. Write-capable by default.

```
/agy:delegate investigate why the tests started failing
/agy:delegate --read-only audit this module for race conditions
/agy:delegate --resume apply the top fix from the last run
/agy:delegate --model gemini-3-pro --effort high refactor the DB connection
/agy:delegate --background investigate the flaky integration test
```

Flags:

- `--background` / `--wait` — Claude-side execution control.
- `--resume` / `--fresh` — continue the most recent agy conversation (`agy -c`) or start new.
- `--read-only` — diagnosis/research only, no edits.
- `--model` / `--effort` / `--mode` — forwarded to agy (`--model`, `--effort`, `--mode`).

Write-capable runs pass `--dangerously-skip-permissions` to agy so it can apply edits without
an interactive approval prompt (headless mode cannot answer prompts). Only delegate write work
in repositories you trust.

### `/agy:status`, `/agy:result`, `/agy:cancel`

```
/agy:status
/agy:status job-task-20260724T120000-ab12cd
/agy:result
/agy:cancel
```

Jobs are tracked per repository under `~/.agy-plugin-cc/jobs/<repo-hash>/`.

### `/agy:setup`

Checks whether agy is installed and configured. If it is missing, it offers to run the
official installer.

## How it works

The plugin delegates to your **local** `agy` install and its local authentication — the same
account and configuration you use when running agy directly. It does not bundle a separate
runtime.

`scripts/agy-companion.mjs` is the broker. It discovers `agy`, builds the right invocation for
each command, captures the output (directly, with a PTY / `agy-bridge` fallback for TTY-gated
builds), tracks every run as a job, and returns agy's output verbatim.

## Layout

```
.claude-plugin/marketplace.json     Marketplace manifest
plugins/agy/
  .claude-plugin/plugin.json        Plugin manifest
  commands/                         /agy:* slash commands
  agents/agy-runner.md              Delegation subagent
  skills/agy-cli-runtime/           Internal runtime contract (subagent only)
  hooks/hooks.json                  Session lifecycle bookkeeping
  scripts/agy-companion.mjs         Runtime broker
  scripts/session-lifecycle-hook.mjs
```

## License

MIT. Not affiliated with or endorsed by Google. "Antigravity" and "Gemini" are trademarks of
Google LLC.

---
name: agy-cli-runtime
description: Internal helper contract for calling the agy-companion runtime from Claude Code
user-invocable: false
---

# agy Runtime

Use this skill only inside the `agy:agy-runner` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task "<raw arguments>"`

Execution rules:
- The runner is a forwarder, not an orchestrator. Its only job is to invoke `task` once and
  return that stdout unchanged.
- Prefer the helper over hand-rolled `git`, direct `agy` CLI strings, or other Bash activity.
- Do not call `setup`, `review`, `status`, `result`, or `cancel` from `agy:agy-runner`.
- Use `task` for every request, including diagnosis, planning, research, and explicit fixes.

Flag handling:
- `--background` / `--wait` are Claude-side execution controls. Strip them before calling
  `task`; never treat them as task text.
- `--model <name>` selects the model (e.g. `gemini-3-pro`). Pass through unchanged.
- `--effort <low|medium|high>` sets reasoning effort. Pass through unchanged.
- `--mode <accept-edits|plan>` sets the agent execution mode. Pass through unchanged.
- `--resume` continues the most recent agy conversation (the companion adds `agy -c`).
  `--fresh` forces a new conversation. Pass these through; do not include them in task text.
- `--read-only` makes the run non-writing. Omit it to keep the default write-capable behavior.

How the companion runs agy:
- It launches `agy -p "<prompt>"` directly (the official non-interactive print mode). On
  macOS/Linux, if that returns no output, it retries once inside a pseudo-terminal (`script`)
  as a safety net for builds that only emit under a TTY.
- Write-capable runs add `--dangerously-skip-permissions` so headless agy can apply edits
  without an interactive approval prompt. `--read-only` omits this.
- Every run is tracked as a job so `/agy:status`, `/agy:result`, and `/agy:cancel` work.

Safety rules:
- Preserve the user's task text as-is apart from stripping routing/execution flags.
- Do not inspect the repository, monitor progress, poll status, fetch results, cancel jobs,
  summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or agy cannot be invoked, return nothing.

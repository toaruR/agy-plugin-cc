---
description: Delegate an investigation or fix to the Antigravity (agy) runner subagent
argument-hint: "[--background|--wait] [--resume|--fresh] [--read-only] [--model <model>] [--effort <low|medium|high>] [--mode <accept-edits|plan>] [what agy should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `agy:agy-runner` subagent via the `Agent` tool (`subagent_type: "agy:agy-runner"`),
forwarding the raw user request as the prompt. The final user-visible response must be agy's
output verbatim.

`agy:agy-runner` is a subagent, not a skill — do not call `Skill(...)`. The command runs
inline so the `Agent` tool stays in scope.

Raw user request:
$ARGUMENTS

Execution mode:
- If the request includes `--background`, run the subagent in the background.
- If the request includes `--wait`, run the subagent in the foreground.
- If neither is present, default to foreground for small bounded tasks and background for
  open-ended, multi-step work.
- `--background` and `--wait` are Claude-side execution controls. Do not forward them to the
  companion `task` command, and do not treat them as part of the natural-language task text.
- `--model`, `--effort`, and `--mode` are runtime-selection flags. Preserve them for the
  forwarded call, but do not treat them as part of the task text.
- If the request includes `--resume` or `--fresh`, do not ask; the user already chose.
- Otherwise, check for a resumable agy thread for this repo:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task-resume-candidate --json
```

- If that helper reports `available: true`, use `AskUserQuestion` exactly once:
  - `Continue current agy thread`
  - `Start a new agy thread`
- If the user is clearly giving a follow-up ("continue", "keep going", "resume", "apply the
  top fix", "dig deeper"), put `Continue current agy thread (Recommended)` first; otherwise
  put `Start a new agy thread (Recommended)` first.
- If the user chooses continue, add `--resume`; if they choose new, add `--fresh`.
- If the helper reports `available: false`, do not ask. Route normally.

Operating rules:
- The subagent is a thin forwarder. It makes one `Bash` call to
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task ...` and returns that stdout as-is.
- Return the companion stdout verbatim. Do not paraphrase, summarize, or add commentary.
- agy tasks are write-capable by default. Pass `--read-only` to force a review/diagnosis-only run.
- Leave `--model`, `--effort`, and `--mode` unset unless the user explicitly asks for them.
- If the companion reports that agy is missing, stop and tell the user to run `/agy:setup`.
- If the user did not supply a request, ask what agy should investigate or fix.

You can also just ask in natural language, e.g. "Ask agy to make the DB connection more resilient."

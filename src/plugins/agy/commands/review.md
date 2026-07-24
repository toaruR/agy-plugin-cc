---
description: Run a read-only Antigravity (agy) code review against local git state
argument-hint: '[--wait|--background] [--base <ref>]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an Antigravity (agy) review of the current work through the companion runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return agy's output verbatim to the user.

Execution mode rules:
- If the raw arguments include `--wait`, do not ask. Run the review in the foreground.
- If the raw arguments include `--background`, do not ask. Run the review in a Claude background task.
- Otherwise, estimate the review size first:
  - For working-tree review, run `git status --short --untracked-files=all` and inspect
    both `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, use `git diff --shortstat <base>...HEAD`.
  - Treat untracked files as reviewable work even when the diff shortstat is empty.
  - Recommend waiting only when the review is clearly tiny (roughly 1-2 files). In every
    other case, including unclear size, recommend background.
- Then use `AskUserQuestion` exactly once with two options, recommended one first with a
  `(Recommended)` suffix:
  - `Wait for results`
  - `Run in background`

Argument handling:
- Preserve the user's arguments exactly. Do not strip `--wait` or `--background`.
- `/agy:review` is native review only. It does not take custom focus text — the companion
  builds a strict read-only review prompt from the git diff.

Foreground flow:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" review "$ARGUMENTS"
```
- Return the command stdout verbatim, exactly as-is. Do not paraphrase, summarize, add
  commentary, or fix any issue mentioned in the review.

Background flow:
- Launch the review with `Bash` in the background:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" review "$ARGUMENTS"`,
  description: "agy review",
  run_in_background: true
})
```
- Do not call `BashOutput` or wait for completion in this turn.
- After launching, tell the user: "agy review started in the background. Check `/agy:status` for progress and `/agy:result` for the output."

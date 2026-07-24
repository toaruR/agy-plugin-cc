---
description: Check whether the Antigravity CLI (agy) is installed and authenticated
argument-hint: '[--json]'
allowed-tools: Bash(node:*), Bash(curl:*), Bash(agy:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup --json $ARGUMENTS
```

If the result says agy is NOT installed:
- Use `AskUserQuestion` exactly once to ask whether Claude should install agy now.
- Put the install option first and suffix it with `(Recommended)`.
- Options:
  - `Install agy (Recommended)`
  - `Skip for now`
- If the user chooses install, run the `installHint` command from the setup output
  (macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`).
- Then rerun the setup check above.

If agy is already installed:
- Do not ask about installation.
- If it is installed but not authenticated, preserve the guidance to run `!agy` once and sign in.

Output rules:
- Present the final human-readable setup status to the user.

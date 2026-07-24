---
description: Show running and recent Antigravity (agy) jobs for this repository
argument-hint: '[<job-id>]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" status $ARGUMENTS
```

Return the command stdout verbatim. Use it to check progress on background work, see the
latest completed job, or confirm whether a task is still running.

---
description: Show the stored output of a finished Antigravity (agy) job
argument-hint: '[<job-id>]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" result $ARGUMENTS
```

With no job id, this shows the most recent finished job. Return the command stdout verbatim.

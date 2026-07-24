---
description: Cancel a running Antigravity (agy) background job
argument-hint: '[<job-id>]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" cancel $ARGUMENTS
```

With no job id, this cancels the most recent running job. Return the command stdout verbatim.

---
description: Take the day off. Pause nudges until tomorrow. Keep your streak.
argument-hint: [reason]
allowed-tools: Bash(node:*)
---
Use this reason, if any: $ARGUMENTS

Run this command with the reason in place of `<reason>`:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/today.mjs" off '<reason>'
```

Keep the reason inside the single quotes. Write each `'` in the reason as `'\''`. Leave out `'<reason>'` if there is no reason.

Show its output as written. Add nothing else.

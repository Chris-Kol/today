---
description: Mark a must-do done. Pass its number, or nothing if only one is open.
argument-hint: [n]
allowed-tools: Bash(node:*)
---
Use this number, if any: $ARGUMENTS

Run this command with the number in place of `<n>`:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/today.mjs" done <n>
```

Use digits only for `<n>`. Leave out `<n>` if there is no number. If the arguments hold anything other than one number, ask the user for the number first.

If the output starts with `Pick which must-do is done`, ask the user which number. Then run the command again with it.

Otherwise show its output as written, inside a code block so the creature keeps its shape. Add nothing else.

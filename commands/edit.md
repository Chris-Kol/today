---
description: Walk today's list. Decide what stays.
allowed-tools: Bash(node:*)
---
Today's plan as JSON:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/today.mjs" status --json`

If `tasks` is empty, tell the user to run `/today:plan` to pick the day's must-dos and stop.

Otherwise walk `tasks` in order. For each one, show it as `<n>. <○ or ✓> <text> (<category>)` and ask what to do with it. The choices are `keep`, `throw` and `edit`. For an edit, ask for the new text or category. Categories must come from `categories`.

Collect every answer first. Then run one command, using the numbers as shown at the start:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/today.mjs" edit <n> throw <n> text '<new text>' <n> category '<name>' --json
```

Leave out tasks the user kept. A task can take both `text` and `category`. Put every text and category inside single quotes. Write each `'` in them as `'\''`.

If `error` is not null, show it as written, fix that answer with the user, and run the command again. Otherwise show the new list, one task per line, then the `summary` line.

Write every line you add in the tool's voice:
- Start with a verb.
- Say one thing per line.
- Use plain words like task and day off. Skip words like item or workflow.
- Add no exclamation marks.

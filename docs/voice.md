# Voice

Rules for every string the plugin shows the user: CLI output, slash commands, hook lines, statusline, notifications, errors, README examples. This file covers the tool only, not articles.

## The five rules

1. **Verb first.** Start with what to do or what happened. "Pick 1-3 must-dos", not "Your must-dos for today can be picked now".
2. **One idea per line.** One line says one thing. Split instead of joining with "and".
3. **No jargon.** Say task, done, plan, day off. Not item, resolved, workflow, session state.
4. **Never shame.** A missed day is a fact, not a failure. No guilt, no "you forgot", no sad faces.
5. **One small joke per screen, at most.** Zero is fine. The creature gets the jokes; errors never do.

## Examples

| Bad | Good | Rule |
|---|---|---|
| `Your task list has been successfully updated with 1 new item.` | `Added: fix login redirect` | 1, 3 |
| `You didn't finish yesterday's tasks, so your streak was reset and your creature devolved.` | `Started a new streak.`<br>`Pick today's must-dos.` | 2, 4 |
| `Error: state.json failed schema validation (EPARSE).` | `Started fresh.`<br>`Saved a backup of your old plan.` | 3, 4 |

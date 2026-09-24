---
description: Pick the day's must-dos, or show them if the day is planned.
allowed-tools: Bash(node:*)
---
Today's plan as JSON:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/today.mjs" plan --json`

Read the JSON and follow the first case that fits.

1. `workDay` is false. Show `summary`. Tell the user to enjoy the day off. If `tasks` is not empty, say how many must-dos wait for the next work day. Ask nothing.
2. `needsPlan` is true and `slots` is above 0. Ask for up to `slots` must-dos in one message, each with a category from `categories`. For each answer run this command:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/today.mjs" add '<category>' '<text>' --json
   ```

   Keep the category and the text inside the single quotes. Write each `'` in them as `'\''`. If `error` is not null, show it as written and ask again for that one task. Then show the final list.
3. Every task in `tasks` is carried and `slots` is above 0. Show the list. Offer to add up to `slots` more in one line. If the user names any, add them as in case 2.
4. Otherwise show the list and ask nothing.

Show the list like this, one task per line:

```
1. ○ fix login redirect (dx)
2. ✓ write the memo (company, carried)
```

End with the `summary` line from the last JSON you got. Print each line from `notices` before anything else.

Write every line you add in the tool's voice:
- Start with a verb.
- Say one thing per line.
- Use plain words like task and day off. Skip words like item or workflow.
- Never blame the user for a missed day.
- Add no exclamation marks and at most one small joke.

# today

Name 1-3 must-dos each morning in Claude Code.
Get nudged while you work.
Keep a streak for finishing them.

Rewards intent kept, not tokens burned.

## Install

```sh
claude plugin marketplace add Chris-Kol/today && claude plugin install today@today
```

Restart Claude Code. Needs Node 22 or newer. No other dependencies.

## Use

- Pick the day's must-dos with `/today:plan`.
  - Shows them instead once the day is planned.
- Mark a must-do done with `/today:done [n]`.
  - Leave out `n` if only one is open.
- Take the day off with `/today:off [reason]`.
  - Pauses nudges until tomorrow.
  - Keeps your streak.
- Undo a day off with `/today:on`.
- Walk the day's list with `/today:edit`.

A new session shows the day's must-dos. Prompts get a nudge every 45 minutes during work hours while a must-do is open.

## Statusline

Paste this line into your own statusline command:

```sh
node "$(ls -dt "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/today/today/*/ | head -1)statusline/today.mjs"
```

It prints one line, like `o ○ fix login redirect · streak 4`.

## Reminders outside Claude Code

Off by default. Add a shell function for the CLI:

```sh
today() { node "$(ls -dt "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/today/today/*/ | head -1)bin/today.mjs" "$@"; }
```

Then schedule a desktop nudge on macOS (launchd) or Linux (systemd user timer):

```sh
today daemon install
```

Undo it with `today daemon remove`. Check your setup with `today doctor`. Run `today daemon install` again after an update or after you change `nudgeEveryMinutes`.

## Config

Every key is optional. Put the ones you want in `~/.today/config.json`:

```json
{
  "categories": ["company", "dx"],
  "workHours": { "start": "09:00", "end": "18:00", "days": [1, 2, 3, 4, 5] },
  "nudgeEveryMinutes": 45,
  "maxTasks": 3,
  "quiet": false,
  "carryOver": true
}
```

| Key | Default | What it does |
|---|---|---|
| `categories` | `["company", "dx"]` | Sets the categories a must-do can take |
| `workHours` | `09:00` to `18:00`, days `1`-`5` | Sets when nudges run. Days go from 1 (Monday) to 7 (Sunday) |
| `nudgeEveryMinutes` | `45` | Sets the gap between nudges |
| `maxTasks` | `3` | Caps must-dos per day, 1 or more |
| `quiet` | `false` | Skips the done animation when `true` |
| `carryOver` | `true` | Moves unfinished must-dos to the next day |

A bad key falls back to its default with a one-line notice. The rest still apply.

Set `TODAY_HOME` to keep config, plan and history somewhere other than `~/.today`:

```sh
export TODAY_HOME="$HOME/.config/today"
```

## More

- [docs/voice.md](docs/voice.md): how every line the tool prints is written.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to run the tests and add to the code.

MIT licensed. See [LICENSE](LICENSE).

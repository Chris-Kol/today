# Contributing

## Run the tests

```sh
npm test
```

Needs Node 22 or newer. CI runs Node 22 and 24.

## Rules

- **Zero dependencies.** Use Node's standard library. Don't add a `dependencies` entry to `package.json`.
- **Hooks never throw.** `session-start`, `nudge` and `statusline` print nothing and exit 0 on any error, including bad state and a closed pipe. Claude Code must never see a stack trace from this plugin.
- **Pure core.** Logic lives in `src/core.mjs`: plain objects in, new objects out, no clock and no fs. Files, the clock and the PATH live in `src/io.mjs`.
- **Write every string in the voice.** Follow [docs/voice.md](docs/voice.md): verb first, one idea per line, no jargon, never shame, one small joke per screen at most.
- **Test first.** Add a `node --test` case under `test/` that fails, then make it pass.
- **Conventional commits and branches.** Commits: `type(scope)?: subject` (types: `feat fix docs spec test refactor style ci chore release`). Branches: `factory/<change>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`, `release/vX.Y.Z`. PR titles follow the commit format. `scripts/guard.mjs` enforces both.

## Add a suggestion source later

Suggestions are not built yet. When they land, a source works like this:

1. Fetch in `src/io.mjs`. Return `[]` when the tool is missing or the call fails.
2. Turn the result into `{ text, category }` must-dos with a pure function in `src/core.mjs`.
3. Let `/today:plan` offer each one as keep, throw or edit. Never add a must-do the user did not keep.
4. Add a `today doctor` line that says whether the source can run.

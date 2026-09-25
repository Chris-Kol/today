# Changelog

Every release of today, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions below 1.0.0 are pre-releases.

## [0.1.2] - 2026-09-25

### Added

- conventional commits and branch names enforced by the guard ([#23](https://github.com/Chris-Kol/today-workshop/pull/23))
- release manager (ship.mjs, /factory:release, changelog) ([#27](https://github.com/Chris-Kol/today-workshop/pull/27))

### Fixed

- review follow-ups from v1 (voice, control chars, validation, guard) ([#25](https://github.com/Chris-Kol/today-workshop/pull/25))

## [0.1.1] - 2026-09-24

### Changed

- Allow any `maxTasks` of 1 or more. The cap of 9 is gone. The default stays 3. ([#22](https://github.com/Chris-Kol/today-workshop/pull/22))

## [0.1.0] - 2026-09-24

### Added

- Pick 1-3 must-dos each morning with `/today:plan`. ([#10](https://github.com/Chris-Kol/today-workshop/pull/10))
- Mark a must-do done with `/today:done`. ([#10](https://github.com/Chris-Kol/today-workshop/pull/10))
- Take the day off with `/today:off`. Undo it with `/today:on`. ([#10](https://github.com/Chris-Kol/today-workshop/pull/10))
- Walk the day's list with `/today:edit`. ([#10](https://github.com/Chris-Kol/today-workshop/pull/10))
- Get a nudge every 45 minutes during work hours while a must-do is open. ([#10](https://github.com/Chris-Kol/today-workshop/pull/10))
- Keep a streak and watch the creature grow. ([#10](https://github.com/Chris-Kol/today-workshop/pull/10))
- Show the day in your statusline. ([#10](https://github.com/Chris-Kol/today-workshop/pull/10))
- Schedule desktop nudges outside Claude Code with `today daemon install`. ([#10](https://github.com/Chris-Kol/today-workshop/pull/10))
- Keep state in `~/.today`. Set `TODAY_HOME` to move it. ([#19](https://github.com/Chris-Kol/today-workshop/pull/19))
- Run the tests on Node 22 and 24 in CI. ([#12](https://github.com/Chris-Kol/today-workshop/pull/12), [#15](https://github.com/Chris-Kol/today-workshop/pull/15))

# configuration Specification

## Purpose
Let the user shape categories, work hours and nudge cadence in one small file, and never lose a day of state to a bad edit.

## Requirements

### Requirement: Config file
The system SHALL read `$TODAY_HOME/config.json` (default `~/.today/config.json`) with keys `categories` (non-empty string array), `workHours` (`start`, `end` as HH:MM, `days` as ISO weekday numbers 1-7), `nudgeEveryMinutes` (integer 1 to 1440; above 1440 is capped at 1440 with a warning, below 1 or non-integer falls back to the default), `maxTasks` (integer, 1 or more), `quiet` (boolean), `carryOver` (boolean). Every key is optional. Missing keys use defaults: `["company","dx"]`, 09:00-18:00 days 1-5, 45, 3, false, true.

#### Scenario: No config file
- WHEN no config file exists
- THEN defaults apply and no file is created until the user changes something

#### Scenario: Invalid value
- WHEN `maxTasks` is `"lots"`
- THEN the default is used for that key, other keys are honored, and a short notice (one idea per line) is printed once

### Requirement: State resilience
The system SHALL treat an unreadable or invalid state file as empty: it renames the bad file to `state.json.bak-<timestamp>`, starts fresh, and reports this once. History is append-only and never rewritten.

#### Scenario: Corrupt state
- WHEN `state.json` contains invalid JSON
- THEN the file is moved aside, a fresh state is created, and the user sees one short notice explaining what happened

### Requirement: Doctor
The system SHALL provide `today doctor` that reports config validity, state file health, and which optional tools are available (`gh`, `osascript` or `notify-send`, `launchctl` or `systemctl`).

#### Scenario: Missing optional tool
- WHEN `notify-send` and `osascript` are both missing
- THEN doctor reports that off-session notifications are unavailable and how to get them

#### Scenario: Daemon job status
- WHEN a daemon job is installed
- THEN doctor reports it and flags a stale script path

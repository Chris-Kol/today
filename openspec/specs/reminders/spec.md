# reminders Specification

## Purpose
Keep today's open tasks in front of the user during work hours without spamming, inside Claude Code and, if they opt in, outside it.

## Requirements

### Requirement: Session start context
The system SHALL, at Claude Code session start, add one line of context when no plan exists for today, at most once per day across all sessions. When a plan exists it adds one line listing open tasks.

#### Scenario: No plan yet, first session
- WHEN a session starts, no plan exists for today, and no session-start line was shown today
- THEN one line is added telling the user to run `/today:plan`

#### Scenario: No plan yet, second session
- WHEN a session starts and the no-plan line was already shown today
- THEN nothing is added

#### Scenario: Plan exists
- WHEN a session starts and tasks are open
- THEN one line lists the open tasks

### Requirement: In-session nudge
The system SHALL, on each user prompt, print at most one line naming the open tasks and remaining work time, only when all of these hold: now is inside work hours on a work day, at least one task is open, and at least `nudgeEveryMinutes` passed since the last nudge. Otherwise it prints nothing.

#### Scenario: Rate limited
- WHEN a nudge was printed 10 minutes ago and `nudgeEveryMinutes` is 45
- THEN nothing is printed

#### Scenario: Outside work hours
- WHEN it is 20:00 and work hours end at 18:00
- THEN nothing is printed

#### Scenario: All done
- WHEN every task is done
- THEN nothing is printed

#### Scenario: Due nudge
- WHEN it is 15:00, work ends at 18:00, task 2 is open, and the last nudge was 50 minutes ago
- THEN one line is printed naming task 2 and "3h left" and the last-nudge time is updated

### Requirement: Day off
The system SHALL let the user mark today as off with `/today:off` (optional reason). For the rest of that calendar day no nudges, session-start lines, or notifications are produced, the statusline shows "off today", and the day is treated as a non-work day for the streak. `/today:on` reverses it. The flag never carries into the next day.

#### Scenario: Off silences everything
- WHEN the user runs `/today:off training` and then submits prompts inside work hours
- THEN no nudge is printed and the statusline shows "off today · training"

#### Scenario: Off does not touch the streak
- WHEN a day marked off ends with tasks undone
- THEN the streak is unchanged and history records the day with `off: true`

#### Scenario: Back on
- WHEN the user runs `/today:on` after `/today:off`
- THEN nudges resume under the normal rules for the rest of the day

#### Scenario: Off expires
- WHEN the next day starts
- THEN the off flag is cleared without user action

### Requirement: Statusline line
The system SHALL provide a statusline command that prints the one-line summary from `daily-plan` and exits 0 even when state is missing or corrupt.

#### Scenario: Missing state
- WHEN no state file exists
- THEN the statusline prints a short "no plan" line and exits 0

### Requirement: Off-session notifications (opt-in)
The system SHALL offer `today daemon install` which registers a user-level scheduled job (launchd on macOS, systemd user timer on Linux) that runs the nudge check every `nudgeEveryMinutes` and sends a native notification when a nudge is due. `today daemon remove` unregisters it. Nothing is installed without the user running install.

#### Scenario: Install on macOS
- WHEN the user runs `today daemon install` on macOS
- THEN a LaunchAgent plist is written under the user's LaunchAgents and loaded, and the command reports what it did

#### Scenario: Remove
- WHEN the user runs `today daemon remove`
- THEN the job is unloaded and its file deleted

#### Scenario: Job names
- WHEN the user runs `today daemon install` with `TODAY_DAEMON_DIR` set to a temp dir
- THEN the files written are `dev.today.nudge.plist` on macOS, or `today-nudge.service` and `today-nudge.timer` on Linux, and a set `TODAY_HOME` is passed to the job as `TODAY_HOME`

#### Scenario: Notification tool missing
- WHEN a nudge is due with `--notify` and no notification tool is available
- THEN the nudge is printed to stdout and no error is raised

### Requirement: Hooks never break a session
Every hook entry point SHALL exit 0 and print nothing on any internal failure.

#### Scenario: Corrupt state during hook
- WHEN the state file is invalid JSON and a hook runs
- THEN the hook prints nothing and exits 0

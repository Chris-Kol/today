# daily-plan Specification

## Purpose
Let the user name the few things that must get done today, keep that list visible and editable across every session and repo, and roll it over cleanly at the start of each new day.

## Requirements

### Requirement: Plan today
The system SHALL let the user create today's plan of 1 to `maxTasks` tasks, each with free text and a category chosen from the configured category list. The plan is global (not per repo) and persists across sessions.

#### Scenario: First plan of the day
- WHEN the user runs `/today:plan` and no plan exists for today
- THEN the system asks for up to `maxTasks` tasks with a category each, saves them, and shows the list with the creature and streak

#### Scenario: Carried tasks count as a plan
- WHEN today's list holds only tasks carried from an earlier day
- THEN the day counts as planned: no "no plan" line at session start, and `/today:plan` shows the list and offers to add more rather than asking for a plan

#### Scenario: Plan already exists
- WHEN the user runs `/today:plan` and a plan exists for today
- THEN the system shows today's list without asking again

#### Scenario: Too many tasks
- WHEN the user tries to add a task and the list already holds `maxTasks` tasks
- THEN the system refuses with a one-line message and the list is unchanged

#### Scenario: Unknown category
- WHEN the user gives a category not in the configured list
- THEN the system rejects it and shows the allowed categories

### Requirement: Edit today's list
The system SHALL let the user walk today's list and, per task, keep it, throw it away, or edit its text or category.

#### Scenario: Throw a task
- WHEN the user throws task 2 of 3
- THEN task 2 is removed, remaining tasks are renumbered, and history is not affected

#### Scenario: Edit text
- WHEN the user edits the text of a task
- THEN the new text is saved and the task keeps its done/category state

### Requirement: Day rollover
The system SHALL detect the first read on a new calendar day (local time) and roll over: the last planned day's tasks and outcome are appended to history, done tasks are dropped, undone tasks carry to the next work day marked as carried (when `carryOver` is on, the default), and the streak is updated per `streak-and-creature`. Non-work days hold carried tasks without showing a plan and without writing a history line. A day marked off writes one history line with `off: true` and its tasks, and is otherwise treated like a non-work day.

#### Scenario: Friday carries to Monday
- WHEN Friday ends with task B undone, Saturday and Sunday are not work days, and the next read is on Monday
- THEN Monday's list starts with B marked carried, history has one line for Friday and none for the weekend

#### Scenario: Weekend read shows no plan
- WHEN the user opens a session on Saturday with B carried from Friday
- THEN the statusline shows "off today" and no nudge is printed; B is not lost

#### Scenario: Carry-over disabled
- WHEN `carryOver` is false and yesterday ended with B undone
- THEN today's list starts empty and history records B as undone

#### Scenario: Partial completion carries over
- WHEN yesterday had tasks A (done) and B (undone) and today is a new day
- THEN today's list starts with B marked carried, A is in history, and history records yesterday as not all done

#### Scenario: Carried tasks count toward the limit
- WHEN 2 tasks carry over and `maxTasks` is 3
- THEN the user can add only 1 more task today

#### Scenario: Rollover happens once
- WHEN the system reads state several times on the same new day
- THEN history receives exactly one line for yesterday

#### Scenario: No plan yesterday
- WHEN yesterday had no tasks
- THEN nothing is appended to history; the streak follows `streak-and-creature` (a work day with no plan resets it, a non-work day leaves it)

### Requirement: Status line summary
The system SHALL produce a one-line summary of today (creature glyph, each task with done marker and truncated text, streak) no longer than 80 characters.

#### Scenario: Long task text
- WHEN a task's text is longer than fits
- THEN the text is truncated with an ellipsis and the whole line stays within 80 characters

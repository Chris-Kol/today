# reward Specification

## Purpose
Make finishing feel good: a small, fast, geeky reward on each task and a bigger one when the day is complete.

## Requirements

### Requirement: Mark done
The system SHALL let the user mark task N done. With no N and exactly one open task, that task is marked. With no N and several open tasks, the system asks which.

#### Scenario: Done by number
- WHEN the user runs `/today:done 2` and task 2 is open
- THEN task 2 is marked done with a timestamp

#### Scenario: Already done
- WHEN the user runs `/today:done 2` and task 2 is already done
- THEN the system says so in one line and changes nothing

#### Scenario: Only one open
- WHEN the user runs `/today:done` with one open task
- THEN that task is marked done

### Requirement: Task reward
On marking a task done the system SHALL play a short terminal animation (about 2 seconds, ASCII, no external tools) followed by the updated list. The animation SHALL be skippable via config or a `--quiet` flag; quiet skips every animation, including the all-done celebration, while the text lines still print.

#### Scenario: Quiet mode
- WHEN `--quiet` is passed
- THEN no animation plays and only the updated list is printed

### Requirement: All-done celebration
When the last open task is marked done the system SHALL play a longer celebration, show the creature, and state what the streak will be once the day rolls over.

#### Scenario: Last task
- WHEN the final open task is marked done
- THEN the celebration plays (unless quiet), the creature is shown, and one line states the streak the day will earn at rollover, e.g. "All done. Streak will be 5 tomorrow."

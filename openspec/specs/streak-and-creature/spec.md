# streak-and-creature Specification

## Purpose
Turn "did I finish what I said I would" into a streak the user wants to protect, shown as a creature that grows with the streak and never punishes harder than one step back.

## Requirements

### Requirement: Streak counting
The system SHALL keep a current streak and a best streak. A work day where every task is done increments the streak; a work day with a plan where any task is undone resets the streak to 0. Days without a plan on a work day also reset the streak to 0. Days outside the configured work days never change the streak.

#### Scenario: All done increments
- WHEN a work day ends with all tasks done
- THEN the streak increases by 1 and best streak is updated if exceeded

#### Scenario: One undone resets
- WHEN a work day ends with one task undone
- THEN the streak becomes 0

#### Scenario: Weekend is skipped
- WHEN Friday ended with all done and the next read is on Monday with Saturday and Sunday outside work days
- THEN the streak is unchanged by the weekend and Monday counts as the next work day

#### Scenario: Day off is not a work day
- WHEN a work day was marked off with `/today:off`
- THEN it neither increments nor resets the streak

#### Scenario: Missed work day with no plan
- WHEN a work day passes with no plan at all
- THEN the streak becomes 0

### Requirement: Creature stages
The system SHALL map the streak to a creature stage using ascending thresholds (default `[0, 3, 7, 14, 30, 60]`). A reset is the moment the streak goes from above 0 to 0; further bad days while the streak is already 0 are not resets. On a reset the stage drops by exactly one, never below stage 0. When the streak later reaches a higher threshold the stage rises to match.

#### Scenario: Reaching a threshold
- WHEN the streak goes from 6 to 7
- THEN the creature moves from stage 1 to stage 2

#### Scenario: Reset drops one stage
- WHEN the creature is at stage 3 and the streak resets to 0
- THEN the creature is at stage 2

#### Scenario: Reset at stage 0
- WHEN the creature is at stage 0 and the streak resets
- THEN the creature stays at stage 0

#### Scenario: Bad days at zero cost nothing more
- WHEN the streak is already 0 and another work day ends with tasks undone
- THEN the stage is unchanged and no reset message is shown

#### Scenario: Stage cannot regress except on reset
- WHEN the stage is 2 after a reset and the streak is 1
- THEN the stage stays 2 until the streak reaches the stage 3 threshold

### Requirement: Creature display
The system SHALL provide for each stage a name, a one-character glyph for the statusline, and a small multi-line ASCII form for full displays. Streak messages never shame the user.

#### Scenario: Streak reset message
- WHEN the streak resets
- THEN the message states the reset and the new stage in a neutral or playful tone with no blame wording

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, updateStreak, stageFor, rollover } from '../src/core.mjs';
import { stages, resetMessage } from '../src/creature.mjs';
import { analyze } from '../scripts/voice-check.mjs';

const config = structuredClone(defaultConfig);
// 2026-09-18 is a Friday.
const FRI = '2026-09-18',
  SAT = '2026-09-19',
  SUN = '2026-09-20',
  MON = '2026-09-21',
  TUE = '2026-09-22',
  WED = '2026-09-23';
const done = { text: 'A', category: 'dx', done: true };
const open = { text: 'B', category: 'dx', done: false };

test('scenario: all done increments and updates best', () => {
  const s = updateStreak({ date: MON, tasks: [done], streak: 2, best: 2 }, config, MON);
  assert.equal(s.streak, 3);
  assert.equal(s.best, 3);
  assert.equal(s.stage, 1);
  assert.equal(updateStreak({ date: MON, tasks: [done], streak: 2, best: 9 }, config, MON).best, 9);
});

test('scenario: one undone resets', () => {
  const s = updateStreak({ date: MON, tasks: [done, open], streak: 5, best: 5, stage: 1 }, config, MON);
  assert.equal(s.streak, 0);
  assert.equal(s.best, 5);
});

test('scenario: weekend is skipped, Monday counts as the next work day', () => {
  let s = { date: FRI, tasks: [done], streak: 4, best: 4, stage: 1 };
  for (const day of [SAT, SUN, MON]) s = rollover(s, config, day).state;
  assert.equal(s.streak, 5);
  // A weekend day with tasks changes nothing.
  assert.equal(updateStreak({ date: SAT, tasks: [open], streak: 5 }, config, SUN).streak, 5);
  s = rollover({ ...s, tasks: [done] }, config, TUE).state;
  assert.equal(s.streak, 6);
});

test('scenario: day off is not a work day', () => {
  for (const tasks of [[open], [done], []]) {
    const s = updateStreak({ date: MON, tasks, off: 'training', streak: 4, stage: 1 }, config, MON);
    assert.equal(s.streak, 4);
    assert.equal(s.stage, 1);
  }
});

test('scenario: missed work day with no plan resets', () => {
  assert.equal(updateStreak({ date: MON, tasks: [], streak: 4 }, config, MON).streak, 0);
  // Monday all done, then Tuesday passes without any read or plan.
  assert.equal(updateStreak({ date: MON, tasks: [done], streak: 4 }, config, TUE).streak, 0);
  assert.equal(rollover({ date: MON, tasks: [done], streak: 4, best: 4 }, config, WED).state.best, 5);
});

test('scenario: reaching a threshold', () => {
  assert.equal(stageFor(6, 1, false), 1);
  assert.equal(stageFor(7, 1, false), 2);
  assert.deepEqual(
    [0, 3, 7, 14, 30, 60].map(n => stageFor(n, 0, false)),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(stageFor(500, 0, false), 5);
});

test('scenario: reset drops one stage', () => {
  assert.equal(stageFor(0, 3, true), 2);
  assert.equal(updateStreak({ date: MON, tasks: [open], streak: 20, stage: 3 }, config, MON).stage, 2);
});

test('scenario: reset at stage 0 stays at stage 0', () => {
  assert.equal(stageFor(0, 0, true), 0);
  assert.equal(updateStreak({ date: MON, tasks: [open], streak: 2, stage: 0 }, config, MON).stage, 0);
});

test('scenario: stage cannot regress except on reset', () => {
  assert.equal(stageFor(1, 2, false), 2);
  assert.equal(stageFor(13, 2, false), 2);
  assert.equal(stageFor(14, 2, false), 3);
});

test('scenario: bad days at zero cost nothing more', () => {
  const s = updateStreak({ date: MON, tasks: [open], streak: 0, stage: 2 }, config, MON);
  assert.equal(s.stage, 2);
  assert.equal(s.notices, undefined);
});

test('several resets in one rollover drop only one stage', () => {
  const s = updateStreak({ date: MON, tasks: [open], streak: 20, stage: 3 }, config, WED);
  assert.equal(s.stage, 2);
  assert.equal(s.notices.length, 1);
});

test('scenario: streak reset message is neutral and names the new stage', () => {
  const s = updateStreak({ date: MON, tasks: [open], streak: 8, stage: 2 }, config, MON);
  assert.deepEqual(s.notices, [resetMessage(1)]);
  const msg = resetMessage(1);
  assert.match(msg, /Hatchling/);
  assert.match(msg, /stage 1/);
  assert.deepEqual(analyze(msg).hard, [], msg);
  for (const line of msg.split('\n')) assert.ok(['Started', 'Meet'].includes(line.split(' ')[0]), line);
  assert.ok(!/\b(fail|failed|forgot|missed|lost|broke|broken|sorry|shame|didn't)\b|:\(/i.test(msg), msg);
  // No reset, no message: a streak already at 0 stays quiet.
  assert.equal(updateStreak({ date: MON, tasks: [open], streak: 0 }, config, MON).notices, undefined);
});

test('creature table has six stages with a one-character glyph and art', () => {
  assert.equal(stages.length, 6);
  for (const { name, glyph, art } of stages) {
    assert.ok(name.trim(), 'name');
    assert.equal([...glyph].length, 1, `${name} glyph`);
    assert.ok(art.length > 0 && art.every(l => typeof l === 'string') && art.some(l => l.trim()), `${name} art`);
  }
});

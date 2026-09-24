import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, rollover, addTask, todayView, summaryLine, isWorkDay } from '../src/core.mjs';
import { stages, resetMessage } from '../src/creature.mjs';

const config = structuredClone(defaultConfig);
// 2026-09-18 is a Friday.
const FRI = '2026-09-18',
  SAT = '2026-09-19',
  SUN = '2026-09-20',
  MON = '2026-09-21',
  TUE = '2026-09-22';
const A = { text: 'A', category: 'dx', done: true, doneAt: `${FRI}T10:00:00.000Z` };
const B = { text: 'B', category: 'company', done: false };

test('scenario: partial completion carries over', () => {
  const { state, historyLine } = rollover({ date: MON, tasks: [A, B] }, config, TUE);
  assert.equal(state.date, TUE);
  assert.deepEqual(state.tasks, [{ ...B, carried: true }]);
  assert.deepEqual(historyLine, { date: MON, tasks: [A, B], allDone: false });
});

test('all done yesterday: history says all done, list starts empty', () => {
  const { state, historyLine } = rollover({ date: MON, tasks: [A] }, config, TUE);
  assert.deepEqual(state.tasks, []);
  assert.equal(historyLine.allDone, true);
});

test('scenario: carried tasks count toward the limit', () => {
  const B2 = { ...B, text: 'B2' };
  const { state } = rollover({ date: MON, tasks: [B, B2] }, config, TUE);
  assert.equal(todayView(state, config, TUE).slots, 1);
  const one = addTask(state, config, 'C', 'dx');
  assert.equal(one.error, null);
  assert.ok(addTask(one.state, config, 'D', 'dx').error);
});

test('scenario: rollover happens once', () => {
  const first = rollover({ date: MON, tasks: [A, B] }, config, TUE);
  assert.ok(first.historyLine);
  for (let i = 0; i < 3; i++) {
    const again = rollover(first.state, config, TUE);
    assert.equal(again.historyLine, null);
    assert.equal(again.state, first.state);
  }
});

test('scenario: no plan yesterday writes no history, a work day with no plan resets the streak', () => {
  const { state, historyLine } = rollover({ date: MON, tasks: [], streak: 4, best: 4, stage: 1 }, config, TUE);
  assert.equal(historyLine, null);
  assert.deepEqual(state, { date: TUE, tasks: [], streak: 0, best: 4, stage: 0, notices: [resetMessage(0)] });
  // A non-work day with no plan leaves it.
  const sat = rollover({ date: SAT, tasks: [], streak: 4, best: 4, stage: 1 }, config, SUN).state;
  assert.equal(sat.streak, 4);
});

test('stage after a reset drops one, shows in the summary, and climbs back only at the next threshold', () => {
  let { state } = rollover({ date: MON, tasks: [A, B], streak: 10, best: 10, stage: 2 }, config, TUE);
  assert.equal(state.streak, 0);
  assert.equal(state.best, 10);
  assert.equal(state.stage, 1);
  assert.deepEqual(state.notices, [resetMessage(1)]);
  const v = todayView(state, config, TUE);
  assert.equal(v.stage, 1);
  assert.equal(v.glyph, stages[1].glyph);
  assert.equal(v.creature, stages[1].name);
  assert.ok(v.summary.startsWith(`${stages[1].glyph} `));
  // Two all-done days: streak 2, stage holds at 1 (no regress, no early climb).
  for (const day of ['2026-09-23', '2026-09-24']) state = rollover({ ...state, tasks: [A] }, config, day).state;
  assert.equal(state.streak, 2);
  assert.equal(state.stage, 1);
});

test('scenario: Friday carries to Monday, one history line for Friday, none for the weekend', () => {
  const lines = [];
  let s = { date: FRI, tasks: [A, B] };
  for (const day of [SAT, SAT, SUN, MON, MON]) {
    const r = rollover(s, config, day);
    if (r.historyLine) lines.push(r.historyLine);
    s = r.state;
  }
  assert.deepEqual(
    lines.map(l => l.date),
    [FRI],
  );
  assert.deepEqual(s.tasks, [{ ...B, carried: true }]);
  assert.equal(todayView(s, config, MON).workDay, true);
  // Straight from Friday to Monday gives the same result.
  const direct = rollover({ date: FRI, tasks: [A, B] }, config, MON);
  assert.deepEqual(direct.state, s);
  assert.equal(direct.historyLine.date, FRI);
});

test('scenario: weekend read holds tasks and shows off today', () => {
  const { state } = rollover({ date: FRI, tasks: [A, B] }, config, SAT);
  assert.equal(isWorkDay(SAT, config), false);
  assert.deepEqual(state.tasks, [{ ...B, carried: true }]);
  const v = todayView(state, config, SAT);
  assert.equal(v.workDay, false);
  assert.equal(v.needsPlan, false);
  assert.equal(v.summary, '@ off today · streak 0');
});

test('scenario: carry-over disabled starts empty and records B undone', () => {
  const { state, historyLine } = rollover({ date: MON, tasks: [A, B] }, { ...config, carryOver: false }, TUE);
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(
    historyLine.tasks.find(t => t.text === 'B'),
    B,
  );
  assert.equal(historyLine.allDone, false);
});

test('a day marked off writes one history line with off: true, and the flag is cleared', () => {
  const { state, historyLine } = rollover({ date: MON, tasks: [A, B], off: 'training' }, config, TUE);
  assert.deepEqual(historyLine, { date: MON, tasks: [A, B], off: true });
  assert.equal('off' in state, false);
  assert.deepEqual(state.tasks, [{ ...B, carried: true }]);
});

test('fresh state takes today, a clock that went back changes nothing', () => {
  assert.deepEqual(rollover({ date: null, tasks: [] }, config, MON), {
    state: { date: MON, tasks: [] },
    historyLine: null,
  });
  const s = { date: TUE, tasks: [B] };
  assert.equal(rollover(s, config, MON).state, s);
});

test('work days follow config, Sunday is day 7', () => {
  assert.equal(isWorkDay(SUN, config), false);
  assert.equal(isWorkDay(SUN, { ...config, workHours: { ...config.workHours, days: [7] } }), true);
  assert.equal(isWorkDay(FRI, config), true);
});

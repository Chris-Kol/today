import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, isWorkDay } from '../src/core.mjs';
import { computeStats } from '../src/stats.mjs';
import { makeHistory } from './fixtures/history.mjs';

const config = structuredClone(defaultConfig); // categories company, dx; Monday to Friday
// 2026-09-14 is a Monday.
const MON = '2026-09-14',
  TODAY = '2026-09-21';
const t = (category, done, text = 'x') => ({ text, category, done });
const line = (date, tasks, extra = {}) => JSON.stringify({ date, tasks, ...extra });
const split = jsonl => jsonl.split('\n');
const noState = { date: TODAY, tasks: [] };

// ---- 1. fixture ----

test('fixture: two calls give identical output', () => {
  const opts = { start: MON, days: 60, offEvery: 7, partialEvery: 3, noneEvery: 11 };
  assert.equal(makeHistory(opts), makeHistory(opts));
});

test('fixture: weekends have no line; every line has the v1 shape', () => {
  const lines = split(makeHistory({ start: MON, days: 28, offEvery: 5, partialEvery: 3, noneEvery: 7 })).filter(
    Boolean,
  );
  assert.equal(lines.length, 20);
  for (const l of lines) {
    const o = JSON.parse(l);
    assert.ok(isWorkDay(o.date, config), o.date);
    assert.ok(Array.isArray(o.tasks));
    assert.ok(o.off === true || typeof o.allDone === 'boolean');
    for (const x of o.tasks) {
      assert.equal(typeof x.text, 'string');
      assert.equal(typeof x.category, 'string');
      assert.equal(typeof x.done, 'boolean');
    }
  }
});

// ---- 2. stats ----

test('scenario: Mixed history', () => {
  // Mon-Wed all done, Thu partial, Fri off.
  const lines = split(makeHistory({ start: MON, days: 5, partialEvery: 4, offEvery: 5 }));
  const state = { date: TODAY, tasks: [t('dx', true), t('company', false)], streak: 0 };
  const s = computeStats(lines, state, config, TODAY);
  assert.deepEqual(s.completion, { allDone: 3, planned: 4, rate: 0.75 });
  assert.equal(s.daysOff, 1);
  // History: 3 days x 2 done + 1 partial done = 7; today adds 1 dx.
  const hist = computeStats(lines, noState, config, TODAY).categories.all;
  assert.equal(s.categories.all.dx, hist.dx + 1);
  assert.equal(s.categories.all.company, hist.company);
  assert.equal(hist.dx + hist.company, 7);
  assert.equal(s.empty, false);
  assert.equal(s.skipped, 0);
});

test('scenario: Windows', () => {
  const lines = [line('2026-09-13', [t('dx', true)]), line('2026-09-15', [t('dx', true)])];
  const s = computeStats(lines, noState, config, TODAY);
  assert.equal(s.categories.week.dx, 1); // 2026-09-15 is the first day of the 7-day window
  assert.equal(s.categories.month.dx, 2);
  assert.equal(s.categories.all.dx, 2);
  const eight = computeStats([line('2026-09-13', [t('dx', true)])], noState, config, TODAY);
  assert.deepEqual([eight.categories.week.dx, eight.categories.month.dx, eight.categories.all.dx], [0, 1, 1]);
  const old = computeStats([line('2026-08-22', [t('dx', true)])], noState, config, TODAY); // 30 days old
  assert.deepEqual([old.categories.month.dx, old.categories.all.dx], [0, 1]);
});

test('scenario: Streak comes from state', () => {
  const s = computeStats([], { ...noState, streak: 4, best: 9 }, config, TODAY);
  assert.deepEqual(s.streak, { current: 4, best: 9 });
  assert.deepEqual(computeStats([], noState, config, TODAY).streak, { current: 0, best: 0 });
  assert.deepEqual(computeStats([], { ...noState, streak: 5, best: 2 }, config, TODAY).streak, { current: 5, best: 5 });
});

test('rate is null with no planned days', () => {
  const s = computeStats([line(MON, [], { off: true })], noState, config, TODAY);
  assert.deepEqual(s.completion, { allDone: 0, planned: 0, rate: null });
});

test('empty: true with no lines, full object anyway', () => {
  const s = computeStats([], noState, config, TODAY);
  assert.equal(s.empty, true);
  assert.deepEqual(s.days, []);
  assert.deepEqual({ ...s.categories.all }, { company: 0, dx: 0 });
  assert.equal(computeStats([''], noState, config, TODAY).empty, true);
  assert.equal(computeStats(['{oops'], noState, config, TODAY).empty, true);
});

test('days: newest first, outcome per line', () => {
  const lines = [
    line('2026-09-14', [t('dx', true)]),
    line('2026-09-16', [t('dx', true), t('dx', false)]),
    line('2026-09-15', [t('dx', false)]),
    line('2026-09-17', [], { off: true }),
  ];
  const s = computeStats(lines, noState, config, TODAY);
  assert.deepEqual(
    s.days.map(d => [d.date, d.outcome]),
    [
      ['2026-09-17', 'off'],
      ['2026-09-16', 'partial'],
      ['2026-09-15', 'none'],
      ['2026-09-14', 'all'],
    ],
  );
  assert.deepEqual(s.days[1].tasks, [t('dx', true), t('dx', false)]);
});

test('scenario: One corrupt line (pure part)', () => {
  const lines = [...split(makeHistory({ start: MON, days: 5 })), '{oops'];
  const s = computeStats(lines, noState, config, TODAY);
  assert.equal(s.skipped, 1);
  assert.equal(s.days.length, 5);
  assert.equal(s.completion.planned, 5);
});

test('invalid lines are skipped and counted; blank lines are not', () => {
  const bad = [
    '{oops',
    line('2026-9-14', [t('dx', true)]),
    line('2026-13-40', [t('dx', true)]),
    JSON.stringify({ date: MON, tasks: [{ text: 'a', category: 'dx' }] }),
    JSON.stringify({ date: MON, tasks: [{ text: 1, category: 'dx', done: true }] }),
    JSON.stringify({ date: MON, tasks: [null] }),
    JSON.stringify({ date: MON }),
    'null',
    '[]',
  ];
  const s = computeStats([line(MON, [t('dx', true)]), ...bad, '', '   '], noState, config, TODAY);
  assert.equal(s.skipped, bad.length);
  assert.equal(s.days.length, 1);
  assert.equal(computeStats([line(MON, [t('dx', true)]), ''], noState, config, TODAY).skipped, 0);
});

test('two lines for one date: the later wins', () => {
  const s = computeStats([line(MON, [t('dx', false)]), line(MON, [t('company', true)])], noState, config, TODAY);
  assert.equal(s.days.length, 1);
  assert.equal(s.days[0].outcome, 'all');
  assert.deepEqual({ ...s.categories.all }, { company: 1, dx: 0 });
  assert.deepEqual(s.completion, { allDone: 1, planned: 1, rate: 1 });
});

test('a history category not in config is listed after config ones', () => {
  const s = computeStats([line(MON, [t('zzz', true), t('dx', true)])], noState, config, TODAY);
  assert.deepEqual(s.categories.names, ['company', 'dx', 'zzz']);
  assert.deepEqual(Object.keys(s.categories.week), ['company', 'dx', 'zzz']);
});

test('today off counts in days off and shows as an off day', () => {
  const s = computeStats([line(MON, [t('dx', true)])], { date: TODAY, tasks: [], off: true }, config, TODAY);
  assert.equal(s.daysOff, 1);
  assert.deepEqual(s.days[0], { date: TODAY, outcome: 'off', tasks: [], today: true });
  assert.deepEqual(s.completion, { allDone: 1, planned: 1, rate: 1 });
});

test("today's done task counts in week, month, all; today stays out of completion", () => {
  const state = { date: TODAY, tasks: [t('dx', true)] };
  const s = computeStats([line(MON, [t('dx', false)])], state, config, TODAY);
  assert.deepEqual([s.categories.week.dx, s.categories.month.dx, s.categories.all.dx], [1, 1, 1]);
  assert.deepEqual(s.completion, { allDone: 0, planned: 1, rate: 0 });
  assert.deepEqual(s.days[0], { date: TODAY, outcome: 'all', tasks: [t('dx', true)], today: true });
  assert.equal(s.empty, false);
});

test('today with no tasks and not off is not a day', () => {
  assert.deepEqual(computeStats([line(MON, [t('dx', true)])], noState, config, TODAY).days.length, 1);
});

test("today's state wins over a history line with today's date", () => {
  const s = computeStats([line(TODAY, [t('dx', false)])], { date: TODAY, tasks: [t('dx', true)] }, config, TODAY);
  assert.equal(s.days.length, 1);
  assert.equal(s.days[0].outcome, 'all');
  assert.equal(s.categories.all.dx, 1);
  assert.equal(s.completion.planned, 0);
});

test('scenario: Today on a non-work day', () => {
  const SAT = '2026-09-26';
  const state = { date: SAT, tasks: [t('dx', true), t('dx', false, 'c')] };
  const s = computeStats([line(MON, [t('dx', true)])], state, config, SAT);
  assert.deepEqual(
    s.days.map(d => d.date),
    [MON],
  );
  assert.deepEqual([s.categories.week.dx, s.categories.month.dx, s.categories.all.dx], [0, 1, 1]);
  const off = computeStats([], { date: SAT, tasks: [], off: true }, config, SAT);
  assert.deepEqual([off.days.length, off.days[0]?.outcome, off.daysOff], [1, 'off', 1]);
});

test('window edges: today-7 is out of the week, today-29 in the month, today-30 out', () => {
  const at = d => computeStats([line(d, [t('dx', true)])], noState, config, TODAY).categories;
  const row = c => [c.week.dx, c.month.dx, c.all.dx];
  assert.deepEqual(row(at('2026-09-14')), [0, 1, 1]); // today-7
  assert.deepEqual(row(at('2026-08-23')), [0, 1, 1]); // today-29
  assert.deepEqual(row(at('2026-08-22')), [0, 0, 1]); // today-30
});

test('odd category names count as numbers; config first, then others alphabetically', () => {
  const names = ['toString', '2026', '__proto__', 'constructor'];
  const s = computeStats(
    [
      line(
        MON,
        names.map(n => t(n, true)),
      ),
    ],
    noState,
    config,
    TODAY,
  );
  const order = ['company', 'dx', '2026', '__proto__', 'constructor', 'toString'];
  assert.deepEqual(s.categories.names, order);
  for (const n of names)
    assert.deepEqual([s.categories.week[n], s.categories.month[n], s.categories.all[n]], [0, 1, 1]);
  assert.equal(JSON.parse(JSON.stringify(s)).categories.all.constructor, 1);
});

test('history-only categories sort case-insensitively after config ones', () => {
  const s = computeStats([line(MON, [t('Zeta', true), t('alpha', true)])], noState, config, TODAY);
  assert.deepEqual(s.categories.names, ['company', 'dx', 'alpha', 'Zeta']);
});

test('control characters are cleaned from history text and category', () => {
  const s = computeStats([line(MON, [t('\u001b[31mx', true, 'a\u0007\nb')])], noState, config, TODAY);
  assert.deepEqual(s.categories.names, ['company', 'dx', '[31mx']);
  assert.equal(s.days[0].tasks[0].text, 'a b');
});

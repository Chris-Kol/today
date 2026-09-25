import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markDone } from '../src/core.mjs';

const AT = '2026-09-24T10:00:00.000Z';
const task = (text, done = false) => ({ text, category: 'dx', done });
const day = (...tasks) => ({ date: '2026-09-24', tasks });

test('scenario: done by number marks it done with a timestamp', () => {
  const state = day(task('a'), task('b'), task('c'));
  const r = markDone(state, 2, AT);
  assert.equal(r.error, null);
  assert.equal(r.allDone, false);
  assert.deepEqual(r.state.tasks[1], { ...task('b', true), doneAt: AT });
  assert.equal(r.state.tasks[0].done, false);
  assert.equal(state.tasks[1].done, false); // input untouched
});

test('scenario: already done says so in one line and changes nothing', () => {
  const state = day(task('a'), { ...task('b', true), doneAt: 'earlier' });
  const r = markDone(state, 2, AT);
  assert.equal(r.state, state);
  assert.equal(r.allDone, false);
  assert.equal(r.error, 'Marked done earlier: b.');
  assert.doesNotMatch(r.error, /\n/);
});

test('scenario: only one open, no number marks that one', () => {
  const r = markDone(day(task('a', true), task('b')), null, AT);
  assert.equal(r.error, null);
  assert.equal(r.state.tasks[1].done, true);
  assert.equal(r.state.tasks[1].doneAt, AT);
});

test('ambiguous: no number with several open asks which, changes nothing', () => {
  const state = day(task('a'), task('b', true), task('c'));
  const r = markDone(state, null, AT);
  assert.equal(r.state, state);
  assert.equal(r.allDone, false);
  assert.equal(r.error, 'Pick which must-do is done: 1 or 3.\nRun today done <n>.');
});

test('last open task sets allDone', () => {
  const r = markDone(day(task('a', true), task('b')), 2, AT);
  assert.equal(r.allDone, true);
  assert.equal(markDone(day(task('a'), task('b')), 1, AT).allDone, false);
});

test('unknown number, nothing open, or no plan: error, state unchanged', () => {
  const state = day(task('a', true));
  assert.equal(markDone(state, 9, AT).error, "Can't find must-do 9.");
  assert.equal(markDone(state, 'x', AT).error, "Can't find must-do x.");
  assert.equal(markDone(state, null, AT).error, 'Finished every must-do already.');
  const empty = day();
  const r = markDone(empty, null, AT);
  assert.equal(r.state, empty);
  assert.equal(r.error, 'Add your must-dos first: today plan.');
});

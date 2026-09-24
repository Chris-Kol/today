import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, addTask, editList, summaryLine, todayView } from '../src/core.mjs';

const config = structuredClone(defaultConfig);
const MON = '2026-09-21';
const task = (text, extra = {}) => ({ text, category: 'dx', done: false, ...extra });
const plan = (...texts) => ({ date: MON, tasks: texts.map(t => task(t)) });

test('addTask saves text and category, trims whitespace', () => {
  const { state, error } = addTask(plan(), config, '  fix\nlogin  ', 'company');
  assert.equal(error, null);
  assert.deepEqual(state.tasks, [{ text: 'fix login', category: 'company', done: false }]);
});

test('addTask rejects empty text', () => {
  const s = plan();
  const r = addTask(s, config, '  ', 'dx');
  assert.equal(r.state, s);
  assert.ok(r.error);
});

test('scenario: first plan of the day asks, plan already exists does not', () => {
  assert.equal(todayView(plan(), config, MON).needsPlan, true);
  const v = todayView(plan('a'), config, MON);
  assert.equal(v.needsPlan, false);
  assert.deepEqual(
    v.tasks.map(t => t.n),
    [1],
  );
});

test('scenario: carried tasks count as a plan', () => {
  const v = todayView({ date: MON, tasks: [task('a', { carried: true })] }, config, MON);
  assert.equal(v.needsPlan, false);
  assert.equal(v.slots, 2);
});

test('scenario: too many tasks refuses with one line, list unchanged', () => {
  const s = plan('a', 'b', 'c');
  const r = addTask(s, config, 'd', 'dx');
  assert.equal(r.state, s);
  assert.equal(r.error, "Can't add more than 3 must-dos a day.");
});

test('scenario: unknown category is rejected and allowed ones shown', () => {
  const s = plan();
  const r = addTask(s, config, 'x', 'fun');
  assert.equal(r.state, s);
  assert.equal(r.error, "Can't use category fun.\nPick one of these: company, dx.");
});

test('scenario: throw task 2 of 3 renumbers the rest', () => {
  const { state, error } = editList(plan('a', 'b', 'c'), [{ n: 2, op: 'throw' }], config);
  assert.equal(error, null);
  assert.deepEqual(
    state.tasks.map(t => t.text),
    ['a', 'c'],
  );
  assert.deepEqual(
    todayView(state, config, MON).tasks.map(t => t.n),
    [1, 2],
  );
});

test('scenario: edit text keeps done and category', () => {
  const s = { date: MON, tasks: [task('a', { done: true, category: 'company', carried: true })] };
  const { state } = editList(s, [{ n: 1, op: 'edit', text: 'new a' }], config);
  assert.deepEqual(state.tasks, [{ text: 'new a', category: 'company', done: true, carried: true }]);
});

test('edit category, keep, and several ops use the numbers shown before the edit', () => {
  const { state } = editList(
    plan('a', 'b', 'c'),
    [
      { n: 1, op: 'throw' },
      { n: 2, op: 'keep' },
      { n: 3, op: 'edit', category: 'company' },
    ],
    config,
  );
  assert.deepEqual(state.tasks, [task('b'), task('c', { category: 'company' })]);
});

test('editList rejects a bad number, unknown category, or empty text and changes nothing', () => {
  const s = plan('a');
  for (const ops of [
    [{ n: 2, op: 'throw' }],
    [{ n: 1, op: 'edit', category: 'fun' }],
    [{ n: 1, op: 'edit', text: ' ' }],
    [{ n: 1, op: 'burn' }],
  ]) {
    const r = editList(s, ops, config);
    assert.equal(r.state, s, JSON.stringify(ops));
    assert.ok(r.error);
  }
});

test('scenario: long task text is truncated with an ellipsis, line within 80', () => {
  const s = { date: MON, streak: 12, tasks: [task('x'.repeat(200), { done: true }), task('short')] };
  const line = summaryLine(s, 0, 80);
  assert.ok(line.length <= 80, line);
  assert.match(line, /x+… · ○ short · streak 12$/);
  assert.match(line, /^@ ✓ x/);
});

test('summaryLine fits many long tasks, then drops the list before creature and streak', () => {
  const s = {
    date: MON,
    streak: 3,
    tasks: [task('a'.repeat(90)), task('b'.repeat(90), { done: true }), task('c'.repeat(90))],
  };
  const full = summaryLine(s, 0, 80);
  assert.ok(full.length <= 80 && full.length >= 78, full);
  assert.equal((full.match(/…/g) || []).length, 3);
  const narrow = summaryLine(s, 0, 30);
  assert.ok(narrow.length <= 30, narrow);
  assert.equal(narrow, '@ 1/3 done · streak 3');
  assert.match(summaryLine(s, 0, 12), /^@ .* streak 3$/);
});

test('summaryLine shows short lines whole, no plan, and off today', () => {
  assert.equal(summaryLine(plan('ship'), 0, 80), '@ ○ ship · streak 0');
  assert.equal(summaryLine(plan(), 0, 80), '@ plan your must-dos: /today:plan · streak 0');
  assert.equal(summaryLine(plan('ship'), 0, 80, true), '@ off today · streak 0');
  assert.equal(summaryLine(plan(), 0, 80, 'training'), '@ off today · training · streak 0');
});

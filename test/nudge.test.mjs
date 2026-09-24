import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, nudge, sessionStart } from '../src/core.mjs';
import { analyze } from '../scripts/voice-check.mjs';

const config = structuredClone(defaultConfig); // 09:00-18:00, Monday to Friday, every 45 minutes
// 2026-09-24 is a Thursday, 2026-09-26 a Saturday. Local time, like io's clock.
const THU = '2026-09-24',
  SAT = '2026-09-26';
const at = (date, hh, mm = 0) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm);
};
const minsAgo = (now, n) => new Date(now - n * 6e4).toISOString();
const task = (text, done = false) => ({ text, category: 'dx', done });
const day = (tasks, extra = {}, date = THU) => ({ date, tasks, ...extra });

test('scenario: rate limited, a nudge 10 minutes ago prints nothing', () => {
  const now = at(THU, 15);
  const state = day([task('a')], { lastNudgeAt: minsAgo(now, 10) });
  const r = nudge(state, config, now);
  assert.equal(r.line, null);
  assert.equal(r.state, state);
});

test('scenario: outside work hours prints nothing, before and after', () => {
  for (const now of [at(THU, 20), at(THU, 18), at(THU, 8, 59)]) {
    assert.equal(nudge(day([task('a')]), config, now).line, null, String(now));
  }
});

test('weekend prints nothing', () => {
  assert.equal(nudge(day([task('a')], {}, SAT), config, at(SAT, 15)).line, null);
});

test('scenario: all done prints nothing', () => {
  assert.equal(nudge(day([task('a', true), task('b', true)]), config, at(THU, 15)).line, null);
  assert.equal(nudge(day([]), config, at(THU, 15)).line, null);
});

test('a day off prints nothing', () => {
  assert.equal(nudge(day([task('a')], { off: 'training' }), config, at(THU, 15)).line, null);
  assert.equal(nudge(day([task('a')], { off: true }), config, at(THU, 15)).line, null);
});

test('scenario: due nudge names task 2 and 3h left, and updates lastNudgeAt', () => {
  const now = at(THU, 15);
  const state = day([task('ship login', true), task('write memo')], { lastNudgeAt: minsAgo(now, 50) });
  const r = nudge(state, config, now);
  assert.equal(r.line, "Finish today's must-dos: 2. write memo · 3h left");
  assert.equal(r.state.lastNudgeAt, now.toISOString());
  assert.equal(state.lastNudgeAt, minsAgo(now, 50)); // input untouched
});

test('first nudge of the day is due; the last hour counts minutes', () => {
  const r = nudge(day([task('a'), task('b')]), config, at(THU, 17, 30));
  assert.equal(r.line, "Finish today's must-dos: 1. a · 2. b · 30m left");
});

test('time left rounds down to whole hours: 15:10 shows 2h left', () => {
  assert.match(nudge(day([task('a')]), config, at(THU, 15, 10)).line, / · 2h left$/);
});

test('a lastNudgeAt in the future does not silence nudges', () => {
  assert.notEqual(nudge(day([task('a')], { lastNudgeAt: '2099-01-01T00:00:00Z' }), config, at(THU, 15)).line, null);
});

test('scenario: carried tasks count as a plan at session start', () => {
  const r = sessionStart(day([{ ...task('b'), carried: true }]), THU, config);
  assert.equal(r.line, "Finish today's must-dos: 1. b");
});

test('nudgeEveryMinutes from config sets the limit', () => {
  const now = at(THU, 15);
  const state = day([task('a')], { lastNudgeAt: minsAgo(now, 20) });
  assert.equal(nudge(state, { ...config, nudgeEveryMinutes: 15 }, now).line !== null, true);
  assert.equal(nudge(state, { ...config, nudgeEveryMinutes: 20 }, now).line !== null, true);
  assert.equal(nudge(state, { ...config, nudgeEveryMinutes: 21 }, now).line, null);
});

test('scenario: no plan yet, first session says to run /today:plan, second says nothing', () => {
  const first = sessionStart(day([]), THU, config);
  assert.equal(first.line, 'Pick your must-dos with /today:plan.');
  assert.equal(first.state.sessionStartShown, THU);
  const second = sessionStart(first.state, THU, config);
  assert.equal(second.line, null);
  assert.equal(second.state, first.state);
});

test('no-plan line shown yesterday shows again today', () => {
  assert.notEqual(sessionStart(day([], { sessionStartShown: '2026-09-23' }), THU, config).line, null);
});

test('scenario: plan exists, each session lists the open tasks', () => {
  const state = day([task('a', true), { ...task('b'), carried: true }]);
  for (let i = 0; i < 2; i++) {
    const r = sessionStart(state, THU, config);
    assert.equal(r.line, "Finish today's must-dos: 2. b");
    assert.equal(r.state, state);
  }
});

test('session start says nothing when all done, on a day off, or on a non-work day', () => {
  assert.equal(sessionStart(day([task('a', true)]), THU, config).line, null);
  assert.equal(sessionStart(day([], { off: true }), THU, config).line, null);
  assert.equal(sessionStart(day([task('a')], { off: 'sick' }), THU, config).line, null);
  assert.equal(sessionStart(day([task('a')], {}, SAT), SAT, config).line, null);
});

test('nudge and session start lines pass voice-check and start with a verb', () => {
  const lines = [
    nudge(day([task('a'), task('b')]), config, at(THU, 15)).line,
    sessionStart(day([]), THU, config).line,
    sessionStart(day([task('a')]), THU, config).line,
  ];
  for (const line of lines) {
    assert.deepEqual(analyze(line).hard, [], line);
    assert.match(line, /^(Finish|Pick) /);
  }
});

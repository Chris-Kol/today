import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, normalizeConfig } from '../src/core.mjs';

test('empty config uses every default', () => {
  for (const raw of [undefined, null, {}]) {
    const { config, warnings } = normalizeConfig(raw);
    assert.deepEqual(config, defaultConfig);
    assert.deepEqual(warnings, []);
  }
  assert.deepEqual(defaultConfig, {
    categories: ['company', 'dx'],
    workHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    nudgeEveryMinutes: 45,
    maxTasks: 3,
    quiet: false,
    carryOver: true,
  });
});

test('scenario: invalid value falls back for that key only, one warning', () => {
  const { config, warnings } = normalizeConfig({ maxTasks: 'lots', quiet: true, categories: ['work'] });
  assert.equal(config.maxTasks, 3);
  assert.equal(config.quiet, true);
  assert.deepEqual(config.categories, ['work']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Ignored maxTasks/);
  assert.ok(!warnings[0].includes('\n'));
});

test('invalid work hours fall back to default work hours', () => {
  for (const workHours of [
    { start: '9am' },
    { start: '18:00', end: '09:00' },
    { days: [0, 8] },
    { days: [] },
    'weekdays',
  ]) {
    const { config, warnings } = normalizeConfig({ workHours });
    assert.deepEqual(config.workHours, defaultConfig.workHours, JSON.stringify(workHours));
    assert.equal(warnings.length, 1);
  }
});

test('partial work hours keep defaults for missing parts', () => {
  const { config, warnings } = normalizeConfig({ workHours: { start: '10:00' } });
  assert.deepEqual(config.workHours, { start: '10:00', end: '18:00', days: [1, 2, 3, 4, 5] });
  assert.deepEqual(warnings, []);
});

test('each key rejects bad values', () => {
  const bad = { categories: [], nudgeEveryMinutes: 0, maxTasks: 0, quiet: 'yes', carryOver: 1 };
  const { config, warnings } = normalizeConfig(bad);
  assert.deepEqual(config, defaultConfig);
  assert.equal(warnings.length, 5);
  assert.equal(normalizeConfig({ nudgeEveryMinutes: 1.5 }).warnings.length, 1);
  assert.equal(normalizeConfig({ categories: ['ok', ''] }).warnings.length, 1);
});

test('nudgeEveryMinutes above a day is capped at 1440, so the plist integer stays sane', () => {
  for (const v of [1441, 1e21]) {
    const { config, warnings } = normalizeConfig({ nudgeEveryMinutes: v });
    assert.equal(config.nudgeEveryMinutes, 1440, String(v));
    assert.deepEqual(warnings, ['Ignored nudgeEveryMinutes in config.json. Using a nudge every 1440 minutes.']);
  }
  assert.deepEqual(normalizeConfig({ nudgeEveryMinutes: 1440 }), {
    config: { ...defaultConfig, nudgeEveryMinutes: 1440 },
    warnings: [],
  });
  assert.equal(normalizeConfig({ nudgeEveryMinutes: 1 }).config.nudgeEveryMinutes, 1);
});

test('maxTasks has no upper bound: any integer >= 1 is accepted', () => {
  const { config, warnings } = normalizeConfig({ maxTasks: 12 });
  assert.equal(config.maxTasks, 12);
  assert.deepEqual(warnings, []);
});

test('maxTasks rejects 0, non-integers, and non-numbers', () => {
  for (const v of [0, 1.5, 'lots']) {
    const { config, warnings } = normalizeConfig({ maxTasks: v });
    assert.equal(config.maxTasks, defaultConfig.maxTasks, String(v));
    assert.equal(warnings.length, 1, String(v));
    assert.match(warnings[0], /^Ignored maxTasks/);
  }
});

test('non-object config uses defaults with one warning', () => {
  const { config, warnings } = normalizeConfig([1, 2]);
  assert.deepEqual(config, defaultConfig);
  assert.equal(warnings.length, 1);
});

test('warnings state the default in plain words, no JSON', () => {
  const { warnings } = normalizeConfig({
    categories: [],
    workHours: { start: '19:00' },
    nudgeEveryMinutes: 0,
    maxTasks: 0,
    quiet: 'yes',
    carryOver: 1,
  });
  assert.deepEqual(warnings, [
    'Ignored categories in config.json. Using company, dx.',
    'Ignored workHours in config.json. Using 09:00 to 18:00, Monday to Friday.',
    'Ignored nudgeEveryMinutes in config.json. Using a nudge every 45 minutes.',
    'Ignored maxTasks in config.json. Using up to 3 must-dos.',
    'Ignored quiet in config.json. Using the done animation.',
    'Ignored carryOver in config.json. Using carry-over for unfinished must-dos.',
  ]);
});

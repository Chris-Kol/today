import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { home, readConfig, readState, writeState, appendHistory, hasTool } from '../src/io.mjs';
import { defaultConfig, emptyState } from '../src/core.mjs';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-'));
  process.env.TODAY_HOME = dir;
});

test('home() honors TODAY_HOME, else ~/.today', () => {
  assert.equal(home(), dir);
  delete process.env.TODAY_HOME;
  assert.equal(home(), path.join(os.homedir(), '.today'));
});

test('scenario: no config file uses defaults and creates nothing', () => {
  const { config, warnings, found } = readConfig();
  assert.deepEqual(config, defaultConfig);
  assert.deepEqual(warnings, []);
  assert.equal(found, false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('config file is read and normalized', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ maxTasks: 'lots', quiet: true }));
  const { config, warnings, found } = readConfig();
  assert.equal(found, true);
  assert.equal(config.quiet, true);
  assert.equal(config.maxTasks, 3);
  assert.equal(warnings.length, 1);
});

test('unparseable config uses defaults with one warning', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), '{ nope');
  const { config, warnings } = readConfig();
  assert.deepEqual(config, defaultConfig);
  assert.equal(warnings.length, 1);
});

test('fresh start: no state file gives empty state, no notice, no file', () => {
  assert.deepEqual(readState(), { state: emptyState(), notice: null });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('state round trip', () => {
  const s = { date: '2026-09-24', tasks: [{ text: 'ship', category: 'dx', done: false }] };
  writeState(s);
  assert.deepEqual(readState(), { state: s, notice: null });
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('scenario: corrupt state moves aside, starts fresh, one-line notice once', () => {
  fs.writeFileSync(path.join(dir, 'state.json'), '{ broken');
  const now = new Date('2026-09-24T10:11:12.345Z');
  const { state, notice } = readState(now);
  const bak = 'state.json.bak-2026-09-24T10-11-12-345Z';
  assert.equal(fs.readFileSync(path.join(dir, bak), 'utf8'), '{ broken');
  assert.equal(notice, `Moved your unreadable plan to ${path.join(dir, bak)}.`);
  assert.ok(!notice.includes('\n'));
  // Fresh state keeps the notice waiting for the next command the user runs; the file is not moved again.
  assert.deepEqual(state, { ...emptyState(), notices: [notice] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), state);
  assert.deepEqual(readState(), { state, notice: null });
});

test('valid JSON with the wrong shape counts as corrupt', () => {
  fs.writeFileSync(path.join(dir, 'state.json'), '[1,2]');
  assert.ok(readState().notice);
  assert.equal(fs.readdirSync(dir).filter(f => f.startsWith('state.json.bak-')).length, 1);
});

test('history is append-only', () => {
  fs.writeFileSync(path.join(dir, 'history.jsonl'), '{"date":"2026-09-22"}\n');
  appendHistory({ date: '2026-09-23' });
  appendHistory({ date: '2026-09-24' });
  const lines = fs
    .readFileSync(path.join(dir, 'history.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l).date);
  assert.deepEqual(lines, ['2026-09-22', '2026-09-23', '2026-09-24']);
});

test('writeState creates TODAY_HOME when missing', () => {
  process.env.TODAY_HOME = path.join(dir, 'nested', 'home');
  writeState(emptyState());
  assert.deepEqual(readState().state, emptyState());
});

test('corrupt state that cannot be moved: says so, claims no backup, starts fresh', {
  skip: process.getuid?.() === 0,
}, () => {
  const p = path.join(dir, 'state.json');
  fs.writeFileSync(p, '{ broken');
  fs.chmodSync(dir, 0o555);
  try {
    const { state, notice } = readState();
    assert.deepEqual(state, emptyState());
    assert.equal(notice, "Can't read your plan.\nStarted fresh for now.");
    assert.deepEqual(fs.readdirSync(dir), ['state.json']);
    assert.equal(fs.readFileSync(p, 'utf8'), '{ broken');
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('a second corrupt move in the same millisecond keeps both backups', () => {
  const now = new Date('2026-09-24T10:11:12.345Z');
  for (const text of ['first', 'second']) {
    fs.writeFileSync(path.join(dir, 'state.json'), text);
    assert.ok(readState(now).notice);
  }
  const baks = fs
    .readdirSync(dir)
    .filter(f => f.startsWith('state.json.bak-'))
    .sort();
  assert.deepEqual(baks.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).sort(), ['first', 'second']);
});

test('hasTool skips empty PATH entries and directories', () => {
  const cwd = process.cwd();
  const oldPath = process.env.PATH;
  fs.writeFileSync(path.join(dir, 'fake'), '', { mode: 0o755 });
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.mkdirSync(path.join(dir, 'bin', 'gh'));
  process.chdir(dir);
  try {
    process.env.PATH = `${path.delimiter}${path.join(dir, 'bin')}`;
    assert.equal(hasTool('fake'), false);
    assert.equal(hasTool('gh'), false);
  } finally {
    process.chdir(cwd);
    process.env.PATH = oldPath;
  }
});

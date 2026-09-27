import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../scripts/voice-check.mjs';
import { addDays, localDate, normalizeConfig } from '../src/core.mjs';
import { computeStats } from '../src/stats.mjs';
import { makeHistory } from './fixtures/history.mjs';

const bin = fileURLToPath(new URL('../bin/today.mjs', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));
const today = localDate(new Date());
const state = {
  date: today,
  tasks: [
    { text: 'ship it', category: 'dx', done: true },
    { text: 'write memo', category: 'company', done: false },
  ],
  streak: 4,
  best: 9,
};
const fixture = () =>
  makeHistory({ start: addDays(today, -120), days: 120, offEvery: 9, partialEvery: 4, noneEvery: 13 });
const EMPTY = 'Check back after your first planned day to see stats.\n';

const tempHome = (files = {}, name = '') => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'today-')), name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
  return dir;
};
const seeded = (history = fixture(), name = '') =>
  tempHome({ 'state.json': JSON.stringify(state), 'history.jsonl': history }, name);
const run = (dir, args, env = {}) =>
  spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TODAY_HOME: dir, ...env },
  });
const expected = history =>
  JSON.parse(JSON.stringify(computeStats(history.split('\n'), state, normalizeConfig(undefined).config, today)));

// ---- stats ----

test('scenario: JSON shape equals computeStats on the same input', () => {
  const dir = seeded();
  const r = run(dir, ['stats', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { ...expected(fixture()), notices: [] });
  for (const k of ['categories', 'completion', 'streak', 'daysOff', 'days', 'skipped', 'empty', 'notices'])
    assert.ok(k in out, k);
  assert.deepEqual(out.streak, { current: 4, best: 9 });
});

test('stats text: notices, numbers, then the grid', () => {
  const r = run(seeded(), ['stats']);
  assert.equal(r.status, 0, r.stderr);
  const s = expected(fixture());
  const lines = r.stdout.split('\n');
  assert.match(
    lines[0],
    new RegExp(`^Finished every must-do on ${s.completion.allDone} of ${s.completion.planned} planned days`),
  );
  assert.ok(lines.includes('Keep your 4-day streak going.'));
  assert.match(r.stdout, /^ {2}company +\d+ +\d+ +\d+$/m);
  assert.match(r.stdout, /^Mon .*\nTue /m);
  assert.match(r.stdout, /█ all done/);
  for (const l of lines) assert.ok([...l].length <= 80, l);
});

test('scenario: Empty history prints one line, exit 0; Only unreadable lines adds the skipped notice', () => {
  for (const [dir, out] of [
    [tempHome(), EMPTY],
    [tempHome({ 'history.jsonl': '' }), EMPTY],
    [tempHome({ 'history.jsonl': '{oops\n\n' }), `Skipped 1 unreadable history line.\n${EMPTY}`],
  ]) {
    for (const args of [['stats'], ['dashboard']]) {
      const r = run(dir, args);
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, out, ''], args.join(' '));
    }
    assert.ok(!fs.existsSync(path.join(dir, 'dashboard.html')));
    const j = JSON.parse(run(dir, ['stats', '--json']).stdout);
    assert.equal(j.empty, true);
  }
});

test('scenario: One corrupt line (and configuration: Corrupt history line)', () => {
  const good = makeHistory({ start: addDays(today, -7), days: 7, workDays: [1, 2, 3, 4, 5, 6, 7] })
    .split('\n')
    .filter(Boolean)
    .slice(0, 5);
  const history = `${good.slice(0, 2).join('\n')}\n{oops\n${good.slice(2).join('\n')}\n`;
  const dir = seeded(history);
  const p = path.join(dir, 'history.jsonl');
  const before = fs.readFileSync(p);
  const r = run(dir, ['stats']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split('\n').filter(l => /unreadable/.test(l)).length, 1);
  assert.match(r.stdout, /^Skipped 1 unreadable history line\.$/m);
  const j = JSON.parse(run(dir, ['stats', '--json']).stdout);
  assert.equal(j.skipped, 1);
  assert.equal(j.completion.planned, 5);
  assert.deepEqual(j, { ...expected(history), notices: [] });
  assert.ok(fs.readFileSync(p).equals(before), 'history.jsonl unchanged');
});

test('stats --json shows waiting notices once instead of dropping them', () => {
  const dir = tempHome({ 'state.json': '{oops' });
  run(dir, ['statusline']); // moves the bad state aside and leaves the notice waiting
  const j = JSON.parse(run(dir, ['stats', '--json']).stdout);
  assert.equal(j.notices.filter(n => /Started fresh/.test(n)).length, 1, j.notices.join('\n'));
  assert.deepEqual(JSON.parse(run(dir, ['stats', '--json']).stdout).notices, []);
});

test('stats text: odd category names count and control characters are cleaned', () => {
  const tasks = ['constructor', '2026', '\u001b[31mx'].map(category => ({ text: 'a', category, done: true }));
  const r = run(seeded(`${JSON.stringify({ date: addDays(today, -1), tasks })}\n`), ['stats']);
  const rows = r.stdout
    .split('\n')
    .filter(l => /^ {2}\S/.test(l))
    .map(l => l.trim().split(/ +/)[0]);
  assert.deepEqual(rows, ['category', 'company', 'dx', '2026', '[31mx', 'constructor']);
  assert.doesNotMatch(r.stdout, /NaN|\x1b/);
});

test('errors: an unreadable history says read, a failed write says write', () => {
  const dir = tempHome();
  fs.mkdirSync(path.join(dir, 'history.jsonl'));
  for (const cmd of ['stats', 'dashboard']) {
    const r = run(dir, [cmd]);
    assert.deepEqual(
      [r.status, r.stderr],
      [1, "Can't read your history.\nRun today doctor to check your setup.\n"],
      cmd,
    );
  }
  const w = seeded();
  fs.mkdirSync(path.join(w, 'dashboard.html'));
  const r = run(w, ['dashboard']);
  assert.deepEqual([r.status, r.stderr], [1, "Can't write the dashboard.\nRun today doctor to check your setup.\n"]);
});

test('a failed state save prints the save error, same as status', {
  skip: process.platform === 'win32' || process.getuid?.() === 0,
}, () => {
  // an old state date forces a rollover save; a read-only home makes it fail while history stays readable
  const dir = tempHome({
    'state.json': JSON.stringify({ ...state, date: addDays(today, -7) }),
    'history.jsonl': fixture(),
  });
  fs.chmodSync(dir, 0o555);
  try {
    for (const cmd of ['status', 'stats', 'dashboard']) {
      const r = run(dir, [cmd]);
      assert.deepEqual(
        [r.status, r.stderr],
        [1, "Can't save your plan.\nRun today doctor to check your setup.\n"],
        cmd,
      );
    }
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

// ---- dashboard ----

test('scenario: Self-contained file; command prints its path', () => {
  const dir = seeded();
  // every day a work day, so today's plan shows whatever weekday the suite runs on
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ workHours: { days: [1, 2, 3, 4, 5, 6, 7] } }));
  const r = run(dir, ['dashboard']);
  assert.equal(r.status, 0, r.stderr);
  const p = path.join(dir, 'dashboard.html');
  assert.equal(r.stdout, `Wrote ${p}.\nOpen it in your browser.\n`);
  const html = fs.readFileSync(p, 'utf8');
  for (const bad of ['<script', 'http://', 'https://', 'src=', '@import', 'url(']) assert.ok(!html.includes(bad), bad);
  assert.ok(html.includes('ship it'));
});

const fakeOpeners = () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-bin-'));
  for (const name of ['open', 'xdg-open'])
    fs.writeFileSync(path.join(binDir, name), '#!/bin/sh\nprintf \'%s\\n\' "$#" "$@" > "$0.args"\n', { mode: 0o755 });
  return binDir;
};

test('scenario: Opener gets one argument, TODAY_HOME with a space and ;', {
  skip: !['darwin', 'linux'].includes(process.platform),
}, () => {
  const dir = seeded(fixture(), 'my home; rm -rf x');
  const binDir = fakeOpeners();
  const r = run(dir, ['dashboard', '--open'], { PATH: binDir });
  assert.equal(r.status, 0, r.stderr);
  const p = path.join(dir, 'dashboard.html');
  assert.equal(r.stdout, `Wrote ${p}.\n`);
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  assert.equal(fs.readFileSync(path.join(binDir, `${opener}.args`), 'utf8'), `1\n${p}\n`);
  assert.ok(fs.existsSync(p));
});

test('scenario: No opener writes the file, one line names the path, exit 0', () => {
  const dir = seeded();
  const r = run(dir, ['dashboard', '--open'], { PATH: fs.mkdtempSync(path.join(os.tmpdir(), 'today-bin-')) });
  const p = path.join(dir, 'dashboard.html');
  assert.deepEqual([r.status, r.stdout], [0, `Wrote ${p}.\nOpen it in your browser.\n`]);
  assert.equal(r.stdout.split('\n').filter(l => l.includes(p)).length, 1);
  assert.ok(fs.existsSync(p));
});

test('scenario: failing opener prints the open line, exit 0', {
  skip: !['darwin', 'linux'].includes(process.platform),
}, () => {
  const dir = seeded();
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-bin-'));
  for (const name of ['open', 'xdg-open'])
    fs.writeFileSync(path.join(binDir, name), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
  const r = run(dir, ['dashboard', '--open'], { PATH: binDir });
  assert.deepEqual([r.status, r.stdout], [0, `Wrote ${path.join(dir, 'dashboard.html')}.\nOpen it in your browser.\n`]);
});

// ---- hooks ----

// Preload that moves every child's clock to `iso` as of now, then lets it tick (one clock for all runs).
const fakeClock = iso =>
  [
    process.env.NODE_OPTIONS,
    '--import=data:text/javascript,' +
      encodeURIComponent(
        `const R=Date,t=R.parse(${JSON.stringify(iso)}),s=${Date.now()};` +
          'globalThis.Date=class extends R{constructor(...a){super(...(a.length?a:[t+R.now()-s]))}static now(){return t+R.now()-s}}',
      ),
  ]
    .filter(Boolean)
    .join(' ');

test('scenario: Corrupt history during hooks', () => {
  // Wednesday, so yesterday is a work day under the default config and rollover writes a history line
  const env = { PATH: '', NODE_OPTIONS: fakeClock('2026-09-23T10:00:00') };
  const hooks = [['session-start'], ['nudge'], ['nudge', '--notify'], ['statusline']];
  for (const date of ['2026-09-23', '2026-09-22']) {
    const homes = [undefined, '{oops\nnull\n'].map(h =>
      tempHome({ 'state.json': JSON.stringify({ ...state, date }), ...(h ? { 'history.jsonl': h } : {}) }),
    );
    for (const args of hooks) {
      const [clean, corrupt] = homes.map(dir => run(dir, args, env));
      assert.deepEqual(
        [corrupt.status, corrupt.stdout, corrupt.stderr],
        [0, clean.stdout, clean.stderr],
        args.join(' '),
      );
    }
    if (date === '2026-09-22')
      for (const dir of homes)
        assert.match(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'), /"date":"2026-09-22"/, dir);
  }
});

// ---- voice ----

const VERBS = [
  'Finished',
  'Plan',
  'Keep',
  'Start',
  'Reached',
  'Took',
  'Counted',
  'Skipped',
  'Check',
  'Wrote',
  'Open',
  "Can't",
  'Run',
];

test('voice: stats and dashboard output pass voice-check and start with a verb', () => {
  const corrupt = seeded(`{oops\n${fixture()}`);
  const offOnly = tempHome({
    'state.json': JSON.stringify({ date: today, tasks: [] }),
    'history.jsonl': `${JSON.stringify({ date: addDays(today, -1), tasks: [], off: true })}\n`,
  });
  const outs = [
    run(seeded(), ['stats']).stdout,
    run(corrupt, ['stats']).stdout,
    run(offOnly, ['stats']).stdout,
    run(tempHome(), ['stats']).stdout,
    run(seeded(), ['dashboard']).stdout,
    run(corrupt, ['dashboard']).stdout,
  ];
  for (const out of outs) {
    assert.deepEqual(analyze(out).hard, [], out);
    const prose = out.split('\n    ')[0]; // the grid starts with its month row, indented 4
    for (const line of prose.split('\n').filter(l => l.trim())) {
      if (line.startsWith('  ')) continue; // category rows are data
      assert.ok(VERBS.includes(line.split(' ')[0]), `not verb first: ${line}`);
      assert.ok(!/\band\b|\bitem\b|\bstate\b/.test(line), `voice: ${line}`);
    }
  }
});

test('slash commands stats.md and dashboard.md run their verb and pass voice-check', () => {
  for (const [name, call] of [
    ['stats.md', 'today.mjs" stats\n'],
    ['dashboard.md', 'today.mjs" dashboard --open\n'],
  ]) {
    const md = fs.readFileSync(path.join(root, 'commands', name), 'utf8');
    assert.match(md, /^---\ndescription: .+\n/, name);
    assert.ok(md.includes(call), name);
    assert.deepEqual(analyze(md).hard, [], name);
  }
});

test('README: stats section passes voice-check; every command in it runs in a temp TODAY_HOME', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /`\/today:stats`/);
  assert.match(readme, /`\/today:dashboard`/);
  const section = readme.split('## Stats\n')[1].split('\n## ')[0];
  assert.deepEqual(analyze(section).hard, [], section);
  const cmds = [...section.matchAll(/`today ([^`]+)`/g)].map(m => m[1].split(' '));
  assert.ok(cmds.length >= 3, section);
  for (const args of cmds) {
    const r = run(seeded(), args, { PATH: fs.mkdtempSync(path.join(os.tmpdir(), 'today-bin-')) });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../scripts/voice-check.mjs';

const bin = fileURLToPath(new URL('../bin/today.mjs', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));
const run = (args, opts = {}) => spawnSync(process.execPath, [bin, ...[].concat(args)], { encoding: 'utf8', ...opts });

test('--help prints usage and exits 0', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Run today <command>\./m);
});

test('unknown command exits 1 with a hint', () => {
  const r = run('nope');
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "Can't find command: nope\nRun today --help to see commands.\n");
});

test('help and unknown-command text pass voice-check hard rules', () => {
  for (const text of [run('--help').stdout, run('nope').stderr]) {
    assert.deepEqual(analyze(text).hard, [], text);
  }
});

test('each help and unknown-command line starts with a verb', () => {
  const VERBS = [
    "Can't",
    'Run',
    'Pick',
    'Finish',
    'Add',
    'Change',
    'Mark',
    'Show',
    'Take',
    'Undo',
    'Check',
    'Schedule',
  ];
  const lines = (run('--help').stdout + run('nope').stderr).split('\n').filter(l => l.trim());
  for (const line of lines) {
    // command rows: "  name [arg]   Description" -> check the description
    const text = line.startsWith('  ') ? line.trim().split(/\s{2,}/)[1] : line;
    assert.ok(VERBS.includes(text.split(' ')[0]), `not verb first: ${line}`);
  }
});

test('docs/voice.md is linked from README', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /\]\(docs\/voice\.md\)/);
});

test('plugin manifest points at files that exist', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'today');
  assert.equal(plugin.version, '0.1.0');
  for (const p of [plugin.commands, plugin.hooks]) {
    assert.match(p, /^\.\//);
    assert.ok(fs.existsSync(path.join(root, p)), p);
  }
  assert.doesNotMatch(JSON.stringify(plugin), /workshop/);
});

// doctor: temp TODAY_HOME, PATH holds only the fake tools a test asks for.
const doctor = (tools = [], files = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-'));
  const pathDir = path.join(dir, 'bin');
  fs.mkdirSync(pathDir);
  for (const t of tools) fs.writeFileSync(path.join(pathDir, t), '#!/bin/sh\n', { mode: 0o755 });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  const r = run('doctor', { env: { TODAY_HOME: dir, PATH: pathDir, TODAY_DAEMON_DIR: path.join(dir, 'daemon') } });
  return { ...r, dir };
};

test('doctor in a temp home prints settings, plan and tools sections', () => {
  const r = doctor(['gh', 'osascript', 'launchctl']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Check settings\n {2}Found no config\.json\.\n {2}Using defaults\.$/m);
  assert.match(r.stdout, /^Check saved plan\n {2}Found no saved plan yet\.$/m);
  assert.match(
    r.stdout,
    /^Check tools\n {2}Found gh\.\n {2}Found osascript for notifications\.\n {2}Found launchctl for background reminders\.$/m,
  );
  assert.deepEqual(fs.readdirSync(r.dir), ['bin']);
});

test('scenario: missing notify-send and osascript, doctor says how to get notifications', () => {
  const r = doctor(['gh', 'systemctl']);
  assert.equal(r.status, 0);
  assert.match(
    r.stdout,
    /^ {2}Can't send notifications outside Claude Code\.\n {2}Install notify-send to turn them on\.$/m,
  );
  assert.match(r.stdout, /Found systemctl for background reminders\./);
});

test('doctor reports a missing gh and scheduler', () => {
  const r = doctor();
  assert.match(r.stdout, /^ {2}Can't find gh\.\n {2}Install it from https:\/\/cli\.github\.com\.$/m);
  assert.match(
    r.stdout,
    /^ {2}Can't schedule reminders outside Claude Code\.\n {2}Use macOS or Linux with systemd to turn them on\.$/m,
  );
});

test('doctor prints a config warning once and reports corrupt state', () => {
  const r = doctor([], { 'config.json': '{"maxTasks":"lots","quiet":true}', 'state.json': '{ broken' });
  assert.equal(r.stdout.match(/Ignored maxTasks/g).length, 1);
  assert.match(r.stdout, /^ {2}Read .*config\.json\.$/m);
  assert.match(r.stdout, /^ {2}Moved your unreadable plan to .*state\.json\.bak-/m);
  assert.equal(fs.readdirSync(r.dir).filter(f => f.startsWith('state.json.bak-')).length, 1);
  assert.match(doctor([], { 'state.json': '{"date":null,"tasks":[]}' }).stdout, /^ {2}Read .*state\.json\.$/m);
});

test('doctor does not claim to read an unparseable config', () => {
  const r = doctor([], { 'config.json': '{' });
  assert.doesNotMatch(r.stdout, /Read .*config\.json/);
  assert.match(r.stdout, /^Check settings\n {2}Can't read config\.json\. Using defaults\.$/m);
});

test('doctor text passes voice-check and each line starts with a verb', () => {
  const VERBS = ['Check', 'Found', 'Using', 'Read', 'Moved', 'Ignored', "Can't", 'Install', 'Use'];
  const outputs = [
    doctor().stdout,
    doctor(['osascript'], { 'config.json': '{"maxTasks":0}', 'state.json': 'x' }).stdout,
    doctor([], { 'config.json': '{' }).stdout,
  ];
  for (const out of outputs) {
    assert.match(out, /^Check tools$/m);
    assert.deepEqual(analyze(out).hard, [], out);
    for (const line of out.split('\n').filter(l => l.trim())) {
      assert.ok(VERBS.includes(line.trim().split(' ')[0]), `not verb first: ${line}`);
      assert.ok(!/\band\b|\bstate\b|\bitem\b/.test(line.replace(/state\.json\S*/g, '')), `voice: ${line}`);
    }
  }
});

// daily plan: temp TODAY_HOME per test.
const tempHome = (files = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
};
const inHome =
  dir =>
  (...args) =>
    run(args, { env: { ...process.env, TODAY_HOME: dir } });
// Makes today a work day or not, whatever the real date is.
const todayNum = new Date().getDay() || 7;
const days = work =>
  JSON.stringify({ workHours: { days: work ? [todayNum] : [1, 2, 3, 4, 5, 6, 7].filter(d => d !== todayNum) } });
const workHome = (files = {}) => tempHome({ 'config.json': days(true), ...files });
const history = dir => {
  const p = path.join(dir, 'history.jsonl');
  return fs.existsSync(p)
    ? fs
        .readFileSync(p, 'utf8')
        .trim()
        .split('\n')
        .map(l => JSON.parse(l))
    : [];
};

test('scenario: first plan of the day, plan -> add -> status in a temp home', () => {
  const dir = workHome();
  const cli = inHome(dir);
  const first = JSON.parse(cli('plan', '--json').stdout);
  assert.equal(first.needsPlan, true);
  assert.equal(first.slots, 3);
  assert.deepEqual(first.categories, ['company', 'dx']);
  assert.match(cli('plan').stdout, /^Pick up to 3 must-dos\.$/m);

  const added = cli('add', 'dx', 'fix', 'login redirect');
  assert.equal(added.status, 0);
  assert.match(added.stdout, /^Added: fix login redirect$/m);
  cli('add', 'company', 'write the memo');

  const status = JSON.parse(cli('status', '--json').stdout);
  assert.equal(status.needsPlan, false);
  assert.deepEqual(
    status.tasks.map(t => [t.n, t.text, t.category, t.done]),
    [
      [1, 'fix login redirect', 'dx', false],
      [2, 'write the memo', 'company', false],
    ],
  );
  assert.match(status.summary, /^@ ○ fix login redirect · ○ write the memo · streak 0$/);
});

test('scenario: plan already exists shows the list without asking', () => {
  const dir = workHome();
  const cli = inHome(dir);
  cli('add', 'dx', 'ship it');
  const out = cli('plan').stdout;
  assert.doesNotMatch(out, /Pick up to/);
  assert.match(out, /^ {2}1\. ○ ship it \(dx\)$/m);
});

test('scenario: too many tasks and unknown category exit 1, list unchanged', () => {
  const dir = workHome();
  const cli = inHome(dir);
  for (const t of ['a', 'b', 'c']) cli('add', 'dx', t);
  const full = cli('add', 'dx', 'd');
  assert.equal(full.status, 1);
  assert.equal(full.stderr, "Can't add more than 3 must-dos a day.\n");
  const bad = JSON.parse(inHome(workHome())('add', 'fun', 'x', '--json').stdout);
  assert.match(bad.error, /company, dx/);
  assert.equal(JSON.parse(cli('status', '--json').stdout).tasks.length, 3);
});

test('edit throws, edits text and category in one call; history untouched', () => {
  const dir = workHome();
  const cli = inHome(dir);
  for (const t of ['a', 'b', 'c']) cli('add', 'dx', t);
  const r = cli('edit', '2', 'throw', '3', 'text', 'new c', '1', 'category', 'company');
  assert.equal(r.status, 0, r.stderr);
  const { tasks } = JSON.parse(cli('status', '--json').stdout);
  assert.deepEqual(
    tasks.map(t => [t.n, t.text, t.category]),
    [
      [1, 'a', 'company'],
      [2, 'new c', 'dx'],
    ],
  );
  assert.deepEqual(history(dir), []);
  const bad = cli('edit', '9', 'throw');
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr, "Can't find must-do 9.\n");
});

test('scenario: rollover on read writes one history line and carries undone tasks', () => {
  const old = {
    date: '2001-01-05',
    tasks: [
      { text: 'A', category: 'dx', done: true },
      { text: 'B', category: 'dx', done: false },
    ],
  };
  const dir = workHome({
    'config.json': JSON.stringify({ workHours: { days: [5, todayNum] } }),
    'state.json': JSON.stringify(old),
  });
  const cli = inHome(dir);
  for (let i = 0; i < 3; i++) cli('statusline');
  cli('status');
  assert.deepEqual(history(dir), [{ date: '2001-01-05', tasks: old.tasks, allDone: false }]);
  const s = JSON.parse(cli('status', '--json').stdout);
  assert.deepEqual(
    s.tasks.map(t => [t.text, t.carried]),
    [['B', true]],
  );
  assert.equal(s.needsPlan, false);
});

test('scenario: carried tasks count as a plan: session start lists them, plan offers to add more', () => {
  const old = { date: '2001-01-05', tasks: [{ text: 'B', category: 'dx', done: false }] };
  const dir = workHome({
    'config.json': JSON.stringify({ workHours: { start: '00:00', end: '23:59', days: [5, todayNum] } }),
    'state.json': JSON.stringify(old),
  });
  const cli = inHome(dir);
  assert.equal(cli('session-start').stdout, "Finish today's must-dos: 1. B\n");
  const out = cli('plan').stdout;
  assert.doesNotMatch(out, /Pick up to/);
  assert.match(out, /^ {2}1\. ○ B \(dx, carried\)\nAdd up to 2 more with today add <category> <text>\.$/m);
});

test('scenario: rollover happens once when two reads run at once', async () => {
  const old = { date: '2001-01-05', tasks: [{ text: 'B', category: 'dx', done: false }] };
  const statusProc = env =>
    new Promise(res => spawn(process.execPath, [bin, 'status'], { env, stdio: 'ignore' }).on('close', res));
  for (let i = 0; i < 5; i++) {
    const dir = workHome({
      'config.json': JSON.stringify({ workHours: { days: [5, todayNum] } }),
      'state.json': JSON.stringify(old),
      '.rollover-2001-01-01': '',
    });
    const env = { ...process.env, TODAY_HOME: dir };
    await Promise.all([statusProc(env), statusProc(env)]);
    assert.equal(history(dir).length, 1, `run ${i}`);
    const { date } = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.deepEqual(
      fs.readdirSync(dir).filter(f => f.startsWith('.rollover-')),
      [`.rollover-${date}`],
    ); // old marker cleaned up
  }
});

test('an add racing the first read of a day is never lost', async () => {
  const old = { date: '2001-01-05', tasks: [{ text: 'B', category: 'dx', done: false }] };
  const proc = (env, args) =>
    new Promise(res => spawn(process.execPath, [bin, ...args], { env, stdio: 'ignore' }).on('close', res));
  for (let i = 0; i < 20; i++) {
    const dir = workHome({ 'state.json': JSON.stringify(old) });
    const env = { ...process.env, TODAY_HOME: dir };
    await Promise.all([proc(env, ['statusline']), proc(env, ['add', 'dx', 'new'])]);
    const { tasks } = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.ok(
      tasks.some(t => t.text === 'new'),
      `run ${i}: task lost`,
    );
  }
});

test('concurrent reads of a corrupt state move only the bad file, once', async () => {
  const proc = env =>
    new Promise(res => spawn(process.execPath, [bin, 'statusline'], { env, stdio: 'ignore' }).on('close', res));
  for (let i = 0; i < 5; i++) {
    const dir = workHome({ 'state.json': '{ broken' });
    const env = { ...process.env, TODAY_HOME: dir };
    await Promise.all([proc(env), proc(env), proc(env)]);
    const baks = fs.readdirSync(dir).filter(f => f.startsWith('state.json.bak-'));
    assert.equal(baks.length, 1, `run ${i}: ${baks}`);
    assert.equal(fs.readFileSync(path.join(dir, baks[0]), 'utf8'), '{ broken');
    assert.match(inHome(dir)('status').stdout, new RegExp(`^Moved your unreadable plan to .*${baks[0]}\\.$`, 'm'));
  }
});

test('doctor shows the corrupt-state notice, and the next command does not repeat it', () => {
  const dir = workHome({ 'state.json': '{ broken' });
  const cli = inHome(dir);
  assert.match(cli('doctor').stdout, /^ {2}Moved your unreadable plan to /m);
  assert.doesNotMatch(cli('status').stdout, /Moved/);
});

test('scenario: corrupt state read by statusline, the next command shows the notice once', () => {
  const cli = inHome(workHome({ 'state.json': '{ broken' }));
  assert.equal(cli('statusline').stdout, '');
  assert.equal(cli('statusline').stdout, '@ plan your must-dos: /today:plan · streak 0\n');
  assert.match(cli('status').stdout, /^Moved your unreadable plan to .*state\.json\.bak-/m);
  assert.doesNotMatch(cli('status').stdout, /Moved/);
});

test('state with a bad stage, streak or best is moved aside, and status and statusline still work', () => {
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('sv');
  const bad = [
    { stage: 9 },
    { stage: 1.5 },
    { stage: -1 },
    { streak: 'abc' },
    { streak: 1.5 },
    { streak: -3 },
    { best: -1 },
    { best: 'x' },
  ];
  for (const [i, fields] of bad.entries()) {
    // Yesterday with an undone must-do, so the read rolls over and resets.
    const date = i % 2 ? yesterday : new Date().toLocaleDateString('sv');
    const state = JSON.stringify({
      date,
      tasks: [{ text: 'B', category: 'dx', done: false }],
      streak: 2,
      best: 2,
      stage: 1,
      ...fields,
    });
    const cli = inHome(
      tempHome({ 'config.json': JSON.stringify({ workHours: { days: [1, 2, 3, 4, 5, 6, 7] } }), 'state.json': state }),
    );
    const line = cli('statusline');
    assert.equal(line.status, 0, `${state}: ${line.stderr}`);
    assert.equal(line.stdout, '', state);
    const r = cli('status');
    assert.equal(r.status, 0, `${state}: ${r.stderr}`);
    assert.match(r.stdout, /^Moved your unreadable plan to .*state\.json\.bak-/m, state);
    const view = JSON.parse(cli('status', '--json').stdout);
    assert.equal(view.streak, 0, state);
    assert.equal(view.stage, 0, state);
    assert.equal(cli('statusline').stdout, '@ plan your must-dos: /today:plan · streak 0\n', state);
  }
});

test('edit names what the user typed and rejects an unknown change', () => {
  const cli = inHome(workHome());
  cli('add', 'dx', 'a');
  assert.equal(cli('edit', 'x', 'throw').stderr, "Can't find must-do x.\n");
  const r = cli('edit', '1', 'edit');
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "Can't edit a must-do.\nUse keep, throw, text, or category.\n");
});

test('slash commands pass user text to the shell unchanged', () => {
  const text = `fix $HOME \`whoami\` $(id) "quoted" it's`;
  const esc = s => s.replaceAll("'", "'\\''"); // the rule the command files give
  const md = name => fs.readFileSync(fileURLToPath(new URL(`../commands/${name}`, import.meta.url)), 'utf8');
  const line = (name, hole) =>
    md(name)
      .split('\n')
      .map(l => l.trim())
      .find(l => l.startsWith('node ') && l.includes(hole));
  const sh = cmd =>
    spawnSync('sh', ['-c', cmd], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: root } });
  const echo = cmd =>
    sh(cmd.replace('node "${CLAUDE_PLUGIN_ROOT}/bin/today.mjs"', "printf '%s\\n'")).stdout.split('\n');
  // Categories come from the user's config.json, so they get the same quoting as task text.
  const cat = `side project $(id -u) it's`;
  const plan = echo(line('plan.md', '<text>').replace('<category>', esc(cat)).replace('<text>', esc(text)));
  assert.ok(plan.includes(cat) && plan.includes(text), plan.join('|'));
  const edit = echo(
    line('edit.md', '<new text>').replaceAll('<n>', '1').replace('<name>', esc(cat)).replace('<new text>', esc(text)),
  );
  assert.ok(edit.includes(cat) && edit.includes(text), edit.join('|'));
  assert.ok(echo(line('off.md', '<reason>').replace('<reason>', esc(text))).includes(text));
  // Real round trip through add.
  const dir = workHome({ 'config.json': JSON.stringify({ ...JSON.parse(days(true)), categories: [cat] }) });
  const add = line('plan.md', '<text>').replace('<category>', esc(cat)).replace('<text>', esc(text));
  assert.equal(sh(`TODAY_HOME='${dir}' ${add}`).status, 0);
  assert.deepEqual(
    JSON.parse(inHome(dir)('status', '--json').stdout).tasks.map(t => [t.text, t.category]),
    [[text, cat]],
  );
});

test('slash command descriptions say one thing per sentence', () => {
  const dir = fileURLToPath(new URL('../commands/', import.meta.url));
  for (const name of fs.readdirSync(dir)) {
    const [, desc] = fs.readFileSync(path.join(dir, name), 'utf8').match(/^description: (.+)$/m);
    assert.doesNotMatch(desc, /\band\b/, name);
  }
});

test('scenario: weekend read shows off today and keeps the carried task', () => {
  const state = { date: '2001-01-05', tasks: [{ text: 'B', category: 'dx', done: false }] };
  const dir = tempHome({ 'config.json': days(false), 'state.json': JSON.stringify(state) });
  const cli = inHome(dir);
  assert.equal(cli('statusline').stdout, '@ off today · streak 0\n');
  assert.match(cli('status').stdout, /^Enjoy your day off\.\nKept 1 must-do for your next work day\.$/m);
  assert.equal(JSON.parse(cli('status', '--json').stdout).tasks[0].text, 'B');
});

test('statusline: no plan line, --json, and silent exit 0 on corrupt or unwritable state', () => {
  const cli = inHome(workHome());
  const r = cli('statusline');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '@ plan your must-dos: /today:plan · streak 0\n');
  assert.deepEqual(JSON.parse(cli('statusline', '--json').stdout), {
    line: '@ plan your must-dos: /today:plan · streak 0',
  });
  const corrupt = inHome(tempHome({ 'state.json': '{ broken' }))('statusline');
  assert.deepEqual([corrupt.status, corrupt.stdout, corrupt.stderr], [0, '', '']);
  const notDir = path.join(tempHome({ file: 'x' }), 'file');
  const broken = run('statusline', { env: { ...process.env, TODAY_HOME: path.join(notDir, 'home') } });
  assert.equal(broken.status, 0);
  assert.equal(broken.stderr, '');
});

// reminders: work hours cover the whole of today, so a nudge is due whatever the real clock says.
const allDay = JSON.stringify({ workHours: { start: '00:00', end: '23:59', days: [todayNum] } });
const withTools = (dir, tools) => {
  const bin = path.join(dir, 'fakebin');
  fs.mkdirSync(bin, { recursive: true });
  for (const [name, body] of Object.entries(tools))
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return (...args) => run(args, { env: { ...process.env, TODAY_HOME: dir, PATH: bin } });
};

test('scenario: off silences nudges and session start, statusline shows the reason, on resumes', () => {
  const dir = tempHome({
    'config.json': allDay,
    'state.json': JSON.stringify({
      date: new Date().toLocaleDateString('sv'),
      tasks: [{ text: 'a', category: 'dx', done: false }],
    }),
  });
  const cli = inHome(dir);
  const off = cli('off', 'training');
  assert.equal(off.status, 0, off.stderr);
  assert.equal(off.stdout, 'Took today off: training.\nPaused nudges until tomorrow.\nUndo it with today on.\n');
  for (const verb of ['nudge', 'session-start']) assert.deepEqual([cli(verb).stdout, cli(verb).status], ['', 0], verb);
  assert.equal(withTools(dir, {})('nudge', '--notify').stdout, '');
  assert.equal(cli('statusline').stdout, '@ off today · training · streak 0\n');
  const on = cli('on');
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /^Resumed nudges for today\.\nFinish today's must-dos\.\n {2}1\. ○ a \(dx\)$/m);
  assert.match(cli('nudge').stdout, /^Finish today's must-dos: 1\. a · \d+[hm] left\n$/);
  assert.equal(cli('nudge').stdout, ''); // rate limited
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).lastNudgeAt);
});

test('off without a reason, on without a day off, and off --json', () => {
  const cli = inHome(workHome());
  assert.equal(cli('on').stdout, 'Found no day off to undo.\n');
  assert.equal(cli('off').stdout, 'Took today off.\nPaused nudges until tomorrow.\nUndo it with today on.\n');
  assert.equal(cli('statusline').stdout, '@ off today · streak 0\n');
  assert.equal(JSON.parse(cli('off', 'sick', '--json').stdout).summary, '@ off today · sick · streak 0');
  for (const out of [cli('off').stdout, cli('on').stdout, cli('on').stdout]) {
    assert.deepEqual(analyze(out).hard, [], out);
    for (const line of out.split('\n').filter(l => l.trim()))
      assert.match(line, /^(Took|Paused|Undo|Resumed|Found|Pick|Add|Use) /);
  }
});

test('scenario: corrupt state during a hook prints nothing and exits 0', () => {
  for (const verb of ['nudge', 'session-start', 'statusline']) {
    const r = inHome(tempHome({ 'config.json': allDay, 'state.json': '{ broken' }))(verb);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], verb);
    const notDir = path.join(tempHome({ file: 'x' }), 'file');
    const broken = run(verb, { env: { ...process.env, TODAY_HOME: path.join(notDir, 'home') } });
    assert.deepEqual([broken.status, broken.stdout, broken.stderr], [0, '', ''], verb);
  }
});

// A lock left by a crash, a clock that went back, or a stray directory never hangs a hook.
test('a directory or future lock is stale, and a stuck lock gives up within ~2 s', {
  skip: process.getuid?.() === 0,
}, () => {
  const state = JSON.stringify({ date: '2020-01-01', tasks: [{ text: 'a', category: 'dx', done: false }] });
  const setups = {
    'future lock': dir => {
      fs.writeFileSync(path.join(dir, 'state.json.lock'), '');
      fs.utimesSync(path.join(dir, 'state.json.lock'), 1893456000, 1893456000);
    },
    'lock is a dir': dir => fs.mkdirSync(path.join(dir, 'state.json.lock')),
    'moving is a dir': dir => {
      fs.mkdirSync(path.join(dir, 'state.json.moving'));
      fs.writeFileSync(path.join(dir, 'state.json'), '{');
    },
    'stuck lock': dir => {
      const d = path.join(dir, 'state.json.lock', 'x');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'y'), '');
      fs.chmodSync(d, 0);
    },
  };
  for (const [name, setup] of Object.entries(setups)) {
    for (const verb of ['nudge', 'session-start', 'statusline']) {
      const dir = tempHome({ 'config.json': allDay, 'state.json': state });
      setup(dir);
      const t = Date.now();
      const r = run(verb, { env: { ...process.env, TODAY_HOME: dir }, timeout: 8000 });
      const ms = Date.now() - t;
      try {
        fs.chmodSync(path.join(dir, 'state.json.lock', 'x'), 0o755);
      } catch {
        /* not the stuck case */
      }
      assert.equal(r.status, 0, `${name} ${verb}: ${r.signal} ${r.stderr}`);
      assert.ok(ms < 4000, `${name} ${verb}: ${ms} ms`);
      if (name !== 'stuck lock')
        assert.equal(fs.existsSync(path.join(dir, 'state.json.lock')), false, `${name} ${verb}`);
    }
  }
});

// Hooks write without the user doing anything, so they must never drop a verb's save.
const both = (dir, a, b) =>
  Promise.all(
    [a, b].map(
      args =>
        new Promise(res => {
          const p = spawn(process.execPath, [bin, ...args], { env: { ...process.env, TODAY_HOME: dir } });
          let out = '';
          p.stdout.on('data', d => {
            out += d;
          });
          p.on('close', () => res(out));
        }),
    ),
  );
const today = () => new Date().toLocaleDateString('sv');
const open2 = () =>
  JSON.stringify({
    date: today(),
    tasks: [
      { text: 'a', category: 'dx', done: false },
      { text: 'b', category: 'dx', done: false },
    ],
  });
const saved = dir => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));

test('race: nudge & done 1, 20 times, the done survives', async () => {
  for (let i = 0; i < 20; i++) {
    const dir = tempHome({ 'config.json': allDay, 'state.json': open2() });
    await both(dir, ['nudge'], ['done', '1', '--quiet']);
    assert.equal(saved(dir).tasks[0].done, true, `run ${i}`);
  }
});

test('race: session-start & add, 20 times, the new task survives', async () => {
  for (let i = 0; i < 20; i++) {
    const dir = tempHome({ 'config.json': allDay, 'state.json': JSON.stringify({ date: today(), tasks: [] }) });
    await both(dir, ['session-start'], ['add', 'dx', 'new']);
    assert.deepEqual(
      saved(dir).tasks.map(t => t.text),
      ['new'],
      `run ${i}`,
    );
  }
});

// Verbs save through the same locked read-modify-write, so they never drop a hook's or another verb's save.
test('race: add & add, 20 times, no task lost', async () => {
  for (let i = 0; i < 20; i++) {
    const dir = tempHome({ 'config.json': allDay, 'state.json': JSON.stringify({ date: today(), tasks: [] }) });
    await both(dir, ['add', 'dx', 'one'], ['add', 'dx', 'two']);
    assert.deepEqual(
      saved(dir)
        .tasks.map(t => t.text)
        .sort(),
      ['one', 'two'],
      `run ${i}`,
    );
  }
});

test('race: nudge & done 1, 30 times, lastNudgeAt never wiped', async () => {
  for (let i = 0; i < 30; i++) {
    const dir = tempHome({ 'config.json': allDay, 'state.json': open2() });
    const [out] = await both(dir, ['nudge'], ['done', '1', '--quiet']);
    const s = saved(dir);
    assert.equal(s.tasks[0].done, true, `run ${i}`);
    if (out) assert.ok(s.lastNudgeAt, `run ${i}: nudged but lastNudgeAt gone`);
  }
});

// The rollover winner crashed after its marker: the next read takes over, so the day moves on and stays fast.
test('stale rollover marker: add saves today, one history line, next status is fast', () => {
  const old = {
    date: '2001-01-05',
    tasks: [
      { text: 'A', category: 'dx', done: true },
      { text: 'B', category: 'dx', done: false },
    ],
  };
  const dir = tempHome({
    'config.json': JSON.stringify({ workHours: { days: [5, todayNum] } }),
    'state.json': JSON.stringify(old),
    [`.rollover-${today()}`]: '',
  });
  const cli = inHome(dir);
  assert.equal(cli('add', 'dx', 'c').status, 0);
  const s = saved(dir);
  assert.equal(s.date, today());
  assert.deepEqual(
    s.tasks.map(t => t.text),
    ['B', 'c'],
  );
  assert.deepEqual(history(dir), [{ date: '2001-01-05', tasks: old.tasks, allDone: false }]);
  const t0 = Date.now();
  cli('status');
  assert.ok(Date.now() - t0 < 1000, `status took ${Date.now() - t0} ms`);
  assert.equal(history(dir).length, 1);
});

test('race: two nudges at once print at most one line, 20 times', async () => {
  for (let i = 0; i < 20; i++) {
    const dir = tempHome({ 'config.json': allDay, 'state.json': open2() });
    const outs = await both(dir, ['nudge'], ['nudge']);
    assert.ok(outs.join('').split('\n').filter(Boolean).length <= 1, `run ${i}: ${outs}`);
  }
});

test('hook and statusline exit 0 with nothing on stderr when stdout is a closed pipe', () => {
  const statusline = path.join(root, 'statusline', 'today.mjs');
  for (const cmd of [`"$0" "$1" session-start`, `"$0" "$1" nudge`, `"$0" "$1" statusline`, `"$0" "${statusline}"`]) {
    const dir = tempHome({ 'config.json': allDay, 'state.json': open2() });
    // true exits at once; node starts ~30 ms later and writes into a pipe nobody reads.
    const r = spawnSync('sh', ['-c', `{ ${cmd}; echo "exit $?" >&2; } | true`, process.execPath, bin], {
      encoding: 'utf8',
      env: { ...process.env, TODAY_HOME: dir },
    });
    assert.equal(r.stderr, 'exit 0\n', cmd);
  }
});

test('off and on on a non-work day skip the lines about nudges', () => {
  const cli = inHome(tempHome({ 'config.json': days(false) }));
  assert.equal(cli('off', 'x').stdout, 'Took today off: x.\nUndo it with today on.\n');
  assert.equal(cli('on').stdout, 'Enjoy your day off.\n');
});

test('scenario: session start without a plan speaks once a day', () => {
  const cli = inHome(workHome());
  assert.equal(cli('session-start').stdout, 'Pick your must-dos with /today:plan.\n');
  assert.equal(cli('session-start').stdout, '');
  cli('add', 'dx', 'a');
  assert.equal(cli('session-start').stdout, "Finish today's must-dos: 1. a\n");
});

test('scenario: nudge --notify passes the text as one argument, and falls back to stdout without a tool', () => {
  const text = `fix "$(id)" \`whoami\` it's`;
  const state = JSON.stringify({
    date: new Date().toLocaleDateString('sv'),
    tasks: [{ text, category: 'dx', done: false }],
  });
  const dir = tempHome({ 'config.json': allDay, 'state.json': state });
  const r = withTools(dir, { osascript: 'printf "%s\\n" "$@" > "$TODAY_HOME/notified"' })('nudge', '--notify');
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  const args = fs.readFileSync(path.join(dir, 'notified'), 'utf8').trim().split('\n');
  assert.match(args.at(-1), /^Finish today's must-dos: 1\. fix "\$\(id\)" `whoami` it's · \d+[hm] left$/);
  const linux = tempHome({ 'config.json': allDay, 'state.json': state });
  withTools(linux, { 'notify-send': 'printf "%s\\n" "$@" > "$TODAY_HOME/notified"' })('nudge', '--notify');
  assert.equal(fs.readFileSync(path.join(linux, 'notified'), 'utf8'), `today\n${args.at(-1)}\n`);
  const none = withTools(tempHome({ 'config.json': allDay, 'state.json': state }), {})('nudge', '--notify');
  assert.deepEqual([none.status, none.stdout, none.stderr], [0, `${args.at(-1)}\n`, '']);
  const failing = withTools(tempHome({ 'config.json': allDay, 'state.json': state }), { osascript: 'exit 1' })(
    'nudge',
    '--notify',
  );
  assert.deepEqual([failing.status, failing.stdout, failing.stderr], [0, `${args.at(-1)}\n`, '']);
});

test('hooks.json runs session-start and nudge through CLAUDE_PLUGIN_ROOT, silently on corrupt state', () => {
  const { hooks } = JSON.parse(fs.readFileSync(path.join(root, 'hooks/hooks.json'), 'utf8'));
  const cmd = event => hooks[event][0].hooks[0].command;
  assert.equal(cmd('SessionStart'), 'node "${CLAUDE_PLUGIN_ROOT}/bin/today.mjs" session-start');
  assert.equal(cmd('UserPromptSubmit'), 'node "${CLAUDE_PLUGIN_ROOT}/bin/today.mjs" nudge');
  for (const event of ['SessionStart', 'UserPromptSubmit']) {
    const dir = tempHome({ 'config.json': allDay, 'state.json': '{ broken' });
    const r = spawnSync('sh', ['-c', cmd(event)], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, TODAY_HOME: dir },
    });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], event);
  }
});

test('statusline/today.mjs prints the summary line in under 150 ms', () => {
  const dir = workHome();
  const script = path.join(root, 'statusline/today.mjs');
  const env = { ...process.env, TODAY_HOME: dir };
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    // best of 3, so one slow spawn on a busy machine does not fail the budget
    const t = performance.now();
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env, input: '{}' });
    best = Math.min(best, performance.now() - t);
    assert.deepEqual([r.status, r.stdout], [0, '@ plan your must-dos: /today:plan · streak 0\n']);
  }
  assert.ok(best < 150, `statusline took ${best.toFixed(0)} ms`);
  const corrupt = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...env, TODAY_HOME: tempHome({ 'state.json': '{' }) },
  });
  assert.deepEqual([corrupt.status, corrupt.stdout, corrupt.stderr], [0, '', '']);
});

test('plan, status, add and edit text pass voice-check and start with a verb', () => {
  const VERBS = [
    'Pick',
    'Add',
    'Use',
    'Finish',
    'Finished',
    'Keep',
    'Start',
    'Added:',
    'Saved',
    'Enjoy',
    'Kept',
    'Change',
    "Can't",
    'Write',
    'Run',
  ];
  const dir = workHome();
  const cli = inHome(dir);
  const outs = [
    cli('plan').stdout,
    cli('add', 'dx', 'ship').stdout,
    cli('status').stdout,
    cli('edit').stdout,
    cli('edit', '1', 'keep').stdout,
    cli('add', 'fun', 'x').stderr,
    cli('edit', 'x').stderr,
    inHome(tempHome({ 'config.json': days(false) }))('status').stdout,
  ];
  for (const out of outs) {
    assert.deepEqual(analyze(out).hard, [], out);
    for (const line of out.split('\n').filter(l => l.trim())) {
      if (/^ {2}\d+\. /.test(line)) continue; // list rows are data
      const text = line.startsWith('@ ') ? line.slice(2) : line;
      assert.ok(VERBS.includes(text.split(' ')[0]), `not verb first: ${line}`);
      assert.ok(!/\band\b|\bitem\b|\bstate\b/.test(line), `voice: ${line}`);
    }
  }
});

test('slash commands pass voice-check and call only verbs the CLI knows', () => {
  const dir = fileURLToPath(new URL('../commands/', import.meta.url));
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, ['done.md', 'edit.md', 'off.md', 'on.md', 'plan.md']);
  for (const name of names) {
    const md = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.match(md, /^---\ndescription: .+\n/, name);
    assert.deepEqual(analyze(md.replace(/^!`/gm, '`')).hard, [], name); // !`cmd` runs a command, not prose
    for (const [, verb] of md.matchAll(/today\.mjs" (\w+)/g)) {
      assert.ok(['plan', 'status', 'add', 'edit', 'off', 'on', 'done'].includes(verb), `${name}: ${verb}`);
    }
  }
});

// reward: done. Spawned with pipes, so stdout is not a TTY and each animation prints its final frame only.
const todayStr = () => new Date().toLocaleDateString('sv');
const planned = (tasks, extra = {}, config = days(true)) =>
  inHome(
    tempHome({
      'config.json': config,
      'state.json': JSON.stringify({
        date: todayStr(),
        tasks: tasks.map(text => ({ text, category: 'dx', done: false })),
        ...extra,
      }),
    }),
  );

test('scenario: plan -> done 1 -> status shows ✓', () => {
  const dir = workHome();
  const cli = inHome(dir);
  cli('add', 'dx', 'a');
  cli('add', 'dx', 'b');
  const r = cli('done', '1');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^✓ Marked done: a\n/);
  assert.doesNotMatch(r.stdout, /\x1b\[/);
  assert.match(cli('status').stdout, /^ {2}1\. ✓ a \(dx\)\n {2}2\. ○ b \(dx\)$/m);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).tasks[0];
  assert.equal(saved.done, true);
  assert.ok(!Number.isNaN(Date.parse(saved.doneAt)));
});

test("scenario: last task plays the celebration with the creature and names tomorrow's streak", () => {
  const cli = planned(['a', 'b'], { streak: 4, best: 4, stage: 1 });
  cli('done', '1', '--quiet');
  const r = cli('done');
  assert.equal(r.status, 0, r.stderr);
  for (const line of ['(o o)', 'Watch Hatchling do a little dance.']) assert.ok(r.stdout.includes(line), r.stdout);
  assert.match(r.stdout, /\nFinished every must-do today\.\nStreak will be 5 tomorrow\.\n$/);
  assert.doesNotMatch(r.stdout, /Marked done|Keep your/);
  const v = JSON.parse(cli('status', '--json').stdout);
  assert.equal(v.streak, 4); // the streak itself moves at rollover, not now
});

test("all done on a non-work day keeps tomorrow's streak where it is", () => {
  const r = planned(['a'], { streak: 4, best: 4, stage: 1 }, days(false))('done', '1');
  assert.match(r.stdout, /Finished every must-do today\.\nStreak will be 4 tomorrow\.\n$/);
});

test('scenario: --quiet and config quiet print only the updated list', () => {
  const quietCfg = JSON.stringify({ ...JSON.parse(days(true)), quiet: true });
  for (const [cli, args] of [
    [planned(['a', 'b']), ['--quiet']],
    [planned(['a', 'b'], {}, quietCfg), []],
  ]) {
    const r = cli('done', '2', ...args);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Finish today's must-dos\.\n {2}1\. ○ a \(dx\)\n {2}2\. ✓ b \(dx\)\n/);
    assert.doesNotMatch(r.stdout, /Marked done/);
    const last = cli('done', '1', ...args).stdout;
    assert.doesNotMatch(last, /dance/);
    assert.match(last, /Finished every must-do today\.\nStreak will be 1 tomorrow\.\n$/);
  }
});

test('done: already done, ambiguous and unknown exit 1 and change nothing', () => {
  const cli = planned(['a', 'b', 'c']);
  cli('done', '2', '--quiet');
  const before = cli('status', '--json').stdout;
  const cases = [
    [['2'], 'Finished b already.\n'],
    [[], 'Pick which must-do is done: 1 or 3.\nRun today done <n>.\n'],
    [['9'], "Can't find must-do 9.\n"],
  ];
  for (const [args, stderr] of cases) {
    const r = cli('done', ...args);
    assert.deepEqual([r.status, r.stdout, r.stderr], [1, '', stderr]);
  }
  assert.equal(cli('status', '--json').stdout, before);
});

test('done --json plays nothing and returns the view with allDone and tomorrow', () => {
  const cli = planned(['a'], { streak: 2, best: 2 });
  const v = JSON.parse(cli('done', '1', '--json').stdout);
  assert.deepEqual([v.error, v.allDone, v.tomorrow, v.tasks[0].done, v.creature], [null, true, 3, true, 'Egg']);
  assert.equal(v.message, 'Finished every must-do today.\nStreak will be 3 tomorrow.');
  const again = JSON.parse(cli('done', '1', '--json').stdout);
  assert.deepEqual([again.error, again.allDone], ['Finished a already.', false]);
});

test('done text passes voice-check and starts with a verb', () => {
  const VERBS = ['Finish', 'Finished', 'Marked', 'Watch', 'Pick', 'Run', "Can't", 'Add', 'Start', 'Keep'];
  const cli = planned(['a', 'b', 'c']);
  const outs = [
    cli('done', '1').stdout,
    cli('done').stderr,
    cli('done', '1').stderr,
    cli('done', '9').stderr,
    cli('done', '2', '--quiet').stdout,
    cli('done', '3').stdout,
  ];
  for (const out of outs) {
    assert.deepEqual(analyze(out).hard, [], out);
    const lines = out.split('\n').filter(l => l.trim());
    // Skip list rows and the celebration frame (confetti, creature art: the one screen with a joke).
    const words = out.includes('dance') ? lines.slice(lines.findIndex(l => l.startsWith('Watch'))) : lines;
    for (const line of words.filter(l => !/^ {2}\d+\. /.test(l))) {
      // The streak forecast is its own line under the verb-first one; the reward spec names it.
      if (/^Streak will be \d+ tomorrow\.$/.test(line)) continue;
      assert.ok(VERBS.includes(line.replace(/^\S /, '').split(' ')[0]), `not verb first: ${line}`);
      assert.ok(!/\band\b|\bitem\b|\bstate\b/.test(line), `voice: ${line}`);
    }
  }
});

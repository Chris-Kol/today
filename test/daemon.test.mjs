// launchctl/systemctl are fakes that log their arguments, and HOME and XDG_CONFIG_HOME point into a temp dir.
// Daemon files go to TODAY_DAEMON_DIR (a temp dir), which also skips the scheduler. A test that needs the
// scheduler calls unsets it and checks first that the files land in the temp HOME. Nothing here touches the
// real LaunchAgents or systemd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daemonInstall, daemonRemove, daemonFiles } from '../src/io.mjs';
import { analyze } from '../scripts/voice-check.mjs';

const script = fileURLToPath(new URL('../bin/today.mjs', import.meta.url));
const read = p => fs.readFileSync(p, 'utf8');

// scheduler: true unsets TODAY_DAEMON_DIR, so install and remove call the fake tools; files go under the temp HOME.
function sandbox(tools = ['launchctl', 'systemctl'], { scheduler = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-daemon-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const t of tools)
    fs.writeFileSync(path.join(bin, t), `#!/bin/sh\necho "${t} $*" >> "${dir}/calls"\n`, { mode: 0o755 });
  const env = {
    TODAY_HOME: path.join(dir, 'home & <co>'),
    TODAY_DAEMON_DIR: path.join(dir, 'agents'),
    HOME: path.join(dir, 'user'),
    XDG_CONFIG_HOME: path.join(dir, 'user', '.config'),
    PATH: bin,
  };
  if (scheduler) delete env.TODAY_DAEMON_DIR;
  Object.assign(process.env, env);
  if (scheduler) {
    delete process.env.TODAY_DAEMON_DIR;
    for (const platform of ['darwin', 'linux'])
      for (const f of daemonFiles(platform)) assert.ok(f.startsWith(dir + path.sep), `not sandboxed: ${f}`);
  }
  const calls = () => (fs.existsSync(`${dir}/calls`) ? read(`${dir}/calls`).trim().split('\n') : []);
  return { dir, env, calls };
}

test('scenario: install on macOS writes a LaunchAgent with absolute paths and the interval, then loads it', () => {
  const { env, calls } = sandbox(undefined, { scheduler: true });
  const r = daemonInstall(45, 'darwin');
  assert.equal(r.ok, true);
  const [plist] = daemonFiles('darwin');
  assert.equal(plist, path.join(env.HOME, 'Library', 'LaunchAgents', 'dev.today.nudge.plist'));
  const xml = read(plist);
  const args = [...xml.match(/<array>([\s\S]*?)<\/array>/)[1].matchAll(/<string>(.*)<\/string>/g)].map(m => m[1]);
  assert.deepEqual(args, [process.execPath, script, 'nudge', '--notify']);
  assert.ok(path.isAbsolute(args[0]) && path.isAbsolute(args[1]));
  assert.match(xml, /<key>StartInterval<\/key>\s*<integer>2700<\/integer>/);
  assert.match(xml, /<key>TODAY_HOME<\/key>\s*<string>.*home &amp; &lt;co&gt;<\/string>/);
  const uid = process.getuid();
  assert.deepEqual(calls(), [
    `launchctl bootout gui/${uid}/dev.today.nudge`,
    `launchctl bootstrap gui/${uid} ${plist}`,
  ]);
  assert.deepEqual(r.lines, [
    'Turned on reminders outside Claude Code.',
    `Wrote ${plist}.`,
    'Loaded it with launchctl.',
    'Scheduled a nudge check every 45 minutes.',
    'Turn them off with today daemon remove.',
  ]);
});

test('install on Linux writes a systemd user service and timer with absolute paths and the interval', () => {
  const { env, calls } = sandbox(undefined, { scheduler: true });
  const r = daemonInstall(30, 'linux');
  assert.equal(r.ok, true);
  const [service, timer] = daemonFiles('linux');
  assert.equal(path.dirname(service), path.join(env.XDG_CONFIG_HOME, 'systemd', 'user'));
  assert.match(
    read(service),
    new RegExp(
      `^ExecStart="${process.execPath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}" "${script.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}" nudge --notify$`,
      'm',
    ),
  );
  assert.match(read(service), /^Type=oneshot$/m);
  assert.match(read(service), /^Environment="TODAY_HOME=.*home & <co>"$/m);
  assert.match(read(timer), /^OnUnitActiveSec=30min$/m);
  assert.match(read(timer), /^Unit=today-nudge\.service$/m);
  assert.deepEqual(calls(), ['systemctl --user daemon-reload', 'systemctl --user enable --now today-nudge.timer']);
});

test('a line break in TODAY_HOME is refused, so it cannot add unit directives', () => {
  for (const platform of ['linux', 'darwin']) {
    const { env } = sandbox();
    process.env.TODAY_HOME = '/tmp/x\nExecStartPre=/bin/touch /tmp/pwned';
    const r = daemonInstall(45, platform);
    assert.deepEqual(r, { ok: false, lines: ["Can't set up reminders for a path with a line break in it."] });
    assert.equal(fs.existsSync(env.TODAY_DAEMON_DIR), false);
  }
});

test('a $ in the script path is doubled in ExecStart and read back as one $', () => {
  const { dir, env } = sandbox();
  const copy = path.join(dir, 'a$b');
  for (const d of ['bin', 'src'])
    fs.cpSync(fileURLToPath(new URL(`../${d}`, import.meta.url)), path.join(copy, d), { recursive: true });
  const io = path.join(copy, 'src', 'io.mjs');
  const code = `const m = await import(${JSON.stringify(io)}); m.daemonInstall(45, 'linux'); console.log(JSON.stringify(m.daemonPaths('linux')));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const script = fs.realpathSync(path.join(copy, 'bin', 'today.mjs'));
  assert.deepEqual(JSON.parse(r.stdout), [process.execPath, script]);
  const exec = read(daemonFiles('linux')[0]).match(/^ExecStart=(.*)$/m)[1];
  assert.ok(exec.includes(`"${script.split('$').join('$$')}"`), exec);
});

test('scenario: remove unloads the job and deletes its files', () => {
  for (const platform of ['darwin', 'linux']) {
    const { calls } = sandbox(undefined, { scheduler: true });
    daemonInstall(45, platform);
    const r = daemonRemove(platform);
    assert.equal(r.ok, true);
    for (const f of daemonFiles(platform)) assert.equal(fs.existsSync(f), false, f);
    assert.match(calls().at(-1), /launchctl bootout|systemctl --user daemon-reload/);
    assert.ok(calls().some(c => /bootout gui\/\d+\/dev\.today\.nudge$|disable --now today-nudge\.timer$/.test(c)));
    assert.deepEqual(daemonRemove(platform).lines, ['Found no reminders outside Claude Code to remove.']);
  }
});

test('install without a scheduler writes nothing and says so', () => {
  const { env } = sandbox([]);
  const r = daemonInstall(45, 'darwin');
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines, [
    "Can't schedule reminders outside Claude Code.",
    'Use macOS or Linux with systemd to turn them on.',
  ]);
  assert.equal(fs.existsSync(env.TODAY_DAEMON_DIR), false);
  assert.equal(daemonInstall(45, 'win32').ok, false);
});

test('a scheduler that fails to load keeps the files and says how to undo', () => {
  sandbox(undefined, { scheduler: true });
  fs.writeFileSync(path.join(process.env.PATH, 'launchctl'), '#!/bin/sh\nexit 5\n', { mode: 0o755 });
  const r = daemonInstall(45, 'darwin');
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines.slice(-2), ["Can't load it with launchctl.", 'Run today daemon remove to undo it.']);
});

// The CLI runs on this machine's platform; skip elsewhere.
const cliPlatform = ['darwin', 'linux'].includes(process.platform);

test('scenario: daemon job status: today daemon install|remove through the CLI, and doctor flags a stale path', {
  skip: !cliPlatform,
}, () => {
  const { env } = sandbox();
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
  const inst = cli('daemon', 'install');
  assert.equal(inst.status, 0, inst.stderr);
  assert.match(inst.stdout, /^Wrote .+\.$/m);
  assert.deepEqual(analyze(inst.stdout).hard, []);
  assert.match(cli('doctor').stdout, /^ {2}Found reminders outside Claude Code at .+\.$/m);
  const [f] = daemonFiles(process.platform);
  fs.writeFileSync(f, read(f).replaceAll(script, '/gone/today/bin/today.mjs'));
  assert.match(
    cli('doctor').stdout,
    /^ {2}Can't find \/gone\/today\/bin\/today\.mjs for reminders outside Claude Code\.\n {2}Run today daemon install to fix it\.$/m,
  );
  const rm = cli('daemon', 'remove');
  assert.equal(rm.status, 0, rm.stderr);
  assert.match(rm.stdout, /^Deleted .+\.$/m);
  assert.equal(fs.existsSync(f), false);
  const bad = cli('daemon', 'start');
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr, 'Run today daemon install or today daemon remove.\n');
});

test('a huge nudgeEveryMinutes installs a valid daily interval', { skip: process.platform !== 'darwin' }, () => {
  const { env } = sandbox();
  fs.mkdirSync(env.TODAY_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.TODAY_HOME, 'config.json'), '{"nudgeEveryMinutes": 1e21}');
  const r = spawnSync(process.execPath, [script, 'daemon', 'install'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(daemonFiles('darwin')[0]), /<key>StartInterval<\/key>\s*<integer>86400<\/integer>/);
});

test('with TODAY_DAEMON_DIR set, install and remove write files only and say the scheduler was skipped', () => {
  for (const platform of ['darwin', 'linux']) {
    const { env, calls } = sandbox();
    const tool = platform === 'darwin' ? 'launchctl' : 'systemctl';
    const skipped = `Skipped ${tool}: TODAY_DAEMON_DIR is set.`;
    const inst = daemonInstall(45, platform);
    const files = daemonFiles(platform);
    for (const f of files) assert.ok(fs.existsSync(f) && f.startsWith(env.TODAY_DAEMON_DIR), f);
    assert.deepEqual(inst, { ok: true, lines: [...files.map(f => `Wrote ${f}.`), skipped] });
    const rm = daemonRemove(platform);
    assert.deepEqual(rm, { ok: true, lines: [...files.map(f => `Deleted ${f}.`), skipped] });
    for (const f of files) assert.equal(fs.existsSync(f), false, f);
    assert.deepEqual(calls(), [], platform);
    for (const out of [inst, rm]) assert.deepEqual(analyze(out.lines.join('\n')).hard, []);
  }
});

test('a relative TODAY_HOME is written to the job as the absolute path under HOME', () => {
  const { env } = sandbox();
  process.env.TODAY_HOME = 'rel';
  daemonInstall(45, 'linux');
  assert.match(
    read(daemonFiles('linux')[0]),
    new RegExp(`^Environment="TODAY_HOME=${path.join(env.HOME, 'rel')}"$`, 'm'),
  );
});

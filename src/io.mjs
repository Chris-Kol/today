// Thin IO: files under $TODAY_HOME, the clock, the PATH. Logic lives in core.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeConfig, emptyState, isValidState, rollover, localDate } from './core.mjs';

export const home = () => process.env.TODAY_HOME || path.join(os.homedir(), '.today');
const file = name => path.join(home(), name);

// Never creates config.json; that file belongs to the user.
export function readConfig() {
  try {
    return {
      ...normalizeConfig(JSON.parse(fs.readFileSync(file('config.json'), 'utf8'))),
      found: true,
      readable: true,
    };
  } catch (e) {
    const found = e.code !== 'ENOENT';
    return {
      ...normalizeConfig(undefined),
      warnings: found ? ["Can't read config.json. Using defaults."] : [],
      found,
      readable: false,
    };
  }
}

const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// -> {state} if valid, {} if missing, {bad: true} otherwise.
function tryRead(p) {
  try {
    const state = JSON.parse(fs.readFileSync(p, 'utf8'));
    return isValidState(state) ? { state } : { bad: true };
  } catch (e) {
    return e.code === 'ENOENT' ? {} : { bad: true };
  }
}

// Exclusive create of state.json<suffix>; others nap and retry. A lock more than 2 s off the clock (either
// way: the clock can go back) or a directory is from a crash. Gives up with a throw after 2.5 s, so a hook
// never hangs; the hooks turn the throw into a silent exit 0.
function withLock(suffix, fn) {
  const lock = file('state.json') + suffix;
  const deadline = performance.now() + 2500;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' || performance.now() > deadline) throw e;
      try {
        const st = fs.statSync(lock);
        if (st.isDirectory() || Math.abs(Date.now() - st.mtimeMs) > 2000)
          fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        /* gone already, or can't remove it: the deadline ends the wait */
      }
      nap(10);
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

// Bad state is moved aside to state.json.bak-<ts> and replaced by a fresh one, so the notice shows once.
// Concurrent readers of a bad file take turns on state.json.moving; each re-reads under it, so only
// the first moves the bad file and a valid file is never moved.
export function readState(now = new Date()) {
  const p = file('state.json');
  const cantMove = { state: emptyState(), notice: "Can't read your plan.\nStarted fresh for now." };
  for (;;) {
    const first = tryRead(p);
    if (!first.bad) return { state: first.state ?? emptyState(), notice: null };
    let r;
    try {
      r = withLock('.moving', () => {
        if (!tryRead(p).bad) return null; // another reader moved it; re-read
        const base = `${p}.bak-${now.toISOString().replace(/[:.]/g, '-')}`;
        let bak = base;
        for (let i = 1; fs.existsSync(bak); i++) bak = `${base}-${i}`;
        try {
          fs.renameSync(p, bak);
        } catch {
          return cantMove;
        }
        const notice = `Moved your unreadable plan to ${bak}.`;
        // The notice waits in state until a command the user runs shows it, so a silent statusline read can't lose it.
        const state = { ...emptyState(), notices: [notice] };
        try {
          writeState(state);
        } catch {
          /* no state.json now reads as a fresh start next time */
        }
        return { state, notice };
      });
    } catch {
      return cantMove;
    } // can't take the lock here, so this notice repeats
    if (r) return r;
  }
}

// Write to a temp file then rename, so a crash mid-write never leaves half a state file.
const writeRaw = state => {
  const tmp = `${file('state.json')}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, file('state.json'));
};

// Every save takes state.json.lock, so it waits while updateState reads and writes.
export function writeState(state) {
  fs.mkdirSync(home(), { recursive: true });
  withLock('.lock', () => writeRaw(state));
}

// Read-modify-write under the lock; every save after load goes through here. fn gets the state as saved
// right now and returns {state, ...}; a changed state is saved, and fn's result is returned.
// No file yet: fn gets `fallback`. An unreadable file: fn is not called, nothing is saved, returns null.
export function updateState(fallback, fn) {
  fs.mkdirSync(home(), { recursive: true });
  return withLock('.lock', () => {
    const cur = tryRead(file('state.json'));
    if (cur.bad) return null;
    const state = cur.state ?? fallback;
    const r = fn(state);
    if (r.state !== state) writeRaw(r.state);
    return r;
  });
}

export function appendHistory(line) {
  fs.mkdirSync(home(), { recursive: true });
  fs.appendFileSync(file('history.jsonl'), JSON.stringify(line) + '\n');
}

export const hasTool = name =>
  (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .some(dir => {
      const p = path.join(dir, name);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });

export { localDate };

// Every verb reads through here, so the first read on a new day rolls over.
// Two reads can race on the first read of a day (SessionStart hook + statusline). An exclusive create of
// .rollover-<today> picks one winner; the loser skips the append and the write, and waits for the winner's state.
// A loser that waits ~2 s without a new date treats the marker as stale (winner crashed) and rolls over itself.
export function load(now = new Date()) {
  const { config, warnings } = readConfig();
  const { state, notice } = readState(now);
  const today = localDate(now);
  const r = rollover(state, config, today);
  if (!state.date || r.state === state) return { config, warnings, notice, today, state: r.state }; // a fresh home stays empty until the first add
  const marker = `.rollover-${today}`;
  try {
    fs.closeSync(fs.openSync(file(marker), 'wx'));
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Wait for the winner's write, so a later save here is not overwritten by it. Give up after ~2 s (winner crashed).
    for (let t = 0; t < 200; t++) {
      const again = readState(now).state;
      if (again.date === today) return { config, warnings, notice, today, state: again };
      nap(10);
    }
    // The marker is stale: take over. The locked re-read makes a late winner or a second loser a no-op.
    return { config, warnings, notice, today, state: rollLocked(state, config, today) ?? r.state };
  }
  for (const f of fs.readdirSync(home()))
    if (f.startsWith('.rollover-') && f < marker) fs.rmSync(file(f), { force: true });
  return { config, warnings, notice, today, state: rollLocked(state, config, today) ?? r.state };
}

// Rolls the state as saved right now and saves it under the lock. The history line is skipped when one for
// that date is already there (a takeover after a crash between the append and the save). Null: unreadable file.
function rollLocked(fallback, config, today) {
  return updateState(fallback, s => {
    const r = rollover(s, config, today);
    if (r.historyLine && !historyHas(r.historyLine.date)) appendHistory(r.historyLine);
    return r;
  })?.state;
}

function historyHas(date) {
  let text;
  try {
    text = fs.readFileSync(file('history.jsonl'), 'utf8');
  } catch {
    return false;
  }
  return text.split('\n').some(l => {
    try {
      return JSON.parse(l).date === date;
    } catch {
      return false;
    }
  });
}

// ---- Notifications ------------------------------------------------------------
// Argument arrays only: task text never reaches a shell. osascript reads it from argv, not from the script.
/** @type {Array<[string, (text: string) => string[]]>} */
const NOTIFIERS = [
  [
    'osascript',
    text => [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 1 of argv) with title "today"',
      '-e',
      'end run',
      text,
    ],
  ],
  ['notify-send', text => ['today', text]],
];

// First tool that works wins (a missing one throws ENOENT). None: the line goes to stdout. Never throws.
export function notify(text) {
  for (const [cmd, args] of NOTIFIERS) {
    try {
      execFileSync(cmd, args(text), { stdio: 'ignore', timeout: 5000 });
      return cmd;
    } catch {
      /* try the next one */
    }
  }
  process.stdout.write(text + '\n');
  return null;
}

// ---- Daemon (opt-in reminders outside Claude Code) ------------------------------
// A generated file, not a process we own. It runs `node <abs>/bin/today.mjs nudge --notify` on a timer.
// TODAY_DAEMON_DIR moves the files (tests); the real locations are the ones launchd and systemd read.
const LABEL = 'dev.today.nudge';
const UNIT = 'today-nudge';
const SCRIPT = fileURLToPath(new URL('../bin/today.mjs', import.meta.url));
const daemonDir = platform =>
  process.env.TODAY_DAEMON_DIR ||
  (platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'LaunchAgents')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user'));
const SCHEDULER = { darwin: 'launchctl', linux: 'systemctl' };

export const daemonFiles = platform =>
  platform === 'darwin'
    ? [path.join(daemonDir(platform), `${LABEL}.plist`)]
    : [path.join(daemonDir(platform), `${UNIT}.service`), path.join(daemonDir(platform), `${UNIT}.timer`)];

const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const sdq = s => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
// ExecStart= also expands $VAR, so a literal $ is written $$ there.
const sdqExec = s => sdq(s).split('$').join('$$');
const unsdq = s => s.slice(1, -1).replace(/\$\$/g, '$').replace(/%%/g, '%').replace(/\\(.)/g, '$1');

function daemonText(platform, minutes) {
  const todayHome = process.env.TODAY_HOME;
  if (platform === 'darwin') {
    const env = todayHome
      ? `  <key>EnvironmentVariables</key>\n  <dict>\n    <key>TODAY_HOME</key>\n    <string>${xml(todayHome)}</string>\n  </dict>\n`
      : '';
    return [
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(SCRIPT)}</string>
    <string>nudge</string>
    <string>--notify</string>
  </array>
  <key>StartInterval</key>
  <integer>${minutes * 60}</integer>
${env}</dict>
</plist>
`,
    ];
  }
  return [
    `[Unit]
Description=today: nudge about open must-dos

[Service]
Type=oneshot
ExecStart=${sdqExec(process.execPath)} ${sdqExec(SCRIPT)} nudge --notify
${todayHome ? `Environment=${sdq(`TODAY_HOME=${todayHome}`)}\n` : ''}`,
    `[Unit]
Description=today: nudge about open must-dos

[Timer]
OnActiveSec=1min
OnUnitActiveSec=${minutes}min
Unit=${UNIT}.service

[Install]
WantedBy=timers.target
`,
  ];
}

// [node, script] from an installed job file, or null when none is installed.
export function daemonPaths(platform = process.platform) {
  if (!SCHEDULER[platform]) return null;
  try {
    const text = fs.readFileSync(daemonFiles(platform)[0], 'utf8');
    if (platform === 'darwin') {
      const args = [...text.match(/<array>([\s\S]*?)<\/array>/)[1].matchAll(/<string>(.*)<\/string>/g)];
      return args.slice(0, 2).map(m => unxml(m[1]));
    }
    return text
      .match(/^ExecStart=(.*)$/m)[1]
      .match(/"(?:[^"\\]|\\.)*"/g)
      .slice(0, 2)
      .map(unsdq);
  } catch {
    return null;
  }
}

const tryRun = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
};
const noScheduler = {
  ok: false,
  lines: ["Can't schedule reminders outside Claude Code.", 'Use macOS or Linux with systemd to turn them on.'],
};
const launchTarget = () => `gui/${process.getuid()}`;

// -> {ok, lines}. Replaces an earlier install, so running it again picks up a new path or interval.
export function daemonInstall(minutes, platform = process.platform) {
  const tool = SCHEDULER[platform];
  if (!tool || !hasTool(tool)) return noScheduler;
  // A line break would end a unit file line and start a new directive.
  if ([process.env.TODAY_HOME, process.execPath, SCRIPT].some(v => /[\r\n]/.test(v ?? ''))) {
    return { ok: false, lines: ["Can't set up reminders for a path with a line break in it."] };
  }
  const files = daemonFiles(platform);
  fs.mkdirSync(path.dirname(files[0]), { recursive: true });
  daemonText(platform, minutes).forEach((text, i) => {
    fs.writeFileSync(files[i], text);
  });
  const loaded =
    platform === 'darwin'
      ? (tryRun(tool, ['bootout', `${launchTarget()}/${LABEL}`]), tryRun(tool, ['bootstrap', launchTarget(), files[0]]))
      : tryRun(tool, ['--user', 'daemon-reload']) && tryRun(tool, ['--user', 'enable', '--now', `${UNIT}.timer`]);
  const wrote = files.map(f => `Wrote ${f}.`);
  if (!loaded)
    return { ok: false, lines: [...wrote, `Can't load it with ${tool}.`, 'Run today daemon remove to undo it.'] };
  return {
    ok: true,
    lines: [
      'Turned on reminders outside Claude Code.',
      ...wrote,
      `Loaded it with ${tool}.`,
      `Scheduled a nudge check every ${minutes} minutes.`,
      'Turn them off with today daemon remove.',
    ],
  };
}

export function daemonRemove(platform = process.platform) {
  const tool = SCHEDULER[platform];
  if (!tool) return noScheduler;
  const files = daemonFiles(platform).filter(f => fs.existsSync(f));
  if (!files.length) return { ok: true, lines: ['Found no reminders outside Claude Code to remove.'] };
  if (platform === 'darwin') tryRun(tool, ['bootout', `${launchTarget()}/${LABEL}`]);
  else tryRun(tool, ['--user', 'disable', '--now', `${UNIT}.timer`]);
  for (const f of files) fs.rmSync(f, { force: true });
  if (platform !== 'darwin') tryRun(tool, ['--user', 'daemon-reload']);
  return { ok: true, lines: ['Turned off reminders outside Claude Code.', ...files.map(f => `Deleted ${f}.`)] };
}

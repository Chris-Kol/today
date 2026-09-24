#!/usr/bin/env node
// Single CLI entry. Hooks, statusline and slash commands all call it.
import fs from 'node:fs';
import path from 'node:path';
import {
  home,
  readConfig,
  readState,
  hasTool,
  load,
  updateState,
  notify,
  daemonInstall,
  daemonRemove,
  daemonPaths,
} from '../src/io.mjs';
import { addTask, editList, markDone, todayView, updateStreak, nudge, sessionStart, isWorkDay } from '../src/core.mjs';
import { stages } from '../src/creature.mjs';
import * as animate from '../src/animate.mjs';

const HELP = `Run today <command>.

Pick 1-3 must-dos each morning.
Finish them to keep your streak.

  plan                    Pick today's must-dos
  add <category> <text>   Add a must-do
  edit [<n> <change>]     Change today's list
  done [n] [--quiet]      Mark a must-do done
  status                  Show today's progress
  statusline              Show the one-line summary
  off [reason]            Take today off
  on                      Undo a day off
  nudge [--notify]        Show a nudge when one is due
  session-start           Show the line for a new session
  daemon install|remove   Schedule reminders outside Claude Code
  doctor                  Check your setup
`;

function doctor() {
  const out = ['Check settings'];
  const { warnings, found, readable } = readConfig();
  if (readable) out.push(`  Read ${path.join(home(), 'config.json')}.`);
  else if (!found) out.push('  Found no config.json.\n  Using defaults.');
  for (const w of warnings) out.push(`  ${w}`);

  out.push('Check saved plan');
  const stateFile = path.join(home(), 'state.json');
  const exists = fs.existsSync(stateFile);
  const { state, notice } = readState();
  out.push(`  ${notice ?? (exists ? `Read ${stateFile}.` : 'Found no saved plan yet.')}`);
  if (notice && state.notices) {
    // shown now, so the next command does not repeat it
    try {
      save(state, clearNotices);
    } catch {
      /* the notice shows again next time */
    }
  }

  out.push('Check tools');
  out.push(hasTool('gh') ? '  Found gh.' : "  Can't find gh.\n  Install it from https://cli.github.com.");
  const notifier = ['osascript', 'notify-send'].find(hasTool);
  out.push(
    notifier
      ? `  Found ${notifier} for notifications.`
      : "  Can't send notifications outside Claude Code.\n  Install notify-send to turn them on.",
  );
  const scheduler = ['launchctl', 'systemctl'].find(hasTool);
  out.push(
    scheduler
      ? `  Found ${scheduler} for background reminders.`
      : "  Can't schedule reminders outside Claude Code.\n  Use macOS or Linux with systemd to turn them on.",
  );
  const job = daemonPaths();
  const gone = job?.find(p => !fs.existsSync(p));
  if (gone) out.push(`  Can't find ${gone} for reminders outside Claude Code.\n  Run today daemon install to fix it.`);
  else if (job) out.push(`  Found reminders outside Claude Code at ${job[1]}.`);
  process.stdout.write(out.join('\n') + '\n');
}

// Every verb saves through updateState: fn gets the state as saved right now, so a hook's or another
// verb's save in between is kept. An unreadable file there throws, and the verb says it can't save.
function save(state, fn) {
  const r = updateState(state, fn);
  if (!r) throw new Error('state.json is unreadable');
  return r;
}
const clearNotices = s => {
  if (!s.notices) return { state: s };
  const { notices: _, ...rest } = s;
  return { state: rest };
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function render(v) {
  if (!v.workDay) {
    return [
      'Enjoy your day off.',
      ...(v.tasks.length ? [`Kept ${plural(v.tasks.length, 'must-do')} for your next work day.`] : []),
    ];
  }
  const add = 'Add each one with today add <category> <text>.';
  if (!v.tasks.length)
    return [`Pick up to ${plural(v.maxTasks, 'must-do')}.`, add, `Use a category: ${v.categories.join(', ')}.`];
  const out = [v.tasks.every(t => t.done) ? 'Finished every must-do today.' : "Finish today's must-dos."];
  for (const t of v.tasks)
    out.push(`  ${t.n}. ${t.done ? '✓' : '○'} ${t.text} (${t.category}${t.carried ? ', carried' : ''})`);
  if (v.slots && v.tasks.every(t => t.carried)) out.push(`Add up to ${v.slots} more with today add <category> <text>.`);
  out.push(`${v.glyph} ${v.streak ? `Keep your ${v.streak}-day streak going.` : 'Start a streak today.'}`);
  return out;
}

// "2 throw 3 text 'new words' 1 category dx" -> core ops. Numbers are as shown before the edit.
function parseEdit(args) {
  const ops = [];
  for (let i = 0; i < args.length; ) {
    const raw = args[i++];
    const n = /^\d+$/.test(raw) ? Number(raw) : raw; // core echoes a non-number back as typed
    const word = args[i++];
    if (word === 'text') ops.push({ n, op: 'edit', text: args[i++] ?? '' });
    else if (word === 'category') ops.push({ n, op: 'edit', category: args[i++] ?? '' });
    else ops.push({ n, op: word ?? 'keep' });
  }
  return ops;
}

// load() plus the notices a command shows once.
function loadShown() {
  let { config, warnings, notice, today, state } = load();
  const notices = [...new Set([notice, ...(state.notices ?? []), ...warnings])].filter(Boolean);
  if (state.notices) state = save(state, clearNotices).state; // shown now, so clear the ones a statusline read left waiting
  return { config, today, state, notices };
}

function planVerb(cmd, args, json) {
  let { config, today, state, notices } = loadShown();
  let error = null;
  let head = [];
  if (cmd === 'add' || (cmd === 'edit' && args.length)) {
    const r = save(state, s =>
      cmd === 'add' ? addTask(s, config, args.slice(1).join(' '), args[0]) : editList(s, parseEdit(args), config),
    );
    error = r.error;
    state = r.state;
    if (!error) {
      head = [cmd === 'add' ? `Added: ${state.tasks.at(-1).text}` : 'Saved your list.'];
    }
  } else if (cmd === 'edit') {
    head = [
      'Change a must-do with today edit <n> <change>.',
      'Use keep, throw, text <new text>, or category <name> as the change.',
    ];
  }
  const v = todayView(state, config, today);
  if (error) process.exitCode = 1;
  if (json) return process.stdout.write(JSON.stringify({ ...v, error, notices }) + '\n');
  if (error) return process.stderr.write([...notices, error].join('\n') + '\n');
  process.stdout.write([...notices, ...head, ...render(v)].join('\n') + '\n');
}

async function doneVerb(args, json, quiet) {
  let { config, today, state, notices } = loadShown();
  const raw = args[0];
  const r = save(state, s => ({
    ...markDone(s, raw === undefined ? null : /^\d+$/.test(raw) ? Number(raw) : raw, new Date().toISOString()),
    before: s,
  }));
  const marked = r.state.tasks.find((t, i) => t !== r.before.tasks[i]);
  state = r.state;
  const v = todayView(state, config, today);
  // Tomorrow's streak is what rollover will score for today: the streak rules, not a guess.
  const tomorrow = r.allDone ? updateStreak(state, config, today).streak : null;
  const message = r.allDone ? `Finished every must-do today.\nStreak will be ${tomorrow} tomorrow.` : null;
  if (r.error) process.exitCode = 1;
  if (json)
    return process.stdout.write(
      JSON.stringify({ ...v, error: r.error, notices, allDone: r.allDone, tomorrow, message }) + '\n',
    );
  if (r.error) return process.stderr.write([...notices, r.error].join('\n') + '\n');
  if (notices.length) process.stdout.write(notices.join('\n') + '\n');
  const opts = { quiet: quiet || config.quiet };
  if (r.allDone) await animate.allDone(stages[v.stage].art, v.creature, opts);
  else await animate.taskDone(marked.text, opts);
  // All done: the celebration line replaces the heading and the streak line.
  const list = render(v);
  process.stdout.write((r.allDone ? [...list.slice(1, -1), message] : list).join('\n') + '\n');
}

// Runs on every statusline refresh: never throws, prints nothing when anything goes wrong.
function statusline(json) {
  try {
    const { notice, config, today, state } = load();
    if (notice) return; // the notice is for a command the user runs, not the statusline
    const { summary } = todayView(state, config, today);
    process.stdout.write((json ? JSON.stringify({ line: summary }) : summary) + '\n');
  } catch {
    /* stay silent */
  }
}

// Hooks run on every prompt and session: never throw, print nothing when anything goes wrong.
function hook(cmd, notifyOut) {
  try {
    const now = new Date();
    const { notice, config, today, state } = load(now);
    if (notice) return; // the notice is for a command the user runs
    // Decide again on the state as saved right now, under the lock, so a verb's save in between is kept
    // and a second hook sees the first one's lastNudgeAt / sessionStartShown. Saved before printing.
    // The clock is read under the lock too: an earlier `now` would see the other hook's lastNudgeAt as future.
    const line = updateState(state, s =>
      cmd === 'nudge' ? nudge(s, config, new Date()) : sessionStart(s, today, config),
    )?.line;
    if (!line) return;
    if (notifyOut) notify(line);
    else process.stdout.write(line + '\n');
  } catch {
    /* stay silent */
  }
}

// off [reason] / on. The flag lives in state; rollover clears it at the next day.
function offVerb(cmd, args, json) {
  let { config, today, state, notices } = loadShown();
  const reason = args.join(' ').replace(/\s+/g, ' ').trim();
  let lines;
  if (cmd === 'off') {
    state = save(state, s => ({ state: { ...s, off: reason || true } })).state;
    // A non-work day has no nudges to pause.
    lines = [
      reason ? `Took today off: ${reason}.` : 'Took today off.',
      ...(isWorkDay(today, config) ? ['Paused nudges until tomorrow.'] : []),
      'Undo it with today on.',
    ];
  } else {
    const r = save(state, s => {
      if (!s.off) return { state: s };
      const { off: _, ...rest } = s;
      return { state: rest, undone: true };
    });
    state = r.state;
    lines = r.undone ? null : ['Found no day off to undo.'];
  }
  const v = todayView(state, config, today);
  if (!lines) lines = [...(v.workDay ? ['Resumed nudges for today.'] : []), ...render(v)];
  if (json) return process.stdout.write(JSON.stringify({ ...v, notices }) + '\n');
  process.stdout.write([...notices, ...lines].join('\n') + '\n');
}

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const quiet = argv.includes('--quiet');
const [cmd, ...args] = argv.filter(a => a !== '--json' && a !== '--quiet');
if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
  process.stdout.write(HELP);
} else if (cmd === 'doctor') {
  doctor();
} else if (cmd === 'statusline') {
  process.stdout.on('error', () => {}); // a reader that closed early (EPIPE) must not turn into exit 1
  statusline(json);
} else if (['plan', 'status', 'add', 'edit'].includes(cmd)) {
  try {
    planVerb(cmd, args, json);
  } catch {
    process.stderr.write("Can't save your plan.\nRun today doctor to check your setup.\n");
    process.exitCode = 1;
  }
} else if (cmd === 'done') {
  doneVerb(args, json, quiet).catch(() => {
    process.stderr.write("Can't save your plan.\nRun today doctor to check your setup.\n");
    process.exitCode = 1;
  });
} else if (cmd === 'nudge' || cmd === 'session-start') {
  process.stdout.on('error', () => {}); // same as statusline
  hook(cmd, args.includes('--notify'));
} else if (cmd === 'off' || cmd === 'on') {
  try {
    offVerb(cmd, args, json);
  } catch {
    process.stderr.write("Can't save your plan.\nRun today doctor to check your setup.\n");
    process.exitCode = 1;
  }
} else if (cmd === 'daemon' && ['install', 'remove'].includes(args[0])) {
  try {
    const r = args[0] === 'install' ? daemonInstall(readConfig().config.nudgeEveryMinutes) : daemonRemove();
    (r.ok ? process.stdout : process.stderr).write(r.lines.join('\n') + '\n');
    if (!r.ok) process.exitCode = 1;
  } catch {
    process.stderr.write("Can't write the reminder files.\nRun today doctor to check your setup.\n");
    process.exitCode = 1;
  }
} else if (cmd === 'daemon') {
  process.stderr.write('Run today daemon install or today daemon remove.\n');
  process.exitCode = 1;
} else {
  process.stderr.write(`Can't find command: ${cmd}\nRun today --help to see commands.\n`);
  process.exitCode = 1;
}

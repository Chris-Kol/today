// Pure core: plain objects in, new objects out. No fs, no clock.
import { stages, resetMessage } from './creature.mjs';

export const defaultConfig = Object.freeze({
  categories: ['company', 'dx'],
  workHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  nudgeEveryMinutes: 45,
  maxTasks: 3,
  quiet: false,
  carryOver: true,
});

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const valid = {
  categories: v => Array.isArray(v) && v.length > 0 && v.every(c => typeof c === 'string' && c.trim() !== ''),
  workHours: v =>
    HHMM.test(v.start) &&
    HHMM.test(v.end) &&
    v.start < v.end &&
    Array.isArray(v.days) &&
    v.days.length > 0 &&
    v.days.every(d => Number.isInteger(d) && d >= 1 && d <= 7),
  nudgeEveryMinutes: v => Number.isInteger(v) && v > 0,
  maxTasks: v => Number.isInteger(v) && v >= 1 && v <= 9,
  quiet: v => typeof v === 'boolean',
  carryOver: v => typeof v === 'boolean',
};

const DAYS = [undefined, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayRange = d =>
  d.every((x, i) => i === 0 || x === d[i - 1] + 1) && d.length > 2
    ? `${DAYS[d[0]]} to ${DAYS[d.at(-1)]}`
    : d.map(x => DAYS[x]).join(', ');

// Each default in plain words, for warnings.
const plain = {
  categories: v => v.join(', '),
  workHours: v => `${v.start} to ${v.end}, ${dayRange(v.days)}`,
  nudgeEveryMinutes: v => `a nudge every ${v} minutes`,
  maxTasks: v => `up to ${v} must-dos`,
  quiet: v => (v ? 'no done animation' : 'the done animation'),
  carryOver: v => (v ? 'carry-over for unfinished must-dos' : 'no carry-over'),
};

const MAX_NUDGE = 1440;

// Per-key fallback: a bad key gets its default and one warning line; other keys are kept.
export function normalizeConfig(raw) {
  /** @type {Record<string, any>} */
  const config = structuredClone(defaultConfig);
  const warnings = [];
  if (raw == null) return { config, warnings };
  if (!isObj(raw)) return { config, warnings: ['Ignored config.json. Using defaults.'] };
  for (const key of Object.keys(valid)) {
    if (!(key in raw)) continue;
    let v = raw[key];
    if (key === 'workHours') v = isObj(v) ? { ...defaultConfig.workHours, ...v } : {};
    // A day at most: launchd's StartInterval needs a sane integer (1e21 would print as 6e+22).
    if (key === 'nudgeEveryMinutes' && valid[key](v) && v > MAX_NUDGE) {
      config[key] = MAX_NUDGE;
      warnings.push(`Ignored ${key} in config.json. Using ${plain[key](MAX_NUDGE)}.`);
    } else if (valid[key](v)) config[key] = structuredClone(v);
    else warnings.push(`Ignored ${key} in config.json. Using ${plain[key](defaultConfig[key])}.`);
  }
  return { config, warnings };
}

// ponytail: minimal state shape; later groups add fields (streak, off, lastNudgeAt...).
export const emptyState = () => ({ date: null, tasks: [] });
// Counters may be missing (older state) but never junk: stages[stage] and the streak line read them unchecked.
const count = (v, max = Infinity) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= max);
export const isValidState = s =>
  isObj(s) && Array.isArray(s.tasks) && count(s.streak) && count(s.best) && count(s.stage, stages.length - 1);

// ---- Daily plan -------------------------------------------------------------
// Dates are local 'YYYY-MM-DD' strings supplied by io. Work days use 1 = Monday ... 7 = Sunday.

export const isWorkDay = (date, config) =>
  config.workHours.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay() || 7);

export const glyphFor = stage => stages[stage].glyph;

const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// ---- Streak and creature ----------------------------------------------------

// Streak needed for each stage. Length matches the creature table in src/creature.mjs.
export const THRESHOLDS = [0, 3, 7, 14, 30, 60];

// A reset drops one stage, never below 0. Otherwise the stage only climbs.
export const stageFor = (streak, prevStage, wasReset) =>
  wasReset
    ? Math.max(0, prevStage - 1)
    : Math.max(
        prevStage,
        THRESHOLDS.findLastIndex(t => streak >= t),
      );

// Scores state.date (its plan, or its off flag) and every day after it up to yesterday.
// Those later days had no plan, so each work day among them resets. Non-work days and days off never count.
// Only a streak above 0 dropping to 0 is a reset: one broken streak costs one stage and one message.
export function updateStreak(state, config, yesterday) {
  if (!state.date || state.date > yesterday) return state;
  let streak = state.streak ?? 0,
    stage = state.stage ?? 0,
    best = state.best ?? 0,
    wasReset = false;
  for (let day = state.date; day <= yesterday; day = addDays(day, 1)) {
    const first = day === state.date;
    if ((first && state.off) || !isWorkDay(day, config)) continue;
    if (first && state.tasks.length && state.tasks.every(t => t.done)) {
      stage = stageFor(++streak, stage, false);
      best = Math.max(best, streak);
    } else if (streak > 0) {
      streak = 0;
      stage = stageFor(0, stage, true);
      wasReset = true;
    }
  }
  const next = { ...state, streak, best, stage };
  if (wasReset) next.notices = [...(state.notices ?? []), resetMessage(stage)];
  return next;
}

const cleanText = t =>
  String(t ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const badCategory = (c, config) =>
  `${c ? `Can't use category ${c}.\n` : ''}Pick one of these: ${config.categories.join(', ')}.`;

export function addTask(state, config, text, category) {
  text = cleanText(text);
  if (state.tasks.length >= config.maxTasks)
    return { state, error: `Can't add more than ${config.maxTasks} must-dos a day.` };
  if (!config.categories.includes(category)) return { state, error: badCategory(category, config) };
  if (!text) return { state, error: 'Write what the must-do is.' };
  return { state: { ...state, tasks: [...state.tasks, { text, category, done: false }] }, error: null };
}

// ops: [{n, op: 'keep'|'throw'|'edit', text?, category?}], n as shown before the edit. All or nothing.
export function editList(state, ops, config) {
  const tasks = state.tasks.map(t => ({ ...t }));
  const thrown = new Set();
  for (const { n, op, text, category } of ops) {
    const t = tasks[n - 1];
    if (!Number.isInteger(n) || !t) return { state, error: `Can't find must-do ${n}.` };
    if (op === 'throw') thrown.add(t);
    else if (op === 'edit' && (text !== undefined || category !== undefined)) {
      if (text !== undefined) {
        if (!cleanText(text)) return { state, error: 'Write what the must-do is.' };
        t.text = cleanText(text);
      }
      if (category !== undefined) {
        if (!config.categories.includes(category)) return { state, error: badCategory(category, config) };
        t.category = category;
      }
    } else if (op !== 'keep') return { state, error: `Can't ${op} a must-do.\nUse keep, throw, text, or category.` };
  }
  return { state: { ...state, tasks: tasks.filter(t => !thrown.has(t)) }, error: null };
}

// n: number as shown, or null for "the only open one". at: ISO time from io. allDone: this mark closed the day.
export function markDone(state, n, at) {
  const fail = error => ({ state, error, allDone: false });
  if (!state.tasks.length) return fail('Add your must-dos first: today plan.');
  const open = state.tasks.flatMap((t, i) => (t.done ? [] : [i + 1]));
  if (n == null) {
    if (!open.length) return fail('Finished every must-do already.');
    if (open.length > 1)
      return fail(
        `Pick which must-do is done: ${open.slice(0, -1).join(', ')} or ${open.at(-1)}.\nRun today done <n>.`,
      );
    n = open[0];
  }
  const t = Number.isInteger(n) && state.tasks[n - 1];
  if (!t) return fail(`Can't find must-do ${n}.`);
  if (t.done) return fail(`Finished ${t.text} already.`);
  const tasks = state.tasks.map((x, i) => (i === n - 1 ? { ...x, done: true, doneAt: at } : x));
  return { state: { ...state, tasks }, error: null, allDone: open.length === 1 };
}

// Idempotent: compares dates, so every read on the same day after the first is a no-op.
export function rollover(state, config, today) {
  if (!state.date) return { state: { ...state, date: today }, historyLine: null };
  if (state.date >= today) return { state, historyLine: null };
  const { off, ...rest } = updateStreak(state, config, addDays(today, -1));
  // Non-work days only hold tasks: no history line. A day off writes one line marked off.
  const historyLine = off
    ? { date: state.date, tasks: state.tasks, off: true }
    : isWorkDay(state.date, config) && state.tasks.length > 0
      ? { date: state.date, tasks: state.tasks, allDone: state.tasks.every(t => t.done) }
      : null;
  const tasks = config.carryOver ? state.tasks.filter(t => !t.done).map(t => ({ ...t, carried: true })) : [];
  return { state: { ...rest, date: today, tasks }, historyLine };
}

// ---- Reminders ----------------------------------------------------------------

// Local calendar day as YYYY-MM-DD. `now` comes from io; core never reads the clock.
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const minutesOf = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const openLine = state => {
  const open = state.tasks.flatMap((t, i) => (t.done ? [] : [`${i + 1}. ${t.text}`]));
  return open.length ? `Finish today's must-dos: ${open.join(' · ')}` : null;
};

// One line when a work day is on, a task is open, and nudgeEveryMinutes passed since lastNudgeAt.
export function nudge(state, config, now) {
  const quiet = { line: null, state };
  const mins = now.getHours() * 60 + now.getMinutes();
  const { start, end } = config.workHours;
  if (state.off || !isWorkDay(localDate(now), config)) return quiet;
  if (mins < minutesOf(start) || mins >= minutesOf(end)) return quiet;
  const last = Date.parse(state.lastNudgeAt); // one in the future (clock moved back) counts as none
  if (last <= now && now - last < config.nudgeEveryMinutes * 6e4) return quiet;
  const list = openLine(state);
  if (!list) return quiet;
  const left = minutesOf(end) - mins;
  return {
    line: `${list} · ${left >= 60 ? `${Math.floor(left / 60)}h` : `${left}m`} left`,
    state: { ...state, lastNudgeAt: now.toISOString() },
  };
}

// Open tasks: one line every session. No plan: one line, once a day (sessionStartShown).
export function sessionStart(state, today, config) {
  const quiet = { line: null, state };
  if (state.off || !isWorkDay(today, config)) return quiet;
  if (state.tasks.length) return { line: openLine(state), state };
  if (state.sessionStartShown === today) return quiet;
  return { line: 'Pick your must-dos with /today:plan.', state: { ...state, sessionStartShown: today } };
}

const trunc = (s, n) => (s.length <= n ? s : n < 1 ? '' : s.slice(0, n - 1) + '…');

// width caps the whole line. Order of sacrifice: task text, then the task list; creature and streak stay.
export function summaryLine(state, stage = 0, width = 80, off = false) {
  const head = `${glyphFor(stage)} `;
  const tail = ` · streak ${state.streak ?? 0}`;
  const room = width - head.length - tail.length;
  const line = mid => head + trunc(mid, room) + tail;
  if (off) return line(typeof off === 'string' ? `off today · ${off}` : 'off today');
  const { tasks } = state;
  if (!tasks.length) return line('plan your must-dos: /today:plan');
  // Largest per-task text cap that fits; short texts keep their full length.
  const fixed = tasks.length * 2 + (tasks.length - 1) * 3; // "✓ " each, " · " between
  const longest = Math.max(...tasks.map(t => t.text.length));
  let cap = longest;
  while (cap > 0 && tasks.reduce((sum, t) => sum + Math.min(t.text.length, cap), 0) + fixed > room) cap--;
  if (cap >= Math.min(5, longest))
    return line(tasks.map(t => `${t.done ? '✓' : '○'} ${trunc(t.text, cap)}`).join(' · '));
  return line(`${tasks.filter(t => t.done).length}/${tasks.length} done`);
}

// Everything a caller needs to show today. Pure; the CLI prints it or emits it as JSON.
export function todayView(state, config, today) {
  const workDay = isWorkDay(today, config) && !state.off;
  const stage = state.stage ?? 0;
  return {
    date: today,
    workDay,
    needsPlan: workDay && !state.tasks.length, // carried tasks count as a plan
    slots: Math.max(0, config.maxTasks - state.tasks.length),
    maxTasks: config.maxTasks,
    categories: config.categories,
    tasks: state.tasks.map((t, i) => ({ n: i + 1, ...t })),
    streak: state.streak ?? 0,
    stage,
    glyph: glyphFor(stage),
    creature: stages[stage].name,
    art: stages[stage].art,
    summary: summaryLine(state, stage, 80, workDay ? false : state.off || true),
  };
}

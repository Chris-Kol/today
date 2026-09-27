// Pure stats over history lines plus today's state. No fs, no clock: io hands in raw lines and today's date.
import { addDays, cleanText, isWorkDay } from './core.mjs';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTask = t =>
  isObj(t) && typeof t.text === 'string' && typeof t.category === 'string' && typeof t.done === 'boolean';
// Round trip rejects 2026-13-40 and friends.
const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && addDays(d, 0) === d;

function parse(raw) {
  try {
    const o = JSON.parse(raw);
    return isObj(o) && isDate(o.date) && Array.isArray(o.tasks) && o.tasks.every(isTask) ? o : null;
  } catch {
    return null;
  }
}

// History is user-editable: strip control characters before any renderer sees text or category.
const clean = tasks => tasks.map(t => ({ ...t, text: cleanText(t.text), category: cleanText(t.category) }));

const outcomeOf = (tasks, off) =>
  off ? 'off' : tasks.length && tasks.every(t => t.done) ? 'all' : tasks.some(t => t.done) ? 'partial' : 'none';

// lines: raw history.jsonl lines. state: today's state after rollover. Returns every number the renderers show.
export function computeStats(lines, state, config, today) {
  const byDate = new Map();
  let skipped = 0;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const o = parse(raw);
    if (!o) skipped++;
    else byDate.set(o.date, { date: o.date, outcome: outcomeOf(o.tasks, o.off === true), tasks: clean(o.tasks) });
  }
  const empty = byDate.size === 0;
  const history = [...byDate.values()].filter(d => d.date !== today);
  const days = [...history];
  // Today is a day only when planned: a work day with a plan, or a day off (what rollover will write).
  if (state.off || (state.tasks.length && isWorkDay(today, config)))
    days.push({ date: today, outcome: outcomeOf(state.tasks, !!state.off), tasks: clean(state.tasks), today: true });
  days.sort((a, b) => (a.date < b.date ? 1 : -1));

  // Null-prototype counts so "constructor" or "__proto__" are plain names. Object key order can't be trusted
  // ("2026" sorts first), so `names` holds the order: config categories, then the rest case-insensitively
  // (code-unit order of the lowercased name, ties broken by the name itself, so no locale is involved).
  const zero = () => Object.assign(Object.create(null), Object.fromEntries(config.categories.map(c => [c, 0])));
  const [week, month, all] = [zero(), zero(), zero()];
  const weekStart = addDays(today, -6),
    monthStart = addDays(today, -29);
  for (const d of days)
    for (const t of d.tasks) {
      for (const w of [week, month, all]) w[t.category] ??= 0;
      if (!t.done) continue;
      all[t.category]++;
      if (d.date >= monthStart && d.date <= today) month[t.category]++;
      if (d.date >= weekStart && d.date <= today) week[t.category]++;
    }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const extra = Object.keys(all)
    .filter(c => !config.categories.includes(c))
    .sort((a, b) => cmp(a.toLowerCase(), b.toLowerCase()) || cmp(a, b));
  const categories = { names: [...config.categories, ...extra], week, month, all };

  const planned = history.filter(d => d.outcome !== 'off');
  const allDone = planned.filter(d => d.outcome === 'all').length;
  const current = state.streak ?? 0;
  return {
    categories,
    completion: { allDone, planned: planned.length, rate: planned.length ? allDone / planned.length : null },
    streak: { current, best: Math.max(state.best ?? 0, current) },
    daysOff: days.filter(d => d.outcome === 'off').length,
    days,
    skipped,
    empty,
  };
}

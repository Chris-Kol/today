// Test-only: deterministic history.jsonl in the v1 line shape. Exports only, so `node --test` loading it runs nothing.
import { addDays, isWorkDay } from '../../src/core.mjs';

// Counters run over work days (1-based): off beats none beats partial; the rest are all done.
// partial marks the first task done and the rest open, so it needs tasksPerDay >= 2.
export function makeHistory({
  start,
  days,
  workDays = [1, 2, 3, 4, 5],
  offEvery = 0,
  partialEvery = 0,
  noneEvery = 0,
  categories = ['company', 'dx'],
  tasksPerDay = 2,
}) {
  const config = { workHours: { days: workDays } };
  const lines = [];
  let w = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    if (!isWorkDay(date, config)) continue;
    w++;
    const hit = n => n > 0 && w % n === 0;
    const kind = hit(offEvery) ? 'off' : hit(noneEvery) ? 'none' : hit(partialEvery) ? 'partial' : 'all';
    const tasks = Array.from({ length: tasksPerDay }, (_, j) => {
      const done = kind === 'all' || (kind === 'partial' && j === 0);
      const t = { text: `task ${i}.${j}`, category: categories[(i + j) % categories.length], done };
      return done ? { ...t, doneAt: `${date}T10:00:00.000Z` } : t;
    });
    lines.push(
      JSON.stringify(
        kind === 'off' ? { date, tasks: [], off: true } : { date, tasks, allDone: tasks.every(t => t.done) },
      ),
    );
  }
  return lines.map(l => `${l}\n`).join('');
}

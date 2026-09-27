// Year grid: layout as data (shared with the HTML dashboard), then plain text. Pure.
import { addDays } from '../core.mjs';

// [character, label] per outcome, in legend order. null is a day with no line.
export const LEGEND = [
  ['█', 'all done'],
  ['▓', 'some done'],
  ['░', 'none done'],
  ['·', 'day off'],
  [' ', 'no plan'],
];
const CHAR = { all: '█', partial: '▓', none: '░', off: '·' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = 'JFMAMJJASOND';

// 53 columns (weeks) of 7 cells (Monday first), ending with today's week. Days after today have no outcome.
export function gridCells(days, today) {
  const outcome = new Map(days.map(d => [d.date, d.outcome]));
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  const start = addDays(today, -(dow - 1) - 52 * 7);
  return Array.from({ length: 53 }, (_, c) =>
    Array.from({ length: 7 }, (_, r) => {
      const date = addDays(start, c * 7 + r);
      return { date, outcome: (date <= today && outcome.get(date)) || null };
    }),
  );
}

// Month initial above the first week that starts in a new month; 4 label columns + 53 weeks = 57 wide.
export function gridText(cells) {
  const month = col => Number(col[0].date.slice(5, 7));
  const header = cells.map((col, c) => (c === 0 || month(col) !== month(cells[c - 1]) ? MONTHS[month(col) - 1] : ' '));
  const rows = WEEKDAYS.map((name, r) => `${name} ${cells.map(col => CHAR[col[r].outcome] ?? ' ').join('')}`);
  const legend = LEGEND.map(([ch, label]) => `${ch === ' ' ? 'blank' : ch} ${label}`).join('   ');
  return [`    ${header.join('')}`.trimEnd(), ...rows, '', legend].join('\n');
}

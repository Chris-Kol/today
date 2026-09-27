// Dashboard: one self-contained HTML page from computeStats' result. Pure. No script, no URL, no font:
// every interpolated string goes through esc(), so history text can never become markup.
import { gridCells, LEGEND } from './grid.mjs';

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v).replace(/[&<>"']/g, c => ENT[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const LABEL = { all: LEGEND[0][1], partial: LEGEND[1][1], none: LEGEND[2][1], off: LEGEND[3][1], blank: LEGEND[4][1] };

// The number lines, shared with `today stats` so terminal and page say the same thing.
export function summaryLines(s) {
  const { allDone, planned, rate } = s.completion;
  return [
    rate === null
      ? 'Plan a work day to see how often one ends all done.'
      : `Finished every must-do on ${allDone} of ${plural(planned, 'planned day')} (${Math.round(rate * 100)}%).`,
    s.streak.current ? `Keep your ${s.streak.current}-day streak going.` : 'Start a streak today.',
    ...(s.streak.best ? [`Reached a best streak of ${plural(s.streak.best, 'day')}.`] : []),
    `Took ${plural(s.daysOff, 'day')} off.`,
  ];
}

const STEP = 12; // 10 px cell + 2 px gap: 53 weeks fit a 700 px card
const LEFT = 32; // weekday labels
const TOP = 16; // month initials

function gridSvg(days, today) {
  const cells = gridCells(days, today);
  const out = [];
  cells.forEach((col, c) => {
    const m = col[0].date.slice(5, 7);
    if (c === 0 || m !== cells[c - 1][0].date.slice(5, 7))
      out.push(`<text x="${LEFT + c * STEP}" y="11" class="axis">${esc('JFMAMJJASOND'[Number(m) - 1])}</text>`);
    col.forEach((cell, r) => {
      if (cell.date > today) return; // future days stay off the page
      const o = cell.outcome ?? 'blank';
      out.push(
        `<rect x="${LEFT + c * STEP}" y="${TOP + r * STEP}" width="10" height="10" rx="2" class="o-${o}"><title>${esc(cell.date)}: ${esc(LABEL[o])}</title></rect>`,
      );
    });
  });
  for (const [i, d] of ['Mon', 'Wed', 'Fri'].entries())
    out.push(`<text x="0" y="${TOP + i * 2 * STEP + 9}" class="axis">${d}</text>`);
  const w = LEFT + 53 * STEP,
    h = TOP + 7 * STEP;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Year grid">${out.join('')}</svg>`;
}

function barsSvg({ names, all }) {
  const rows = names.map(c => [c, all[c]]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  const labelW = 120,
    barW = 280,
    rowH = 24;
  const body = rows
    .map(([cat, n], i) => {
      const y = i * rowH;
      const w = n ? Math.max(4, Math.round((n / max) * barW)) : 0;
      return (
        `<text x="${labelW - 8}" y="${y + 15}" class="label" text-anchor="end">${esc(cat)}</text>` +
        `<rect x="${labelW}" y="${y + 4}" width="${w}" height="14" rx="4" class="bar"><title>${esc(cat)}: ${esc(n)}</title></rect>` +
        `<text x="${labelW + w + 6}" y="${y + 15}" class="label">${esc(n)}</text>`
      );
    })
    .join('');
  const h = Math.max(rowH, rows.length * rowH);
  return `<svg viewBox="0 0 ${labelW + barW + 48} ${h}" width="${labelW + barW + 48}" height="${h}" role="img" aria-label="Done must-dos by category, all time">${body}</svg>`;
}

function dayList(days) {
  return days
    .map(d => {
      const head = `<h3>${esc(d.date)}${d.today ? ' (today)' : ''}: ${esc(LABEL[d.outcome])}</h3>`;
      const tasks = d.tasks.length
        ? `<ul>${d.tasks
            .map(
              t =>
                `<li><span class="mark">${t.done ? '✓' : '○'}</span> ${esc(t.text)} <span class="cat">(${esc(t.category)})</span></li>`,
            )
            .join('')}</ul>`
        : '';
      return `<section class="day">${head}${tasks}</section>`;
    })
    .join('\n');
}

const legend = () =>
  `<ul class="legend">${Object.entries(LABEL)
    .map(([o, label]) => `<li><span class="swatch o-${o}"></span>${esc(label)}</li>`)
    .join('')}</ul>`;

const STYLE = `
:root {
  color-scheme: light dark;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781; --line: #e1e0d9;
  --all: #184f95; --partial: #3987e5; --none: #86b6ef; --off: #c3c2b7; --blank: #eeede8; --bar: #2a78d6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781; --line: #2c2c2a;
    --all: #9ec5f4; --partial: #3987e5; --none: #184f95; --off: #52514e; --blank: #262624; --bar: #3987e5;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 8px; }
h3 { font-size: 14px; margin: 16px 0 4px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; overflow-x: auto; }
.meta { color: var(--muted); margin: 0; }
.numbers { margin: 0; padding-left: 20px; }
svg { display: block; max-width: none; }
.axis { fill: var(--muted); font-size: 10px; }
.label { fill: var(--ink-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.bar { fill: var(--bar); }
.o-all { fill: var(--all); background: var(--all); }
.o-partial { fill: var(--partial); background: var(--partial); }
.o-none { fill: var(--none); background: var(--none); }
.o-off { fill: var(--off); background: var(--off); }
.o-blank { fill: var(--blank); background: var(--blank); }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 0; margin: 12px 0 0; color: var(--ink-2); font-size: 13px; }
.swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.day ul { list-style: none; margin: 0; padding: 0; }
.mark { display: inline-block; width: 1.2em; color: var(--ink-2); }
.cat { color: var(--muted); }
`;

export function dashboardHtml(stats, today) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>today stats</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Your year with today</h1>
<p class="meta">Made on ${esc(today)}.</p>
<h2>Numbers</h2>
<div class="card"><ul class="numbers">${summaryLines(stats)
    .map(l => `<li>${esc(l)}</li>`)
    .join('')}</ul></div>
<h2>Year</h2>
<div class="card">${gridSvg(stats.days, today)}${legend()}</div>
<h2>Done by category</h2>
<div class="card">${barsSvg(stats.categories)}</div>
<h2>Days</h2>
${dayList(stats.days)}
</main>
</body>
</html>
`;
}

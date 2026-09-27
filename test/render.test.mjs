import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridCells, gridText, LEGEND } from '../src/render/grid.mjs';
import { analyze } from '../scripts/voice-check.mjs';
import { dashboardHtml } from '../src/render/html.mjs';
import { computeStats } from '../src/stats.mjs';
import { defaultConfig } from '../src/core.mjs';
import { makeHistory } from './fixtures/history.mjs';

const width = s => [...s].length;
const day = (date, outcome) => ({ date, outcome, tasks: [] });

test('grid: 53 columns of 7, Monday first, today in the last column', () => {
  for (const [today, row] of [
    ['2026-09-21', 0], // Monday
    ['2026-09-27', 6], // Sunday
    ['2027-01-01', 4], // Friday
  ]) {
    const cells = gridCells([], today);
    assert.equal(cells.length, 53);
    assert.ok(cells.every(c => c.length === 7));
    assert.equal(cells[52][row].date, today, today);
    assert.equal(new Date(`${cells[0][0].date}T12:00:00Z`).getUTCDay(), 1, 'starts on a Monday');
  }
});

test('grid: known dates land in their cell', () => {
  const days = [day('2026-09-21', 'all'), day('2026-01-01', 'partial'), day('2025-09-22', 'off')];
  const cells = gridCells(days, '2026-09-27');
  assert.deepEqual(cells[52][0], { date: '2026-09-21', outcome: 'all' });
  assert.deepEqual(cells[0][0], { date: '2025-09-22', outcome: 'off' }); // 52 weeks before this Monday
  // 2026-01-01 is a Thursday, 14 weeks + 3 days after 2025-09-22.
  assert.deepEqual(cells[14][3], { date: '2026-01-01', outcome: 'partial' });
  assert.equal(cells[52][1].outcome, null);

  const ny = gridCells([day('2027-01-01', 'none'), day('2026-12-28', 'all')], '2027-01-01');
  assert.deepEqual(ny[52][4], { date: '2027-01-01', outcome: 'none' });
  assert.deepEqual(ny[52][0], { date: '2026-12-28', outcome: 'all' });
  assert.equal(ny[52][5].date, '2027-01-02'); // after today: no outcome
  assert.equal(ny[52][5].outcome, null);
  assert.equal(ny[0][0].date, '2025-12-29');
});

test('scenario: Grid layout', () => {
  const today = '2026-09-23'; // Wednesday
  const days = [day('2026-09-21', 'all'), day('2026-09-22', 'partial'), day(today, 'off')];
  const text = gridText(gridCells(days, today));
  const lines = text.split('\n');
  const rows = lines.slice(1, 8); // header, then Monday to Sunday
  const last = rows.map(r => [...r][4 + 52]);
  assert.deepEqual(last.slice(0, 3), [LEGEND[0][0], LEGEND[1][0], LEGEND[3][0]]);
  assert.deepEqual(last.slice(3), [' ', ' ', ' ', ' ']);
  assert.equal(LEGEND.length, 5);
  assert.equal(new Set(LEGEND.map(([ch]) => ch)).size, 5);
  for (const [ch, label] of LEGEND) assert.ok(text.includes(`${ch === ' ' ? 'blank' : ch} ${label}`), label);
  for (const l of lines) assert.ok(width(l) <= 80, l);
});

test('grid text: month initials on top, weekday labels on the side', () => {
  const lines = gridText(gridCells([], '2026-09-21')).split('\n');
  assert.equal(width(lines[1]), 57);
  assert.match(lines[1], /^Mon /);
  assert.match(lines[7], /^Sun /);
  // First column starts 2025-09-22: September.
  assert.equal([...lines[0]][4], 'S');
  assert.equal(lines[0].replace(/ /g, ''), 'SONDJFMAMJJAS');
});

test('voice: legend and labels pass voice-check hard rules', () => {
  const text = gridText(gridCells([day('2026-09-21', 'all')], '2026-09-21'));
  assert.deepEqual(analyze(text).hard, [], text);
});

// ---- 5. HTML dashboard ----

const HTML_TODAY = '2026-09-23'; // Wednesday
const fixtureStats = (extraLines = [], state = { date: HTML_TODAY, tasks: [], streak: 4, best: 9 }) =>
  computeStats(
    [
      ...makeHistory({ start: '2025-09-01', days: 387, offEvery: 9, partialEvery: 4, noneEvery: 13 }).split('\n'),
      ...extraLines,
    ],
    state,
    defaultConfig,
    HTML_TODAY,
  );

test('html: self-contained, no script, nothing from the network', () => {
  const html = dashboardHtml(fixtureStats(), HTML_TODAY);
  assert.match(html, /^<!doctype html>/);
  for (const bad of ['<script', 'http://', 'https://', 'src=', '@import', 'url(']) assert.ok(!html.includes(bad), bad);
  assert.match(html, /<style>/);
  assert.match(html, /<svg/);
  assert.match(html, /prefers-color-scheme: dark/);
});

test('html: grid hides days after today, day list is newest first', () => {
  const stats = fixtureStats();
  const html = dashboardHtml(stats, HTML_TODAY);
  const titles = [...html.matchAll(/<rect [^>]*><title>(\d{4}-\d{2}-\d{2})/g)].map(m => m[1]);
  assert.equal(titles.length, 52 * 7 + 3); // Monday to Wednesday of this week
  assert.ok(titles.every(d => d <= HTML_TODAY));
  const listed = [...html.matchAll(/<h3>(\d{4}-\d{2}-\d{2})/g)].map(m => m[1]);
  assert.equal(listed.length, stats.days.length);
  assert.deepEqual(listed, [...listed].sort().reverse());
});

test('html: numbers and categories match the stats', () => {
  const stats = fixtureStats();
  const html = dashboardHtml(stats, HTML_TODAY);
  const { allDone, planned } = stats.completion;
  assert.ok(html.includes(`${allDone} of ${planned} planned days`));
  assert.ok(html.includes('Keep your 4-day streak going.'));
  assert.ok(html.includes('Reached a best streak of 9 days.'));
  for (const [cat, n] of stats.categories.names.map(c => [c, stats.categories.all[c]]))
    assert.ok(html.includes(`>${cat}</text>`) && html.includes(`>${n}</text>`), cat);
});

test('html: bars follow categories.names, even for an integer-like name', () => {
  const line = JSON.stringify({ date: '2026-09-22', tasks: [{ text: 'x', category: '2026', done: true }] });
  const stats = fixtureStats([line]);
  assert.equal(Object.keys(stats.categories.all)[0], '2026'); // object order differs from names
  const bars = [...dashboardHtml(stats, HTML_TODAY).matchAll(/class="label" text-anchor="end">([^<]*)</g)];
  assert.deepEqual(
    bars.map(m => m[1]),
    stats.categories.names,
  );
});

test('scenario: Hostile task text, in task text and category', () => {
  const hostile = '<img src=x onerror=alert(1)> & "q"';
  const line = JSON.stringify({
    date: '2026-09-22',
    tasks: [{ text: hostile, category: hostile, done: true }],
    allDone: true,
  });
  const html = dashboardHtml(fixtureStats([line]), HTML_TODAY);
  const escaped = '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;';
  assert.ok(html.includes(`${escaped} <span class="cat">(${escaped})</span>`), 'task row');
  assert.ok(html.includes(`>${escaped}</text>`), 'category bar');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes(hostile));
  const apos = dashboardHtml(
    fixtureStats([JSON.stringify({ date: '2026-09-22', tasks: [{ text: "it's", category: 'dx', done: false }] })]),
    HTML_TODAY,
  );
  assert.ok(apos.includes('it&#39;s'));
});

test('voice: fixed strings in the HTML pass voice-check hard rules', () => {
  const html = dashboardHtml(fixtureStats([], { date: HTML_TODAY, tasks: [], off: true }), HTML_TODAY);
  const text = html
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n');
  assert.deepEqual(analyze(text).hard, [], text);
  const none = dashboardHtml(
    computeStats(
      [JSON.stringify({ date: '2026-09-22', tasks: [], off: true })],
      { date: HTML_TODAY, tasks: [] },
      defaultConfig,
      HTML_TODAY,
    ),
    HTML_TODAY,
  );
  assert.deepEqual(analyze(none.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, '\n')).hard, []);
});

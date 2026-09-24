import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskDone, allDone, TASK_FRAMES, ALL_DONE_FRAMES } from '../src/animate.mjs';
import { stages } from '../src/creature.mjs';

const ANSI = /\x1b\[/;
const fake = isTTY => {
  const out = { isTTY, chunks: [], write: s => out.chunks.push(s) };
  const slept = [];
  return {
    out,
    slept,
    sleep: async ms => {
      slept.push(ms);
    },
  };
};
const total = a => a.reduce((x, y) => x + y, 0);
const art = stages[2].art;

test('taskDone on a TTY writes every frame, clears with \\r and ANSI, and stays under 2 s', async () => {
  const f = fake(true);
  await taskDone('ship it', { out: f.out, sleep: f.sleep });
  assert.equal(f.out.chunks.length, TASK_FRAMES.length);
  assert.ok(TASK_FRAMES.length >= 3);
  assert.equal(f.slept.length, TASK_FRAMES.length - 1);
  assert.ok(total(f.slept) < 2000, `${total(f.slept)} ms`);
  assert.ok(total(f.slept) >= 1000, 'about 2 s, not a flash');
  assert.ok(f.out.chunks.slice(1).every(c => c.startsWith('\r') && ANSI.test(c)));
  assert.match(f.out.chunks.at(-1), /Marked done: ship it\n$/);
});

test('allDone on a TTY clears multi-line frames, shows the creature, stays under 4 s', async () => {
  const f = fake(true);
  await allDone(art, 'Chick', { out: f.out, sleep: f.sleep });
  assert.equal(f.out.chunks.length, ALL_DONE_FRAMES.length);
  assert.ok(total(f.slept) < 4000, `${total(f.slept)} ms`);
  assert.ok(total(f.slept) > 2000, 'longer than a task');
  assert.ok(f.out.chunks.slice(1).every(c => /^\r\x1b\[\d+A\x1b\[J/.test(c)));
  for (const line of art) assert.ok(f.out.chunks.at(-1).includes(line));
});

test('non-TTY prints only the final frame with no ANSI and no sleeping', async () => {
  for (const play of [o => taskDone('ship it', o), o => allDone(art, 'Chick', o)]) {
    const f = fake(false);
    await play({ out: f.out, sleep: f.sleep });
    assert.equal(f.out.chunks.length, 1);
    assert.doesNotMatch(f.out.chunks[0], ANSI);
    assert.doesNotMatch(f.out.chunks[0], /\r/);
    assert.deepEqual(f.slept, []);
  }
  const f = fake(false);
  await allDone(art, 'Chick', { out: f.out, sleep: f.sleep });
  assert.match(f.out.chunks[0], /Watch Chick do a little dance\.\n$/);
});

test('quiet skips the animation entirely', async () => {
  for (const isTTY of [true, false]) {
    const f = fake(isTTY);
    await taskDone('x', { out: f.out, sleep: f.sleep, quiet: true });
    await allDone(art, 'Chick', { out: f.out, sleep: f.sleep, quiet: true });
    assert.deepEqual(f.out.chunks, []);
    assert.deepEqual(f.slept, []);
  }
});

test('default sleep uses real timers and finishes under the limit', async () => {
  const out = { isTTY: true, write() {} };
  const t = Date.now();
  await taskDone('x', { out });
  assert.ok(Date.now() - t < 2000);
});

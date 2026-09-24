// Done animations: frames in a table, redrawn in place with \r and ANSI clear.
// Non-TTY (a pipe, a hook, Claude Code's ! command) gets the final frame only, no ANSI.
const wait = ms => new Promise(r => setTimeout(r, ms));

// [text, ms to hold before the next frame]. The last frame's ms is never slept.
export const TASK_FRAMES = [
  ['◔', 300],
  ['◑', 300],
  ['◕', 300],
  ['●', 300],
  ['✓', 0],
];

const CONFETTI = ['  *    .   ', ' .   *    *', '*   .   *  ', '  .   *   .'];
// Each frame: [confetti row, sway in spaces, ms]. The creature sways under falling confetti.
export const ALL_DONE_FRAMES = [
  [0, 0, 400],
  [1, 1, 400],
  [2, 2, 400],
  [3, 1, 400],
  [0, 0, 400],
  [1, 1, 400],
  [2, 2, 400],
  [3, 0, 0],
];

async function play(frames, { out = process.stdout, quiet = false, sleep = wait } = {}) {
  if (quiet) return;
  if (!out.isTTY) return void out.write(frames.at(-1)[0] + '\n');
  let prevLines = 0;
  for (const [i, [text, ms]] of frames.entries()) {
    // \r to column 0, up to the frame's first line, clear to the end of the screen.
    out.write(
      (i ? `\r${prevLines > 1 ? `\x1b[${prevLines - 1}A` : ''}\x1b[J` : '') +
        text +
        (i === frames.length - 1 ? '\n' : ''),
    );
    prevLines = text.split('\n').length;
    if (i < frames.length - 1) await sleep(ms);
  }
}

export const taskDone = (text, opts) =>
  play(
    TASK_FRAMES.map(([g, ms], i, all) => [i === all.length - 1 ? `${g} Marked done: ${text}` : `${g} ${text}`, ms]),
    opts,
  );

// The one joke lives in the last line.
export const allDone = (art, name, opts) =>
  play(
    ALL_DONE_FRAMES.map(([c, sway, ms], i, all) => [
      [
        CONFETTI[c],
        ...art.map(l => ' '.repeat(sway) + l),
        i === all.length - 1 ? `Watch ${name} do a little dance.` : '',
      ].join('\n'),
      ms,
    ]),
    opts,
  );

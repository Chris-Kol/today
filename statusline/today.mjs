#!/usr/bin/env node
// Claude Code statusLine command: prints the one-line summary. Same code path as `today statusline`.
// Claude Code sends session JSON on stdin; the summary does not need it.
process.argv.splice(2, Infinity, 'statusline');
try {
  await import('../bin/today.mjs');
} catch {
  /* stay silent */
}

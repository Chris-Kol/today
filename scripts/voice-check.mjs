#!/usr/bin/env node
// Mechanical prose linter: banned words, stock openers, idioms, sentence length. Not a judge.
// Usage: node scripts/voice-check.mjs <file.md>   Exit 1 on hard fails.
import fs from 'node:fs';

const BANNED = [
  'delve',
  'crucial',
  'pivotal',
  'landscape',
  'tapestry',
  'testament',
  'robust',
  'underscore',
  'showcase',
  'vibrant',
  'leverage',
  'seamless',
  'journey',
  'empower',
  'additionally',
  'ultimately',
  'in conclusion',
  'it is important to note',
  'game-changer',
  'game changer',
];
const OPENERS = [
  'buckle up',
  "let's dive in",
  'picture this',
  "here's the thing",
  'get this',
  'spill the beans',
  'without further ado',
];
const IDIOMS = [
  'like a boss',
  'silver lining',
  'in a heartbeat',
  'zero to sixty',
  'under their wing',
  'wild ride',
  'rollercoaster',
  'roller coaster',
  'the works',
  'no joke',
  'real mvp',
  'cheat code',
  'game changer',
  'hit the ground running',
  'move the needle',
  'low-hanging fruit',
  'at the end of the day',
];

export function stripCode(md) {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#!.*$/gm, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/^\|.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

export function analyze(md) {
  const text = stripCode(md);
  const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1].trim());
  const prose = text.replace(/^#{1,6}\s+.+$/gm, '').replace(/^\s*[-*]\s+/gm, '');
  const paragraphs = prose
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);
  const sentences = paragraphs
    .flatMap(p => p.split(/(?<=[.!?])\s+(?=[A-Z"'(])/))
    .map(s => s.trim())
    .filter(Boolean);
  const words = s => s.split(/\s+/).filter(Boolean).length;
  const wordCounts = sentences.map(words);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  const lower = prose.toLowerCase();
  const count = list =>
    list
      .map(w => [
        w,
        (lower.match(new RegExp(`\\b${w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'g')) || []).length,
      ])
      .filter(([, n]) => n > 0);
  const triplets = (prose.match(/\b\w+(?:\s\w+){0,3},\s\w+(?:\s\w+){0,3},?\s(?:and|or)\s\w+/g) || []).length;
  const notXbutY =
    (prose.match(/\b(?:not|isn't|wasn't|aren't) (?:just |only |merely )?[^.]{2,60}?[,.;] ?(?:but|it's|it is) /gi) || [])
      .length + (prose.match(/\bIt's not [^.]{2,60}\. It's /g) || []).length;
  const colonReveals = (
    prose.match(/\b(?:here's (?:the|what|how)|the thing is|picture this|get this|fast forward)\b[^.]*:/gi) || []
  ).length;
  const selfAnsweredQ = (prose.match(/\?\s+(?:Yeah|Yes|Nope|No)\b/g) || []).length;
  const exclamations = (prose.match(/!/g) || []).length;
  const emDashes = (prose.match(/—/g) || []).length;
  const colonHeadings = headings.filter(h => /:/.test(h)).length;
  const questionHeadings = headings.filter(h => /\?$/.test(h)).length;
  const paraLens = paragraphs.map(words);
  const mean = paraLens.reduce((a, b) => a + b, 0) / (paraLens.length || 1);
  const cv =
    paraLens.length > 1 ? Math.sqrt(paraLens.reduce((a, b) => a + (b - mean) ** 2, 0) / paraLens.length) / mean : 0;
  const idiomHits = count(IDIOMS);
  const idiomsPer1k = totalWords ? (idiomHits.reduce((a, [, n]) => a + n, 0) / totalWords) * 1000 : 0;
  const capsWords = (prose.match(/(?<![\w_.\/])[A-Z]{3,}(?![\w_.\/])/g) || []).filter(
    w =>
      ![
        'API',
        'CLI',
        'PHP',
        'JSON',
        'HTML',
        'CSS',
        'SQL',
        'AWS',
        'URL',
        'LMS',
        'LLM',
        'TDD',
        'ADR',
        'IDE',
        'PR',
        'CI',
      ].includes(w),
  ).length;
  const r = {
    words: totalWords,
    sentences: sentences.length,
    avgWordsPerSentence: sentences.length ? +(totalWords / sentences.length).toFixed(1) : 0,
    shortSentences: wordCounts.filter(n => n <= 5).length,
    longSentences: wordCounts.filter(n => n >= 25).length,
    paragraphs: paragraphs.length,
    paragraphLengthCV: +cv.toFixed(2),
    exclamations,
    emDashes,
    capsEmphasis: capsWords,
    triplets,
    tripletsPer1k: totalWords ? +((triplets / totalWords) * 1000).toFixed(1) : 0,
    notXbutY,
    colonReveals,
    selfAnsweredQ,
    banned: count(BANNED),
    openers: count(OPENERS),
    idioms: idiomHits,
    idiomsPer1k: +idiomsPer1k.toFixed(1),
    headings: headings.length,
    colonHeadings,
    questionHeadings,
  };
  r.hard = [];
  if (r.exclamations > 0) r.hard.push(`${r.exclamations} exclamation mark(s)`);
  if (r.banned.length) r.hard.push(`banned words: ${r.banned.map(([w, n]) => `${w}×${n}`).join(', ')}`);
  if (r.openers.length) r.hard.push(`promise openers: ${r.openers.map(([w]) => w).join(', ')}`);
  if (r.tripletsPer1k > 6) r.hard.push(`rule-of-three density ${r.tripletsPer1k}/1k words (max 6)`);
  if (r.idiomsPer1k > 2) r.hard.push(`idiom density ${r.idiomsPer1k}/1k words (max 2)`);
  if (r.headings >= 3 && r.colonHeadings / r.headings > 0.5)
    r.hard.push(`${r.colonHeadings}/${r.headings} headings use "X: Y"`);
  r.soft = [];
  if (r.tripletsPer1k > 4 && r.tripletsPer1k <= 6)
    r.soft.push(`rule-of-three density ${r.tripletsPer1k}/1k words (her sample: ~3)`);
  if (r.avgWordsPerSentence > 16) r.soft.push(`avg sentence ${r.avgWordsPerSentence} words (her range 10–13)`);
  if (r.notXbutY > 1) r.soft.push(`${r.notXbutY} "not X but Y" constructions`);
  if (r.colonReveals > 0) r.soft.push(`${r.colonReveals} colon reveal(s)`);
  if (r.selfAnsweredQ > 0) r.soft.push(`${r.selfAnsweredQ} self-answered question(s)`);
  if (r.emDashes > 6) r.soft.push(`${r.emDashes} em dashes (she uses 0–6)`);
  if (r.capsEmphasis > 5) r.soft.push(`${r.capsEmphasis} CAPS words (her sample: 5)`);
  if (r.paragraphs > 6 && r.paragraphLengthCV < 0.35)
    r.soft.push(`paragraphs are uniform (CV ${r.paragraphLengthCV}); vary them`);
  if (r.questionHeadings > 0) r.soft.push(`${r.questionHeadings} question heading(s)`);
  return r;
}

export function report(r) {
  const lines = [
    `words ${r.words} · sentences ${r.sentences} · avg ${r.avgWordsPerSentence} w/s · ≤5w ${r.shortSentences} · ≥25w ${r.longSentences} · paragraphs ${r.paragraphs}`,
  ];
  lines.push(r.hard.length ? `HARD FAIL:\n  - ${r.hard.join('\n  - ')}` : 'hard checks: ok');
  lines.push(r.soft.length ? `soft:\n  - ${r.soft.join('\n  - ')}` : 'soft checks: ok');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: voice-check.mjs <file.md>');
    process.exit(2);
  }
  const r = analyze(fs.readFileSync(file, 'utf8'));
  console.log(report(r));
  process.exit(r.hard.length ? 1 : 0);
}

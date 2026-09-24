// Creature stages, indexed by stage number (0-5). glyph: one character for the statusline.
// maintainer: replace names, glyphs and art. Placeholders only.
export const stages = [
  { name: 'Egg', glyph: '@', art: ['  __  ', ' /  \\ ', ' \\__/ '] },
  { name: 'Hatchling', glyph: 'o', art: [' ,__, ', ' (o o)', ' /)_) '] },
  { name: 'Chick', glyph: 'c', art: ['  (o> ', ' //\\  ', ' V_/_ '] },
  { name: 'Fledgling', glyph: 'f', art: ['  (o> ', ' /|\\/ ', '  /\\  '] },
  { name: 'Flyer', glyph: 'v', art: [' \\(o)/', '  / \\ ', ' ~~~~~ '] },
  { name: 'Elder', glyph: 'W', art: ['  _^_ ', ' (O O)', ' /)_(\\'] },
];

// Rule 4 of docs/voice.md: a reset is a fact, never a failure.
export const resetMessage = stage => `Started a new streak.\nMeet ${stages[stage].name} at stage ${stage}.`;

// Build-time comment stripper for the DEPLOYED copy only (v1.265).
//
// PRISM's source files carry their documentation as full-line // comments —
// in domain.js alone they are roughly 38% of the raw bytes and about half of
// the gzipped wire size, because detailed unique prose compresses far worse
// than code. A visitor's browser gains nothing from downloading them, so the
// build blanks full-line comments in dist/ while the repository source keeps
// every word. Only lines that are ENTIRELY a // comment (optional leading
// whitespace, then // to end of line) and that begin in code state are
// blanked; the newline is kept, so the deployed file has exactly the same
// line count as the source and line numbers in stack traces still line up.
//
// Safety: the scanner is a state machine over code / line comment / block
// comment / single-quoted / double-quoted / template literal (with ${ }
// nesting) / regex literal (with character classes), so a // line inside a
// template literal, a block comment, or a backslash-continued string is
// string content and is preserved verbatim, as are trailing comments, block
// comments, and every string or regex body. The transform is pinned by
// tests/comment-strip.test.mjs, including import-equivalence checks that run
// the stripped module graph and compare behaviour against the source.

const REGEX_PREFIX_WORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
  'instanceof', 'yield', 'await', 'else', 'do',
]);

function isIdentChar(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') || ch === '_' || ch === '$';
}

// The mode the scanner is in at the START of each line of `source`.
// Modes: 'code', 'block', 'sq', 'dq', 'tpl'. (A line comment or a regex
// literal can never span a newline in valid code, so neither can be the
// mode at a line start.)
function lineStartModes(source) {
  const modes = ['code'];
  let mode = 'code';
  let braceDepth = 0;
  const tplBraces = []; // brace depths saved when entering a ${ } expression
  // What the previous significant code token was: 'expr' (a value — a
  // following / is division) or 'op' (an operator or opener — a following
  // / starts a regex literal).
  let lastKind = 'op';
  let lastWord = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === '\n') {
      if (mode === 'line') mode = 'code';
      modes.push(mode === 'line' ? 'code' : mode);
      i += 1;
      continue;
    }
    if (mode === 'line') { i += 1; continue; }
    if (mode === 'block') {
      if (ch === '*' && source[i + 1] === '/') { mode = 'code'; i += 2; } else { i += 1; }
      continue;
    }
    if (mode === 'sq' || mode === 'dq') {
      const quote = mode === 'sq' ? "'" : '"';
      if (ch === '\\') {
        // An escaped newline is a line continuation: the next line still
        // starts inside this string, so record its line-start mode too.
        if (source[i + 1] === '\n') modes.push(mode);
        i += 2; continue;
      }
      if (ch === quote) { mode = 'code'; lastKind = 'expr'; lastWord = ''; }
      i += 1;
      continue;
    }
    if (mode === 'tpl') {
      if (ch === '\\') {
        if (source[i + 1] === '\n') modes.push(mode);
        i += 2; continue;
      }
      if (ch === '`') { mode = 'code'; lastKind = 'expr'; lastWord = ''; i += 1; continue; }
      if (ch === '$' && source[i + 1] === '{') {
        tplBraces.push(braceDepth); braceDepth = 0; mode = 'code';
        lastKind = 'op'; lastWord = ''; i += 2; continue;
      }
      i += 1;
      continue;
    }
    if (mode === 'regex') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '[') { mode = 'regexClass'; i += 1; continue; }
      if (ch === '/') {
        mode = 'code'; lastKind = 'expr'; lastWord = '';
        i += 1;
        while (i < n && isIdentChar(source[i])) i += 1; // flags
        continue;
      }
      i += 1;
      continue;
    }
    if (mode === 'regexClass') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === ']') mode = 'regex';
      i += 1;
      continue;
    }
    // mode === 'code'
    if (ch === '/' && source[i + 1] === '/') { mode = 'line'; i += 2; continue; }
    if (ch === '/' && source[i + 1] === '*') { mode = 'block'; i += 2; continue; }
    if (ch === "'") { mode = 'sq'; i += 1; continue; }
    if (ch === '"') { mode = 'dq'; i += 1; continue; }
    if (ch === '`') { mode = 'tpl'; i += 1; continue; }
    if (ch === '/') {
      const regexHere = lastKind === 'op' || REGEX_PREFIX_WORDS.has(lastWord);
      if (regexHere) { mode = 'regex'; i += 1; continue; }
      lastKind = 'op'; lastWord = ''; i += 1; continue; // division
    }
    if (isIdentChar(ch)) {
      let j = i;
      while (j < n && isIdentChar(source[j])) j += 1;
      lastWord = source.slice(i, j);
      lastKind = 'expr';
      i = j;
      continue;
    }
    if (ch === '{') { braceDepth += 1; lastKind = 'op'; lastWord = ''; i += 1; continue; }
    if (ch === '}') {
      if (braceDepth > 0) { braceDepth -= 1; lastKind = 'expr'; }
      else if (tplBraces.length > 0) { braceDepth = tplBraces.pop(); mode = 'tpl'; }
      else { lastKind = 'expr'; }
      lastWord = ''; i += 1; continue;
    }
    if (ch === ')' || ch === ']') { lastKind = 'expr'; lastWord = ''; i += 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
    lastKind = 'op'; lastWord = ''; i += 1; // any other punctuation/operator
  }
  return modes;
}

// Blank every line that is entirely a // comment beginning in code state.
// Returns the source unchanged in structure otherwise: same line count,
// same code bytes, comments replaced by nothing (the line becomes empty).
export function stripFullLineComments(source) {
  const modes = lineStartModes(source);
  const lines = source.split('\n');
  let stripped = 0;
  for (let k = 0; k < lines.length; k += 1) {
    if (modes[k] !== 'code') continue;
    if (/^[ \t]*\/\//.test(lines[k])) { lines[k] = ''; stripped += 1; }
  }
  return { code: lines.join('\n'), stripped };
}

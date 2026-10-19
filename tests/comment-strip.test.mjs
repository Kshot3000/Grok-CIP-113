import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripFullLineComments } from '../scripts/strip-comments.mjs';

// v1.275: the deployed copy strips full-line // comments at build time.
// These tests pin the stripper itself (the build applies it to dist only;
// the repository source keeps its documentation).

test('a full-line comment in code is blanked and the line count is preserved', () => {
  const src = '// header\nconst a = 1;\n  // indented note\nconst b = 2;\n';
  const { code, stripped } = stripFullLineComments(src);
  assert.equal(stripped, 2);
  assert.equal(code.split('\n').length, src.split('\n').length);
  assert.ok(code.includes('const a = 1;'));
  assert.ok(!code.includes('header'));
  assert.ok(!code.includes('indented note'));
});

test('trailing comments and block comments are never touched', () => {
  const src = 'const a = 1; // keep me\n/* block\n// inside block\n*/\nconst b = 2;\n';
  const { code, stripped } = stripFullLineComments(src);
  assert.equal(stripped, 0);
  assert.equal(code, src);
});

test('a // line inside a template literal is content and is preserved', () => {
  const src = 'const s = `first\n// not a comment\nlast`;\n// real comment\nconst b = 2;\n';
  const { code, stripped } = stripFullLineComments(src);
  assert.equal(stripped, 1);
  assert.ok(code.includes('// not a comment'));
  assert.ok(!code.includes('real comment'));
});

test('a // line inside a ${ } expression is a real comment and is blanked', () => {
  const src = 'const s = `a${\n// explain the value\n1 + 2}b`;\n';
  const { code } = stripFullLineComments(src);
  assert.ok(!code.includes('explain the value'));
  assert.ok(code.includes('1 + 2'));
});

test('nested templates and escaped backticks do not leak the scanner', () => {
  const src = 'const s = `outer ${`inner \\` tick\n// inner content\n`} end`;\n// gone\nconst b = 2;\n';
  const { code } = stripFullLineComments(src);
  assert.ok(code.includes('// inner content'));
  assert.ok(!code.includes('gone'));
});

test('a // line inside a backslash-continued string is preserved', () => {
  const src = "const s = 'abc\\\n// still a string';\n// gone\n";
  const { code } = stripFullLineComments(src);
  assert.ok(code.includes('// still a string'));
  assert.ok(!code.includes('gone'));
});

test('strings containing // and regex literals do not corrupt later lines', () => {
  const src = [
    "const url = 'https://example.com//path';",
    'const re = /["\'`]/g;',
    "const q = x.replace(/\\//g, '-');",
    '// gone after regexes',
    'const t = a / b / c;',
    "const u = 'after division';",
    '// gone at the end',
    '',
  ].join('\n');
  const { code, stripped } = stripFullLineComments(src);
  assert.equal(stripped, 2);
  assert.ok(code.includes('https://example.com//path'));
  assert.ok(code.includes('/["\'`]/g'));
  assert.ok(code.includes("x.replace(/\\//g, '-')"));
  assert.ok(code.includes('a / b / c'));
  assert.ok(code.includes('after division'));
});

test('a regex after return is a regex, not division', () => {
  const src = 'function f(s) {\n  return /^\\/\\//.test(s);\n}\n// gone\n';
  const { code } = stripFullLineComments(src);
  assert.ok(code.includes('/^\\/\\//.test(s)'));
  assert.ok(!code.includes('gone'));
});

const SRC_DIR = new URL('../src/', import.meta.url);
const srcFiles = readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();

test('every shipped source file keeps its line count and still parses stripped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-strip-'));
  for (const f of srcFiles) {
    const src = readFileSync(new URL(f, SRC_DIR), 'utf8');
    const { code } = stripFullLineComments(src);
    assert.equal(code.split('\n').length, src.split('\n').length, `${f}: line count changed`);
    const tmp = join(dir, f.replace(/\.js$/, '.mjs'));
    writeFileSync(tmp, code);
    execFileSync(process.execPath, ['--check', tmp]); // throws on any syntax break
  }
});

test('the stripper actually removes the documentation bulk from domain.js', () => {
  const src = readFileSync(new URL('domain.js', SRC_DIR), 'utf8');
  const { code, stripped } = stripFullLineComments(src);
  assert.ok(stripped > 5000, `expected >5000 stripped lines, got ${stripped}`);
  assert.ok(code.length < src.length * 0.7, 'expected at least 30% raw byte savings');
});

test('the stripped module graph imports and behaves identically to the source', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-strip-graph-'));
  const mirror = join(dir, 'src');
  mkdirSync(mirror);
  for (const f of srcFiles) {
    if (f === 'app.js') continue; // the DOM entry point; syntax-checked above
    const src = readFileSync(new URL(f, SRC_DIR), 'utf8');
    writeFileSync(join(mirror, f), stripFullLineComments(src).code);
  }
  const srcDomain = await import(new URL('domain.js', SRC_DIR).href);
  const mirDomain = await import(pathToFileURL(join(mirror, 'domain.js')).href);
  assert.deepEqual(Object.keys(mirDomain).sort(), Object.keys(srcDomain).sort());
  for (const key of Object.keys(srcDomain)) {
    if (typeof srcDomain[key] === 'function') {
      assert.equal(mirDomain[key].length, srcDomain[key].length, `${key}: arity changed`);
    } else {
      assert.deepEqual(mirDomain[key], srcDomain[key], `${key}: value changed`);
    }
  }
  const input = { amount: '500', depositRateBps: 2000, decimals: 6 };
  assert.deepEqual(mirDomain.modelBookingDeposit(input), srcDomain.modelBookingDeposit(input));
  const change = { oldAmount: '150', newAmount: '100', remainingBps: 2500, decimals: 6 };
  assert.deepEqual(
    mirDomain.modelSubscriptionPlanChange(change),
    srcDomain.modelSubscriptionPlanChange(change),
  );
  const mirServices = await import(pathToFileURL(join(mirror, 'services.js')).href);
  const srcServices = await import(new URL('services.js', SRC_DIR).href);
  assert.deepEqual(Object.keys(mirServices).sort(), Object.keys(srcServices).sort());
});

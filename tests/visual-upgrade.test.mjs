import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// --- Astra visual upgrade (v1.15): additive theme layer over the base styles ---
// The theme must stay a scoped overlay: every rule hangs off body[data-vu-theme]
// so removing the link + attribute returns the site to its base styling exactly.

test('index.html loads the theme after the base styles and opts the body in', async () => {
  const html = await read('index.html');
  const base = html.indexOf('./src/styles.css');
  const theme = html.indexOf('visual-upgrade/theme.css?v=');
  assert.ok(base > -1 && theme > base, 'theme.css must load after styles.css so the overlay wins ties');
  assert.match(html, /<body data-vu-theme="prism">/);
});

test('every theme rule is scoped to the opted-in body — nothing leaks globally', async () => {
  const css = await read('visual-upgrade/theme.css');
  assert.match(css, /--vu-art:url\("scene\.svg"\)/, 'theme paints the local scene artwork');
  assert.ok(css.includes(':focus-visible'), 'theme keeps a visible keyboard focus ring');
  assert.ok(!/https?:\/\//.test(css), 'theme must be dependency-free: no external URLs');
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  const rules = flat.split('}').map((r) => r.trim()).filter((r) => r.includes('{'));
  // Allowlist: :root variables, the namespaced .vu-* opt-in utilities (no PRISM
  // element uses them unless it asks to), and the reduced-motion html rule.
  const allowed = (s) => s.startsWith(':root') || s.startsWith('.vu-') || s === 'html';
  for (const rule of rules) {
    const selector = rule.split('{')[0].trim();
    if (allowed(selector)) continue;
    assert.ok(selector.startsWith('body[data-vu-theme]'), `unscoped theme rule: ${selector.slice(0, 60)}`);
  }
});

test('scene artwork is a self-contained SVG with the theme viewBox', async () => {
  const svg = await read('visual-upgrade/scene.svg');
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1600 1000"/);
  assert.ok(!/https?:\/\//.test(svg.replace('http://www.w3.org/2000/svg', '')), 'scene must not fetch external assets');
  assert.ok(svg.trim().endsWith('</svg>'));
});

test('build copies the visual-upgrade folder into dist', async () => {
  const build = await read('scripts/build.mjs');
  assert.ok(build.includes("'visual-upgrade'"), 'build must ship visual-upgrade or the live theme 404s');
});

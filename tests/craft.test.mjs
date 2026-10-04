import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { captureInvoker, focusFirst, restoreFocus, FOCUSABLE_SELECTOR } from '../src/a11y.js';
import { CONFIG } from '../src/config.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

function mockEl({ connected = true } = {}) {
  return { isConnected: connected, focused: 0, focusOpts: null, focus(o) { this.focused++; this.focusOpts = o; } };
}

// --- Modal focus helpers (mocks only; no live browser claim) ---

test('captureInvoker returns the focused element, never the body', () => {
  const btn = mockEl();
  assert.equal(captureInvoker({ body: {}, activeElement: btn }), btn);
  const body = { focus() {} };
  assert.equal(captureInvoker({ body, activeElement: body }), null);
  assert.equal(captureInvoker({ body, activeElement: null }), null);
  assert.equal(captureInvoker({ body, activeElement: { /* no focus() */ } }), null);
  assert.equal(captureInvoker(null), null);
});

test('focusFirst focuses the first focusable element in the dialog', () => {
  const first = mockEl();
  let seenSelector = null;
  const dialog = { querySelector(sel) { seenSelector = sel; return first; } };
  assert.equal(focusFirst(dialog), true);
  assert.equal(first.focused, 1);
  assert.equal(seenSelector, FOCUSABLE_SELECTOR);
  assert.match(FOCUSABLE_SELECTOR, /button:not\(\[disabled\]\)/);
  assert.equal(focusFirst({ querySelector: () => null }), false);
  assert.equal(focusFirst(null), false);
});

test('restoreFocus returns focus only to an element still in the document', () => {
  const live = mockEl();
  assert.equal(restoreFocus(live), true);
  assert.equal(live.focused, 1);
  assert.deepEqual(live.focusOpts, { preventScroll: true });
  const gone = mockEl({ connected: false });
  assert.equal(restoreFocus(gone), false);
  assert.equal(gone.focused, 0);
  assert.equal(restoreFocus(null), false);
});

test('app wires the dialog: capture on open, focus in, restore on close', async () => {
  const app = await read('src/app.js');
  assert.match(app, /if\(!dialog\.open\)modalInvoker=captureInvoker\(document\)/);
  assert.match(app, /focusFirst\(dialog\)/);
  assert.match(app, /addEventListener\('close',\(\)=>\{const target=modalInvoker;modalInvoker=null;restoreFocus\(target\);\}\)/);
});

// --- Structured data: honest, parseable, no invented social proof ---

test('index.html JSON-LD describes the app without ratings or affiliation claims', async () => {
  const html = await read('index.html');
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'JSON-LD block present');
  const data = JSON.parse(m[1]);
  assert.equal(data['@type'], 'WebApplication');
  assert.equal(data.url, CONFIG.site);
  assert.equal(data.author.url, `https://x.com/${CONFIG.x}`);
  assert.ok(data.sameAs.includes(CONFIG.github));
  assert.equal(data.offers.price, '0');
  const raw = JSON.stringify(data).toLowerCase();
  for (const banned of ['aggregaterating', 'review', 'cardano foundation', 'endorsement', 'ratingvalue'])
    assert.ok(!raw.includes(banned), `JSON-LD must not contain ${banned}`);
  assert.match(data.description, /does not issue tokens/i);
});

// --- robots / sitemap: consistent with the canonical site, no fake pages ---

test('robots.txt allows crawling and points at the canonical sitemap', async () => {
  const robots = await read('robots.txt');
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.ok(robots.includes(`Sitemap: ${CONFIG.site}sitemap.xml`));
});

test('sitemap lists only the canonical URL — hash routes are not separate pages', async () => {
  const sitemap = await read('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
  assert.deepEqual(locs, [CONFIG.site]);
  assert.ok(!sitemap.includes('#'), 'no hash-fragment URLs in the sitemap');
});

test('build copies the discovery files and the share card into dist', async () => {
  const build = await read('scripts/build.mjs');
  for (const f of ['robots.txt', 'sitemap.xml', 'og.jpg'])
    assert.ok(build.includes(`'${f}'`), `build must copy ${f}`);
  assert.ok(!build.includes('og.png'), 'build must not ship the retired og.png');
});

// --- Share card: standard size, JPEG, small enough for crawlers ---

test('share card is the standard 1200x630 JPEG under 200 KB, meta agrees', async () => {
  const buf = await readFile(new URL('og.jpg', root));
  assert.ok(buf.length < 200_000, `og.jpg is ${buf.length} bytes`);
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8); // JPEG SOI
  // SOF0/SOF2 marker carries the frame dimensions.
  let i = 2, dims = null;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) { dims = { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; break; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  assert.deepEqual(dims, { w: 1200, h: 630 });
  const html = await read('index.html');
  assert.ok(html.includes(`${CONFIG.site}og.jpg`));
  assert.ok(html.includes('og:image:type" content="image/jpeg'));
  assert.ok(html.includes('og:image:width" content="1200'));
  assert.ok(html.includes('og:image:height" content="630'));
  await assert.rejects(stat(new URL('og.png', root)), 'og.png retired');
});

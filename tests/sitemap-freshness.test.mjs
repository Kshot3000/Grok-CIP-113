import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stampSitemap, buildDate } from '../scripts/sitemap.mjs';
import { CONFIG } from '../src/config.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const BASE = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${CONFIG.site}</loc>\n  </url>\n</urlset>\n`;

test('stamp inserts lastmod after the loc when none exists', () => {
  const out = stampSitemap(BASE, '2026-10-17');
  assert.ok(out.includes('<lastmod>2026-10-17</lastmod>'));
  assert.ok(out.indexOf('</loc>') < out.indexOf('<lastmod>'));
  assert.deepEqual([...out.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]), [CONFIG.site]);
});

test('stamp replaces a stale lastmod instead of duplicating it', () => {
  const stale = BASE.replace('</loc>', '</loc>\n    <lastmod>2026-10-04</lastmod>');
  const out = stampSitemap(stale, '2026-10-17');
  assert.equal([...out.matchAll(/<lastmod>/g)].length, 1);
  assert.ok(out.includes('<lastmod>2026-10-17</lastmod>'));
  assert.ok(!out.includes('2026-10-04'));
});

test('stamp is idempotent for the same date', () => {
  const once = stampSitemap(BASE, '2026-10-17');
  assert.equal(stampSitemap(once, '2026-10-17'), once);
});

test('stamp refuses non-documents, missing locs, and unreal dates', () => {
  assert.throws(() => stampSitemap('<html></html>', '2026-10-17'), /urlset/);
  assert.throws(() => stampSitemap('<urlset></urlset>', '2026-10-17'), /no <loc>/);
  assert.throws(() => stampSitemap(BASE, '17-10-2026'), /invalid ISO date/);
  assert.throws(() => stampSitemap(BASE, '2026-02-30'), /not a real calendar date/);
  assert.throws(() => stampSitemap(BASE, ''), /invalid ISO date/);
});

test('buildDate renders the UTC ISO date of the given instant', () => {
  assert.equal(buildDate(new Date('2026-10-17T23:59:59Z')), '2026-10-17');
  assert.equal(buildDate(new Date('2026-10-18T00:00:01Z')), '2026-10-18');
});

test('the source sitemap carries no hardcoded lastmod that can go stale', async () => {
  const sitemap = await read('sitemap.xml');
  assert.ok(!sitemap.includes('<lastmod>'), 'source lastmod must be build-stamped, never hardcoded');
  assert.ok(!/<lastmod>2026-10-04<\/lastmod>/.test(sitemap), 'the stale launch lastmod must not survive');
});

test('the build stamps the deployed sitemap via the shared stamper', async () => {
  const build = await read('scripts/build.mjs');
  assert.ok(build.includes("from './sitemap.mjs'"));
  assert.ok(build.includes('stampSitemap('));
  assert.ok(build.includes('buildDate()'));
});

// Sitemap freshness (v1.275): the source sitemap.xml intentionally carries
// no <lastmod> — a hardcoded date went stale at the 2026-10-04 launch value
// through every later release, telling crawlers the page had not changed
// when it had. The build stamps the DEPLOYED sitemap with the build date:
// the deployed page's content is current as of that build, so the stamp is
// a fact about the artifact, and it can never drift behind a release again.
// Pure and importable so tests can pin it without running a build.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function stampSitemap(xml, isoDate) {
  if (typeof xml !== 'string' || !xml.includes('<urlset')) throw new Error('sitemap: not a urlset document');
  if (typeof isoDate !== 'string' || !DATE_RE.test(isoDate)) throw new Error(`sitemap: invalid ISO date ${JSON.stringify(isoDate)}`);
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== isoDate) throw new Error(`sitemap: not a real calendar date ${isoDate}`);
  if (/<lastmod>[^<]*<\/lastmod>/.test(xml)) return xml.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${isoDate}</lastmod>`);
  if (!xml.includes('</loc>')) throw new Error('sitemap: no <loc> to stamp after');
  return xml.replace('</loc>', `</loc>\n    <lastmod>${isoDate}</lastmod>`);
}

export function buildDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

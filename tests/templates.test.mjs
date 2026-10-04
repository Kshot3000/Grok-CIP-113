import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEMPLATES } from '../src/config.js';
import { fromTemplate, validateDesign, simulateTransfer, makeManifest, parseManifest, toUnits } from '../src/domain.js';

// v1.7 added the carbon-credit and event-ticket templates. These tests pin the
// whole catalog: every template must produce a valid design, ship a real icon
// and a real accent style (icon() silently falls back to a box and an unknown
// accent class renders unstyled — both failures are invisible without a test),
// round-trip through the manifest format, and model the behaviour its
// description promises.

const iconsSource = readFileSync(new URL('../src/icons.js', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('catalog has six templates with unique ids and tickers', () => {
  assert.equal(TEMPLATES.length, 6);
  assert.equal(new Set(TEMPLATES.map(t => t.id)).size, 6);
  assert.equal(new Set(TEMPLATES.map(t => t.ticker)).size, 6);
  assert.deepEqual(TEMPLATES.map(t => t.id), ['rwa', 'credit', 'stable', 'community', 'carbon', 'ticket']);
});

test('every template builds a design that validates with zero errors', () => {
  for (const t of TEMPLATES) assert.deepEqual(validateDesign(fromTemplate(t.id)), [], t.id);
});

test('every template icon exists and every non-default accent has template-icon and asset-card styles', () => {
  // 'mint' is the base style: .template-icon and .asset-card are green by
  // default, so the RWA template needs no accent-specific rule.
  for (const t of TEMPLATES) {
    assert.match(iconsSource, new RegExp(`\\n  ${t.icon}:`), `${t.id} icon "${t.icon}" missing from icons.js (would render as a fallback box)`);
    if (t.accent === 'mint') continue;
    assert.ok(stylesSource.includes(`.template-icon.${t.accent}{`), `${t.id} accent "${t.accent}" has no .template-icon style`);
    assert.ok(stylesSource.includes(`.asset-card.${t.accent}{`), `${t.id} accent "${t.accent}" has no .asset-card style`);
  }
});

test('carbon and ticket manifests round-trip exactly', () => {
  for (const id of ['carbon', 'ticket']) {
    const m = makeManifest(fromTemplate(id), 'preview');
    assert.deepEqual(parseManifest(JSON.stringify(m)), { design: fromTemplate(id), network: 'preview' });
  }
});

test('carbon credit: indivisible tonnes, KYC-gated, per-transfer cap enforced', () => {
  const d = fromTemplate('carbon');
  assert.equal(d.decimals, 0);
  assert.equal(d.substandard, 'kyc');
  assert.equal(toUnits(d.supply, d.decimals), 250000n);
  // A verified participant can move exactly the cap…
  const ok = simulateTransfer(d, { recipient: 'approved', amount: '10000' });
  assert.equal(ok.allowed, true, JSON.stringify(ok.checks));
  // …one tonne over the cap is denied by the transfer-limit check alone.
  const over = simulateTransfer(d, { recipient: 'approved', amount: '10001' });
  assert.equal(over.allowed, false);
  assert.equal(over.checks.find(c => c.name === 'Transfer limit').pass, false);
  assert.ok(over.checks.filter(c => !c.pass).length === 1);
  // An unverified participant is denied (allowlist + eligibility both model KYC gating).
  const pending = simulateTransfer(d, { recipient: 'pending', amount: '1' });
  assert.equal(pending.allowed, false);
  // Fractional tonnes do not exist at 0 decimals.
  const frac = simulateTransfer(d, { recipient: 'approved', amount: '1.5' });
  assert.equal(frac.allowed, false);
  assert.equal(frac.invalid, true);
});

test('event ticket: open access, four-per-transfer anti-scalping cap, whole tickets only', () => {
  const d = fromTemplate('ticket');
  assert.equal(d.decimals, 0);
  assert.equal(d.allowlist, false);
  assert.equal(d.substandard, 'generic');
  assert.equal(toUnits(d.supply, d.decimals), 5000n);
  // Open access: even the pending participant (no allowlist, no credential) can receive.
  const four = simulateTransfer(d, { recipient: 'pending', amount: '4' });
  assert.equal(four.allowed, true, JSON.stringify(four.checks));
  // Five in one transfer is the scalping pattern the cap exists to stop.
  const five = simulateTransfer(d, { recipient: 'approved', amount: '5' });
  assert.equal(five.allowed, false);
  assert.equal(five.checks.find(c => c.name === 'Transfer limit').pass, false);
  // The organizer pause blocks everything while active.
  const paused = simulateTransfer({ ...d, paused: true }, { recipient: 'approved', amount: '1' });
  assert.equal(paused.allowed, false);
  assert.equal(paused.checks.find(c => c.name === 'Issuer controls').pass, false);
  // Half a ticket is not a ticket.
  const half = simulateTransfer(d, { recipient: 'approved', amount: '0.5' });
  assert.equal(half.allowed, false);
  assert.equal(half.invalid, true);
});

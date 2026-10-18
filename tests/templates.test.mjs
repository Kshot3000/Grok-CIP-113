import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEMPLATES } from '../src/config.js';
import { fromTemplate, validateDesign, simulateTransfer, makeManifest, parseManifest, toUnits, auditDesign } from '../src/domain.js';

// v1.7 added the carbon-credit and event-ticket templates; the governance
// template followed, and v1.267 added the open-payments template — the first
// template with the per-transfer cap OFF, so no starting design before it
// ever showed the uncapped state. These tests pin the
// whole catalog: every template must produce a valid design, ship a real icon
// and a real accent style (icon() silently falls back to a box and an unknown
// accent class renders unstyled — both failures are invisible without a test),
// round-trip through the manifest format, and model the behaviour its
// description promises.

const iconsSource = readFileSync(new URL('../src/icons.js', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('catalog has eight templates with unique ids and tickers', () => {
  assert.equal(TEMPLATES.length, 8);
  assert.equal(new Set(TEMPLATES.map(t => t.id)).size, 8);
  assert.equal(new Set(TEMPLATES.map(t => t.ticker)).size, 8);
  assert.deepEqual(TEMPLATES.map(t => t.id), ['rwa', 'credit', 'stable', 'community', 'carbon', 'ticket', 'governance', 'payments']);
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

test('carbon, ticket, governance, and payments manifests round-trip exactly', () => {
  for (const id of ['carbon', 'ticket', 'governance', 'payments']) {
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

test('governance token: open voting power, no issuer pause, 1%-of-supply per-transfer cap', () => {
  const d = fromTemplate('governance');
  assert.equal(d.decimals, 6);
  assert.equal(d.allowlist, false);
  assert.equal(d.pausable, false);
  assert.equal(d.identity, false);
  assert.equal(d.substandard, 'generic');
  assert.equal(toUnits(d.supply, d.decimals), 10000000000000n);
  assert.equal(toUnits(d.limit, d.decimals) * 100n, toUnits(d.supply, d.decimals)); // The cap is exactly 1% of supply.
  // Open access: even the pending participant (no allowlist, no credential) can receive voting power.
  const ok = simulateTransfer(d, { recipient: 'pending', amount: '100000' });
  assert.equal(ok.allowed, true, JSON.stringify(ok.checks));
  // One base unit over 1% of the supply is denied by the transfer-limit check alone.
  const over = simulateTransfer(d, { recipient: 'approved', amount: '100000.000001' });
  assert.equal(over.allowed, false);
  assert.equal(over.checks.find(c => c.name === 'Transfer limit').pass, false);
  assert.ok(over.checks.filter(c => !c.pass).length === 1);
  // Issuer controls are off, so even a design carrying the paused flag cannot
  // be halted by the issuer in this model — the pause check passes because
  // the control itself is disabled, which is the template's promise.
  const paused = simulateTransfer({ ...d, paused: true }, { recipient: 'approved', amount: '1' });
  assert.equal(paused.allowed, true, JSON.stringify(paused.checks));
  assert.equal(paused.checks.find(c => c.name === 'Issuer controls').pass, true);
  // A frozen participant is likewise not blocked: with controls off there is
  // no freeze mechanism to apply.
  const frozen = simulateTransfer(d, { recipient: 'blocked', amount: '1' });
  assert.equal(frozen.allowed, true, JSON.stringify(frozen.checks));
});

test('open payments: no per-transfer cap, open access, no issuer controls — the whole supply can move in one transfer', () => {
  const d = fromTemplate('payments');
  assert.equal(d.decimals, 6);
  assert.equal(d.allowlist, false);
  assert.equal(d.limitEnabled, false);
  assert.equal(d.pausable, false);
  assert.equal(d.identity, false);
  assert.equal(d.substandard, 'generic');
  assert.equal(toUnits(d.supply, d.decimals), 100000000000000n);
  // The template is the catalog's only uncapped design: every other template
  // enables the per-transfer limit, so this state was unreachable as a
  // starting design before it. The stored limit is the value that would
  // apply if a builder turns the cap on — exactly 1% of supply.
  assert.equal(TEMPLATES.filter(t => t.limitEnabled).length, 7);
  assert.equal(toUnits(d.limit, d.decimals) * 100n, toUnits(d.supply, d.decimals));
  // Uncapped and open: the ENTIRE designed supply can move to the pending
  // participant (no allowlist, no credential) in a single modeled transfer,
  // passing the transfer-limit check because no cap is modeled.
  const whole = simulateTransfer(d, { recipient: 'pending', amount: '100000000' });
  assert.equal(whole.allowed, true, JSON.stringify(whole.checks));
  assert.equal(whole.checks.find(c => c.name === 'Transfer limit').pass, true);
  assert.match(whole.checks.find(c => c.name === 'Transfer limit').detail, /No per-transfer cap/);
  // One base unit over the supply is denied by the available-supply check alone.
  const over = simulateTransfer(d, { recipient: 'approved', amount: '100000000.000001' });
  assert.equal(over.allowed, false);
  assert.equal(over.checks.find(c => c.name === 'Available supply').pass, false);
  assert.ok(over.checks.filter(c => !c.pass).length === 1);
  // Issuer controls are off, so a design carrying the paused flag cannot be
  // halted and a frozen participant is not blocked — the same promise the
  // governance template makes, here for a payment asset.
  const paused = simulateTransfer({ ...d, paused: true }, { recipient: 'approved', amount: '1' });
  assert.equal(paused.allowed, true, JSON.stringify(paused.checks));
  const frozen = simulateTransfer(d, { recipient: 'blocked', amount: '1' });
  assert.equal(frozen.allowed, true, JSON.stringify(frozen.checks));
  // The design review states the trade-off out loud instead of hiding it:
  // with no rule active and the generic substandard, this design behaves
  // like an ordinary native token — a warning, not a blocker.
  const audit = auditDesign(d);
  assert.equal(audit.ready, true);
  assert.deepEqual(audit.counts, { blocker: 0, warning: 1, note: 2, ok: 1 });
  assert.equal(audit.findings.find(f => f.id === 'rule-coverage').level, 'warning');
  assert.equal(audit.findings.find(f => f.id === 'cap-effectiveness').title, 'No per-transfer cap');
});

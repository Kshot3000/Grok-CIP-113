import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelLaunchpadSale } from '../src/domain.js';

// Launchpad sale model: a capped raise whose platform fee is charged
// on the FILLED amount only. Subscriptions past the hard cap are
// refunded in full and charged nothing — a fee on refunded money
// would charge for a raise that never happened.
const DEFAULT = { hardCap: '50000', subscribed: '75000', decimals: 6, feeBps: 200, fixedFee: '0', maxFee: '' };

test('the default launch: oversubscribed 1.5×, the fill is the cap, the fee is on the fill, the excess is refunded', () => {
  const r = modelLaunchpadSale(DEFAULT);
  assert.equal(r.hardCap, 50000000000n);
  assert.equal(r.subscribed, 75000000000n);
  assert.equal(r.filled, 50000000000n);
  assert.equal(r.refunded, 25000000000n);
  assert.equal(r.unsoldCap, 0n);
  assert.equal(r.oversubscribed, true);
  assert.equal(r.platformFee, 1000000000n); // 200 bps of the 50,000 fill — not of the 75,000 subscribed
  assert.equal(r.issuerNet, 49000000000n);
  assert.equal(r.net, r.issuerNet);
  assert.equal(r.fillRateBpsText, '6666.66');
  assert.equal(r.subscriptionRateBpsText, '15000.00');
  assert.equal(r.feeEffectiveBpsText, '200.00');
  assert.equal(r.capApplied, false);
});

test('accounting identity: platform fee + issuer net + refunded is always the subscribed amount', () => {
  const inputs = [
    DEFAULT,
    { ...DEFAULT, subscribed: '25000' },
    { ...DEFAULT, subscribed: '50000' },
    { ...DEFAULT, feeBps: 250, fixedFee: '1.5', subscribed: '123456' },
    { ...DEFAULT, hardCap: '7', subscribed: '9', decimals: 0, feeBps: 999 },
    { ...DEFAULT, subscribed: '60000', maxFee: '500' },
  ];
  for (const input of inputs) {
    const r = modelLaunchpadSale(input);
    assert.equal(r.platformFee + r.issuerNet + r.refunded, r.subscribed, JSON.stringify(input));
    assert.equal(r.filled + r.refunded, r.subscribed, JSON.stringify(input));
    assert.equal(r.platformFee + r.issuerNet, r.filled, JSON.stringify(input));
  }
});

test('the fee is on the filled amount only: subscriptions past the cap change only the refund', () => {
  const at = modelLaunchpadSale(DEFAULT);
  const beyond = modelLaunchpadSale({ ...DEFAULT, subscribed: '150000' });
  assert.equal(beyond.platformFee, at.platformFee);
  assert.equal(beyond.issuerNet, at.issuerNet);
  assert.equal(beyond.filled, at.filled);
  assert.equal(beyond.refunded, 100000000000n);
  // On the subscribed amount the fee would be 3,000 — it is 1,000, on the fill.
  assert.notEqual(at.platformFee, 3000000000n);
});

test('an under-subscribed launch: the fill is the subscriptions, nothing is refunded, the unsold cap is stated', () => {
  const r = modelLaunchpadSale({ ...DEFAULT, subscribed: '25000' });
  assert.equal(r.filled, 25000000000n);
  assert.equal(r.refunded, 0n);
  assert.equal(r.unsoldCap, 25000000000n);
  assert.equal(r.oversubscribed, false);
  assert.equal(r.platformFee, 500000000n);
  assert.equal(r.issuerNet, 24500000000n);
  assert.equal(r.fillRateBpsText, '10000.00');
  assert.equal(r.subscriptionRateBpsText, '5000.00');
});

test('a launch filled exactly at the cap: no refund, no unsold cap, not oversubscribed', () => {
  const r = modelLaunchpadSale({ ...DEFAULT, subscribed: '50000' });
  assert.equal(r.filled, r.hardCap);
  assert.equal(r.refunded, 0n);
  assert.equal(r.unsoldCap, 0n);
  assert.equal(r.oversubscribed, false);
  assert.equal(r.subscriptionRateBpsText, '10000.00');
});

test('the takes-all refusal is judged on the filled amount, not the subscriptions', () => {
  // A fixed fee of 100 equals the whole 100 fill under the cap, though
  // it is a tenth of the 1,000 subscribed — refused on the fill.
  assert.throws(() => modelLaunchpadSale({ hardCap: '100', subscribed: '1000', decimals: 6, feeBps: 0, fixedFee: '100', maxFee: '' }), /whole transfer/);
  // The same fixed fee under a larger cap fills more and passes.
  const ok = modelLaunchpadSale({ hardCap: '1000', subscribed: '1000', decimals: 6, feeBps: 0, fixedFee: '100', maxFee: '' });
  assert.equal(ok.platformFee, 100000000n);
  assert.equal(ok.issuerNet, 900000000n);
});

test('a fee cap binds on the filled fee and is reported, with the uncapped figure kept', () => {
  const r = modelLaunchpadSale({ ...DEFAULT, maxFee: '500' });
  assert.equal(r.platformFee, 500000000n);
  assert.equal(r.platformUncappedFee, 1000000000n);
  assert.equal(r.capApplied, true);
  assert.equal(r.issuerNet, 49500000000n);
  assert.equal(r.feeEffectiveBpsText, '100.00');
});

test('floor rounding is exact: the fee on a tiny fill rounds down to the base unit', () => {
  const r = modelLaunchpadSale({ hardCap: '3', subscribed: '3', decimals: 0, feeBps: 3333, fixedFee: '0', maxFee: '' });
  assert.equal(r.filled, 3n);
  assert.equal(r.platformFee, 0n); // floor(3 × 3333 ÷ 10,000) = floor(0.9999)
  assert.equal(r.issuerNet, 3n);
  assert.equal(r.feeEffectiveBpsText, '0.00');
});

test('hard cap validation: a zero, negative, or unparseable cap is refused with a clear message', () => {
  assert.throws(() => modelLaunchpadSale({ ...DEFAULT, hardCap: '0' }), /Hard cap must be greater than zero/);
  assert.throws(() => modelLaunchpadSale({ ...DEFAULT, hardCap: '-5' }), /positive decimal amount/); // Refused by the amount parser itself.
  assert.throws(() => modelLaunchpadSale({ subscribed: '10', decimals: 6 }), /Hard cap must be greater than zero/);
});

test('subscription validation: a zero or negative subscription is refused with a clear message', () => {
  assert.throws(() => modelLaunchpadSale({ ...DEFAULT, subscribed: '0' }), /Subscribed amount must be greater than zero/);
  assert.throws(() => modelLaunchpadSale({ ...DEFAULT, subscribed: '-1' }), /positive decimal amount/); // Refused by the amount parser itself.
  assert.throws(() => modelLaunchpadSale({ hardCap: '10', decimals: 6 }), /Subscribed amount must be greater than zero/);
});

test('fee input validation propagates from the split on the fill', () => {
  assert.throws(() => modelLaunchpadSale({ ...DEFAULT, feeBps: 10001 }), /Fee must be a whole number/);
  assert.throws(() => modelLaunchpadSale({ ...DEFAULT, feeBps: 2.5 }), /Fee must be a whole number/);
  const d = modelLaunchpadSale({ hardCap: '50000', subscribed: '75000', decimals: 6 });
  assert.equal(d.feeBps, 100); // The split's own default rate.
  assert.equal(d.platformFee, 500000000n);
});

test('subscription-level rows: fills, fees, and refunds at shares of the cap, exact', () => {
  const r = modelLaunchpadSale(DEFAULT);
  assert.deepEqual(r.rows.map(row => row.levelBps), [2500, 5000, 7500, 10000, 15000, 20000]);
  assert.deepEqual(r.rows.map(row => row.subscribed), [12500000000n, 25000000000n, 37500000000n, 50000000000n, 75000000000n, 100000000000n]);
  assert.deepEqual(r.rows.map(row => row.filled), [12500000000n, 25000000000n, 37500000000n, 50000000000n, 50000000000n, 50000000000n]);
  assert.deepEqual(r.rows.map(row => row.platformFee), [250000000n, 500000000n, 750000000n, 1000000000n, 1000000000n, 1000000000n]);
  assert.deepEqual(r.rows.map(row => row.issuerNet), [12250000000n, 24500000000n, 36750000000n, 49000000000n, 49000000000n, 49000000000n]);
  assert.deepEqual(r.rows.map(row => row.refunded), [0n, 0n, 0n, 0n, 25000000000n, 50000000000n]);
  assert.ok(r.rows.every(row => row.takesAll === false));
});

test('a subscription level whose fee would take its whole fill is flagged in its row, not refused', () => {
  const r = modelLaunchpadSale({ hardCap: '100', subscribed: '100', decimals: 6, feeBps: 0, fixedFee: '60', maxFee: '' });
  assert.equal(r.platformFee, 60000000n);
  const low = r.rows.find(row => row.levelBps === 2500);
  assert.equal(low.filled, 25000000n);
  assert.equal(low.platformFee, 60000000n);
  assert.equal(low.takesAll, true);
  assert.equal(low.issuerNet, -35000000n); // The row states the arithmetic plainly; the flag is the verdict.
  assert.equal(r.rows.find(row => row.levelBps === 10000).takesAll, false);
});

test('exactness beyond float range: a 9,007,199,254,740,993-unit cap subscribed twice over at 100 bps', () => {
  const r = modelLaunchpadSale({ hardCap: '9007199254740993', subscribed: '18014398509481986', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '' });
  assert.equal(r.filled, 9007199254740993n);
  assert.equal(r.platformFee, 90071992547409n);
  assert.equal(r.issuerNet, 8917127262193584n);
  assert.equal(r.refunded, 9007199254740993n);
  assert.equal(r.platformFee + r.issuerNet + r.refunded, r.subscribed);
});

test('decimals handling: the model follows the entered scale, and a bad scale is refused', () => {
  const zero = modelLaunchpadSale({ hardCap: '50000', subscribed: '75000', decimals: 0, feeBps: 200, fixedFee: '0', maxFee: '' });
  assert.equal(zero.filled, 50000n);
  assert.equal(zero.platformFee, 1000n);
  assert.equal(zero.issuerNet, 49000n);
  assert.equal(zero.refunded, 25000n);
  assert.throws(() => modelLaunchpadSale({ ...DEFAULT, decimals: 7 }), /Decimals/);
  assert.throws(() => modelLaunchpadSale({ ...DEFAULT, hardCap: '1.0000001' }), /decimal places/);
});

test('the subscription rate is stated past 10,000 bps when a launch is heavily oversubscribed', () => {
  const r = modelLaunchpadSale({ ...DEFAULT, subscribed: '200000' });
  assert.equal(r.subscriptionRateBpsText, '40000.00');
  assert.equal(r.fillRateBpsText, '2500.00');
  assert.equal(r.refunded, 150000000000n);
});

test('app wires the launchpad model: panel, verdict outcomes, honest boundary, v1.276', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /modelLaunchpadSale/);
  assert.match(app, /Model a launchpad sale/);
  assert.match(app, /data-launch="hardCap"/);
  assert.match(app, /data-launch="subscribed"/);
  assert.match(app, /id="launchpad-output"/);
  assert.match(app, /PRISM runs no launchpad, sells no tokens, and takes no subscriptions/);
  assert.match(app, /v1\.276/);
});

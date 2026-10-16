import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelWithholding } from '../src/domain.js';

// Withholding model (v1.222): a NEW axis — a stated share
// of a gross payment withheld by the payer and remitted to
// a stated authority on the recipient's behalf. The
// withheld amount is floor(gross x rate / 10,000),
// measured against the gross payment, never against the
// net paid over; withheld + paid over === gross exactly.
// The withheld amount is not a fee and not a reserve.
// No authority, recipient status, timing, or gross-up priced.
const DEFAULT = { amount: '1000', withholdingRateBps: 2000, decimals: 6 };

test('the preloaded withholding: a 1,000 payment at a stated 20% withholds 200 and pays 800 over', () => {
  const r = modelWithholding(DEFAULT);
  assert.equal(r.amount, 1000000000n);
  assert.equal(r.withholdingRateBps, 2000);
  assert.equal(r.withheldAmount, 200000000n);
  assert.equal(r.netAmount, 800000000n);
  assert.equal(r.withheldShareBpsText, '2000.00');
  assert.equal(r.netShareBpsText, '8000.00');
  assert.equal(r.noWithholdingStated, false);
  assert.equal(r.withholdingTakesWhole, false);
});

test('identity holds across payments: withheld plus paid over is the gross payment, exactly', () => {
  const cases = [
    DEFAULT,
    { amount: '777', withholdingRateBps: 2000, decimals: 0 },
    { amount: '100', withholdingRateBps: 10000, decimals: 6 },
    { amount: '100', withholdingRateBps: 0, decimals: 6 },
    { amount: '0.000001', withholdingRateBps: 2000, decimals: 6 },
    { amount: '9007199254740993', withholdingRateBps: 2000, decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelWithholding(c);
    assert.equal(r.withheldAmount + r.netAmount, r.amount);
    assert.ok(r.withheldAmount <= r.amount);
  }
});

test('measuring the withholding against what is paid over instead would understate it: the base is the gross payment', () => {
  const r = modelWithholding(DEFAULT);
  const withheldOnNet = r.netAmount * BigInt(r.withholdingRateBps) / 10000n;
  assert.equal(withheldOnNet, 160000000n);
  assert.equal(r.withheldAmount, 200000000n);
  assert.equal(r.withheldAmount - withheldOnNet, 40000000n);
});

test('a withholding rate of zero states no withholding: the payment is paid over whole', () => {
  const r = modelWithholding({ ...DEFAULT, withholdingRateBps: 0 });
  assert.equal(r.withheldAmount, 0n);
  assert.equal(r.netAmount, r.amount);
  assert.equal(r.noWithholdingStated, true);
  assert.equal(r.withheldShareBpsText, '0.00');
  assert.equal(r.netShareBpsText, '10000.00');
});

test('a withholding rate of the whole withholds the payment whole: nothing is paid over, stated as such', () => {
  const r = modelWithholding({ ...DEFAULT, withholdingRateBps: 10000 });
  assert.equal(r.withheldAmount, 1000000000n);
  assert.equal(r.netAmount, 0n);
  assert.equal(r.withholdingTakesWhole, true);
  assert.equal(r.withheldShareBpsText, '10000.00');
  assert.equal(r.netShareBpsText, '0.00');
});

test('a stated withholding rate flooring to zero on a one-base-unit payment withholds nothing at that size', () => {
  const r = modelWithholding({ amount: '0.000001', withholdingRateBps: 2000, decimals: 6 });
  assert.equal(r.amount, 1n);
  assert.equal(r.withheldAmount, 0n);
  assert.equal(r.netAmount, 1n);
  assert.equal(r.withholdingFloorsToZero, true);
  assert.equal(r.noWithholdingStated, false);
});

test('the 777 case at no decimals: 777 at 20% withholds 155 and pays 622 over', () => {
  const r = modelWithholding({ amount: '777', withholdingRateBps: 2000, decimals: 0 });
  assert.equal(r.withheldAmount, 155n);
  assert.equal(r.netAmount, 622n);
  assert.equal(r.withheldShareBpsText, '1994.85');
  assert.equal(r.netShareBpsText, '8005.14');
});

test('amounts beyond float precision stay exact: a 2^53+1 payment at 20% withholds 1801439850948198 and pays 7205759403792795 over', () => {
  const r = modelWithholding({ amount: '9007199254740993', withholdingRateBps: 2000, decimals: 0 });
  assert.equal(r.withheldAmount, 1801439850948198n);
  assert.equal(r.netAmount, 7205759403792795n);
});

test('decimals are respected: 2500 at two decimals and 20% withholds 500.00 and pays 2000.00 over', () => {
  const r = modelWithholding({ amount: '2500', withholdingRateBps: 2000, decimals: 2 });
  assert.equal(r.amount, 250000n);
  assert.equal(r.withheldAmount, 50000n);
  assert.equal(r.netAmount, 200000n);
});

test('a withholding rate beyond the whole is refused: withholding more than the payment is not a withholding on it', () => {
  assert.throws(() => modelWithholding({ ...DEFAULT, withholdingRateBps: 10001 }), /Withholding rate must be/);
});

test('a negative withholding rate is refused', () => {
  assert.throws(() => modelWithholding({ ...DEFAULT, withholdingRateBps: -1 }), /Withholding rate must be/);
});

test('a fractional withholding rate is refused', () => {
  assert.throws(() => modelWithholding({ ...DEFAULT, withholdingRateBps: 2.5 }), /Withholding rate must be/);
});

test('a zero payment amount is refused', () => {
  assert.throws(() => modelWithholding({ ...DEFAULT, amount: '0' }), /Amount must be greater than zero/);
});

test('what is not priced is stated: the withheld amount is not a fee or a reserve, and authority, recipient status, timing, and gross-up are flagged unpriced', () => {
  const r = modelWithholding(DEFAULT);
  assert.equal(r.withholdingIsFee, false);
  assert.equal(r.withholdingIsReserve, false);
  assert.equal(r.authorityPriced, false);
  assert.equal(r.recipientStatusPriced, false);
  assert.equal(r.remittanceTimingPriced, false);
  assert.equal(r.grossUpPriced, false);
});

test('wiring: the app imports the model, renders a withholding panel, and the README names the model', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(app.includes('modelWithholding'));
  assert.ok(app.includes('data-withhold'));
  assert.ok(app.includes('withhold-output'));
  assert.match(app, /v1\.222/);
  assert.ok(readme.includes('Withholding model'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelIndexedAmount } from '../src/domain.js';

// Indexation model (v1.241): a NEW axis — a stated amount
// indexed at a stated rate per period for stated periods,
// compounded as an exact rational and floored ONCE at the
// end. adjusted x denominator + remainder === amount x
// numerator exactly. A simple adjustment prices every
// period on the original amount and is pinned against; a
// rate of zero or zero periods states no indexation.
const DEFAULT = { amount: '1000', rateBps: 250, periods: 3, decimals: 6 };

test('the preloaded indexation: 1,000 at 250 bps for 3 periods becomes 1076.890625, an increase of 76.890625', () => {
  const r = modelIndexedAmount(DEFAULT);
  assert.equal(r.amount, 1000000000n);
  assert.equal(r.adjustedAmount, 1076890625n);
  assert.equal(r.adjustmentAmount, 76890625n);
  assert.equal(r.adjustedShareBpsText, '10768.90');
  assert.equal(r.adjustmentShareBpsText, '768.90');
  assert.equal(r.noIndexationStated, false);
  assert.equal(r.decreaseStated, false);
});

test('the exact identity holds: adjusted x denominator + remainder is amount x numerator', () => {
  const r = modelIndexedAmount(DEFAULT);
  assert.equal(r.factorNumerator, 10250n ** 3n);
  assert.equal(r.factorDenominator, 10000n ** 3n);
  assert.equal(r.adjustedAmount * r.factorDenominator + r.remainderNumerator, r.amount * r.factorNumerator);
  assert.ok(r.remainderNumerator >= 0n && r.remainderNumerator < r.factorDenominator);
});

test('compounding is pinned against the simple measure: 1,000 at 250 bps for 3 periods is not 1,075', () => {
  const r = modelIndexedAmount(DEFAULT);
  const simple = r.amount + r.amount * 250n * 3n / 10000n;
  assert.equal(simple, 1075000000n);
  assert.equal(r.adjustedAmount - simple, 1890625n);
});

test('flooring once at the end is pinned against per-period flooring: 999 base units at 250 bps for 2 periods state 1,049, not 1,048', () => {
  const r = modelIndexedAmount({ amount: '0.000999', rateBps: 250, periods: 2, decimals: 6 });
  assert.equal(r.amount, 999n);
  assert.equal(r.adjustedAmount, 1049n);
  assert.equal(r.remainderNumerator, 57437500n);
  let perPeriod = 999n;
  for (let i = 0; i < 2; i++) perPeriod = perPeriod * 10250n / 10000n;
  assert.equal(perPeriod, 1048n);
});

test('a falling index is stated: 1,000 at -1,000 bps for 2 periods falls to 810, and the simple measure overstates the fall at 800', () => {
  const r = modelIndexedAmount({ amount: '1000', rateBps: -1000, periods: 2, decimals: 6 });
  assert.equal(r.adjustedAmount, 810000000n);
  assert.equal(r.adjustmentAmount, -190000000n);
  assert.equal(r.adjustedShareBpsText, '8100.00');
  assert.equal(r.adjustmentShareBpsText, '1900.00');
  assert.equal(r.decreaseStated, true);
  const simple = r.amount + r.amount * -1000n * 2n / 10000n;
  assert.equal(simple, 800000000n);
  assert.ok(r.adjustedAmount > simple);
});

test('a rate of zero states no indexation: the amount stands as stated', () => {
  const r = modelIndexedAmount({ ...DEFAULT, rateBps: 0 });
  assert.equal(r.adjustedAmount, r.amount);
  assert.equal(r.adjustmentAmount, 0n);
  assert.equal(r.noRateStated, true);
  assert.equal(r.noIndexationStated, true);
});

test('zero periods states no indexation, whatever rate is stated', () => {
  const r = modelIndexedAmount({ ...DEFAULT, periods: 0 });
  assert.equal(r.adjustedAmount, r.amount);
  assert.equal(r.factorNumerator, 1n);
  assert.equal(r.factorDenominator, 1n);
  assert.equal(r.noPeriodsElapsed, true);
  assert.equal(r.noIndexationStated, true);
});

test('an increase below one whole base unit leaves the amount unchanged and flags it', () => {
  const r = modelIndexedAmount({ amount: '0.000001', rateBps: 1, periods: 1, decimals: 6 });
  assert.equal(r.amount, 1n);
  assert.equal(r.adjustedAmount, 1n);
  assert.equal(r.remainderNumerator, 1n);
  assert.equal(r.increaseBelowOneBaseUnit, true);
});

test('a rate of the whole per period compounds exactly: 100 at 10,000 bps for 2 periods becomes 400', () => {
  const r = modelIndexedAmount({ amount: '100', rateBps: 10000, periods: 2, decimals: 6 });
  assert.equal(r.adjustedAmount, 400000000n);
  assert.equal(r.adjustmentAmount, 300000000n);
});

test('one period states the single-period factor exactly: 200 at 500 bps becomes 210', () => {
  const r = modelIndexedAmount({ amount: '200', rateBps: 500, periods: 1, decimals: 6 });
  assert.equal(r.adjustedAmount, 210000000n);
  assert.equal(r.remainderNumerator, 0n);
});

test('amounts beyond float precision stay exact: a 2^53+1 amount at 10,000 bps for 1 period doubles exactly', () => {
  const r = modelIndexedAmount({ amount: '9007199254740993', rateBps: 10000, periods: 1, decimals: 0 });
  assert.equal(r.adjustedAmount, 18014398509481986n);
  assert.equal(r.adjustmentAmount, 9007199254740993n);
});

test('a rate beyond the modeled range is refused in both directions', () => {
  assert.throws(() => modelIndexedAmount({ ...DEFAULT, rateBps: 10001 }), /Indexation rate must be/);
  assert.throws(() => modelIndexedAmount({ ...DEFAULT, rateBps: -10000 }), /Indexation rate must be/);
  assert.throws(() => modelIndexedAmount({ ...DEFAULT, rateBps: 2.5 }), /Indexation rate must be/);
});

test('periods outside 0 to 100, or not whole, are refused', () => {
  assert.throws(() => modelIndexedAmount({ ...DEFAULT, periods: 101 }), /Periods must be/);
  assert.throws(() => modelIndexedAmount({ ...DEFAULT, periods: -1 }), /Periods must be/);
  assert.throws(() => modelIndexedAmount({ ...DEFAULT, periods: 1.5 }), /Periods must be/);
});

test('a zero amount is refused', () => {
  assert.throws(() => modelIndexedAmount({ ...DEFAULT, amount: '0' }), /Amount must be greater than zero/);
});

test('what is not priced is stated: index source, rate collar, and tax on the adjustment are flagged unpriced', () => {
  const r = modelIndexedAmount(DEFAULT);
  assert.equal(r.indexSourcePriced, false);
  assert.equal(r.rateCollarPriced, false);
  assert.equal(r.taxOnAdjustmentPriced, false);
});

test('wiring: the app imports the model, renders an indexation panel, and the README names the model', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(app.includes('modelIndexedAmount'));
  assert.ok(app.includes('data-idxamt'));
  assert.ok(app.includes('idxamt-output'));
  assert.match(app, /v1\.241/);
  assert.ok(readme.includes('Indexation model'));
});

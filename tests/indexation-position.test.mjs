import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelIndexedAmount, modelIndexedAmountPosition } from '../src/domain.js';

// Indexation position model (v1.220): the indexation
// model's second moment — a position part way through its
// periods. Both the elapsed and the total amounts are
// measured from the ORIGINAL amount by composing
// modelIndexedAmount unchanged; the final amount is never
// stated by re-compounding the floored current amount.
// elapsed adjustment + remaining adjustment === total
// adjustment, and current + remaining === final, exactly.
const DEFAULT = { amount: '1000', rateBps: 250, totalPeriods: 3, elapsedPeriods: 1, decimals: 6 };

test('the preloaded position: 1,000 at 250 bps, 1 of 3 periods elapsed, stands at 1,025 with 51.890625 still to come toward 1076.890625', () => {
  const r = modelIndexedAmountPosition(DEFAULT);
  assert.equal(r.amount, 1000000000n);
  assert.equal(r.currentAmount, 1025000000n);
  assert.equal(r.finalAmount, 1076890625n);
  assert.equal(r.elapsedAdjustmentAmount, 25000000n);
  assert.equal(r.totalAdjustmentAmount, 76890625n);
  assert.equal(r.remainingAdjustmentAmount, 51890625n);
  assert.equal(r.remainingPeriods, 2);
  assert.equal(r.currentShareBpsText, '10250.00');
  assert.equal(r.finalShareBpsText, '10768.90');
  assert.equal(r.elapsedAdjustmentShareBpsText, '250.00');
  assert.equal(r.remainingAdjustmentShareBpsText, '518.90');
  assert.equal(r.positionComplete, false);
  assert.equal(r.noPeriodsElapsed, false);
});

test('the identities hold exactly: elapsed plus remaining is the total adjustment, and current plus remaining is final', () => {
  const r = modelIndexedAmountPosition(DEFAULT);
  assert.equal(r.elapsedAdjustmentAmount + r.remainingAdjustmentAmount, r.totalAdjustmentAmount);
  assert.equal(r.currentAmount + r.remainingAdjustmentAmount, r.finalAmount);
  assert.equal(r.elapsedPeriods + r.remainingPeriods, r.totalPeriods);
});

test('both moments agree with the indexation model measured from the original amount', () => {
  const r = modelIndexedAmountPosition(DEFAULT);
  assert.equal(r.currentAmount, modelIndexedAmount({ amount: '1000', rateBps: 250, periods: 1, decimals: 6 }).adjustedAmount);
  assert.equal(r.finalAmount, modelIndexedAmount({ amount: '1000', rateBps: 250, periods: 3, decimals: 6 }).adjustedAmount);
});

test('re-compounding the floored current amount is pinned against: 999 base units, 1 of 2 periods elapsed, final is 1,049 not 1,048', () => {
  const r = modelIndexedAmountPosition({ amount: '0.000999', rateBps: 250, totalPeriods: 2, elapsedPeriods: 1, decimals: 6 });
  assert.equal(r.currentAmount, 1023n);
  assert.equal(r.finalAmount, 1049n);
  assert.equal(r.remainingAdjustmentAmount, 26n);
  const recompounded = r.currentAmount * 10250n / 10000n;
  assert.equal(recompounded, 1048n);
  assert.equal(r.finalAmount - recompounded, 1n);
});

test('a falling index position is stated: 1,000 at -1,000 bps, 1 of 2 periods elapsed, stands at 900 toward a final 810', () => {
  const r = modelIndexedAmountPosition({ amount: '1000', rateBps: -1000, totalPeriods: 2, elapsedPeriods: 1, decimals: 6 });
  assert.equal(r.currentAmount, 900000000n);
  assert.equal(r.finalAmount, 810000000n);
  assert.equal(r.elapsedAdjustmentAmount, -100000000n);
  assert.equal(r.remainingAdjustmentAmount, -90000000n);
  assert.equal(r.totalAdjustmentAmount, -190000000n);
  assert.equal(r.decreaseStated, true);
});

test('no periods elapsed states the position at its start: current is the stated amount and the whole adjustment remains', () => {
  const r = modelIndexedAmountPosition({ ...DEFAULT, elapsedPeriods: 0 });
  assert.equal(r.currentAmount, r.amount);
  assert.equal(r.elapsedAdjustmentAmount, 0n);
  assert.equal(r.remainingAdjustmentAmount, r.totalAdjustmentAmount);
  assert.equal(r.noPeriodsElapsed, true);
  assert.equal(r.positionComplete, false);
});

test('all periods elapsed states the position complete: current is final and nothing remains', () => {
  const r = modelIndexedAmountPosition({ ...DEFAULT, elapsedPeriods: 3 });
  assert.equal(r.currentAmount, r.finalAmount);
  assert.equal(r.remainingAdjustmentAmount, 0n);
  assert.equal(r.remainingPeriods, 0);
  assert.equal(r.positionComplete, true);
});

test('a rate of zero states no indexation at any point in the position', () => {
  const r = modelIndexedAmountPosition({ ...DEFAULT, rateBps: 0 });
  assert.equal(r.currentAmount, r.amount);
  assert.equal(r.finalAmount, r.amount);
  assert.equal(r.remainingAdjustmentAmount, 0n);
  assert.equal(r.noRateStated, true);
});

test('zero total periods states no position: the amount stands as stated', () => {
  const r = modelIndexedAmountPosition({ ...DEFAULT, totalPeriods: 0, elapsedPeriods: 0 });
  assert.equal(r.currentAmount, r.amount);
  assert.equal(r.finalAmount, r.amount);
  assert.equal(r.noTotalPeriods, true);
});

test('a remaining increase below one whole base unit leaves the final amount equal to the current and flags it', () => {
  const r = modelIndexedAmountPosition({ amount: '0.000001', rateBps: 1, totalPeriods: 2, elapsedPeriods: 1, decimals: 6 });
  assert.equal(r.currentAmount, 1n);
  assert.equal(r.finalAmount, 1n);
  assert.equal(r.remainingAdjustmentAmount, 0n);
  assert.equal(r.remainingBelowOneBaseUnit, true);
});

test('amounts beyond float precision stay exact through the position: a 2^53+1 amount at 10,000 bps, 1 of 2 periods elapsed', () => {
  const r = modelIndexedAmountPosition({ amount: '9007199254740993', rateBps: 10000, totalPeriods: 2, elapsedPeriods: 1, decimals: 0 });
  assert.equal(r.currentAmount, 18014398509481986n);
  assert.equal(r.finalAmount, 36028797018963972n);
  assert.equal(r.remainingAdjustmentAmount, 18014398509481986n);
});

test('elapsed periods beyond the total are refused, never capped', () => {
  assert.throws(() => modelIndexedAmountPosition({ ...DEFAULT, elapsedPeriods: 4 }), /Elapsed periods must not exceed total periods/);
});

test('period counts outside 0 to 100, or not whole, are refused', () => {
  assert.throws(() => modelIndexedAmountPosition({ ...DEFAULT, totalPeriods: 101 }), /Total periods must be/);
  assert.throws(() => modelIndexedAmountPosition({ ...DEFAULT, elapsedPeriods: -1 }), /Elapsed periods must be/);
  assert.throws(() => modelIndexedAmountPosition({ ...DEFAULT, elapsedPeriods: 1.5 }), /Elapsed periods must be/);
});

test('a rate outside the indexation range is refused by the composed model', () => {
  assert.throws(() => modelIndexedAmountPosition({ ...DEFAULT, rateBps: -10000 }), /Indexation rate must be/);
  assert.throws(() => modelIndexedAmountPosition({ ...DEFAULT, rateBps: 10001 }), /Indexation rate must be/);
});

test('what is not priced is stated: a future rate change, index source, rate collar, and tax are flagged unpriced', () => {
  const r = modelIndexedAmountPosition(DEFAULT);
  assert.equal(r.futureRateChangePriced, false);
  assert.equal(r.indexSourcePriced, false);
  assert.equal(r.rateCollarPriced, false);
  assert.equal(r.taxOnAdjustmentPriced, false);
});

test('wiring: the app imports the position model, renders an indexation position panel, and the README names the model', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(app.includes('modelIndexedAmountPosition'));
  assert.ok(app.includes('data-idxpos'));
  assert.ok(app.includes('idxpos-output'));
  assert.match(app, /v1\.220/);
  assert.ok(readme.includes('Indexation position model'));
});

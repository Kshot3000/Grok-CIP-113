import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelCashback, modelCashbackClawback } from '../src/domain.js';

// Cashback clawback model (v1.229): the cashback axis's
// second moment — a later refund takes back the pro-rata
// share of the cashback actually returned that belonged
// to the refunded part: floor(cashback x refund /
// purchase), never the stated rate re-applied to the
// refund. Identities: clawback + retained === cashback;
// refund + kept === purchase; kept - retained === net.
const DEFAULT = { amount: '1000', cashbackRateBps: 500, refundAmount: '400', decimals: 6 };

test('the preloaded clawback: refunding 400 of a 1,000 purchase at 5% claws back 20 of the 50 cashback, retains 30, and the standing 600 costs 570 net', () => {
  const r = modelCashbackClawback(DEFAULT);
  assert.equal(r.amount, 1000000000n);
  assert.equal(r.cashbackAmount, 50000000n);
  assert.equal(r.refundAmount, 400000000n);
  assert.equal(r.clawbackAmount, 20000000n);
  assert.equal(r.retainedCashbackAmount, 30000000n);
  assert.equal(r.keptPurchaseAmount, 600000000n);
  assert.equal(r.netCostAmount, 570000000n);
  assert.equal(r.netCostBeforeRefundAmount, 950000000n);
  assert.equal(r.refundShareBpsText, '4000.00');
  assert.equal(r.clawbackShareBpsText, '4000.00');
  assert.equal(r.retainedShareBpsText, '6000.00');
  assert.equal(r.refundIsPartial, true);
  assert.equal(r.refundIsWhole, false);
});

test('the clawback composes the cashback model unchanged', () => {
  const base = modelCashback({ amount: DEFAULT.amount, cashbackRateBps: DEFAULT.cashbackRateBps, decimals: 6 });
  const r = modelCashbackClawback(DEFAULT);
  assert.equal(r.cashbackAmount, base.cashbackAmount);
  assert.equal(r.netCostBeforeRefundAmount, base.netCostAmount);
  assert.equal(r.amountPaidAtPurchase, base.amountPaidAtPurchase);
});

test('identities hold across cases: clawback + retained is the cashback, refund + kept is the purchase, kept - retained is the net cost', () => {
  const cases = [
    DEFAULT,
    { amount: '777', cashbackRateBps: 250, refundAmount: '123', decimals: 0 },
    { amount: '999', cashbackRateBps: 500, refundAmount: '500', decimals: 0 },
    { amount: '100', cashbackRateBps: 10000, refundAmount: '100', decimals: 6 },
    { amount: '100', cashbackRateBps: 0, refundAmount: '40', decimals: 6 },
    { amount: '1000', cashbackRateBps: 500, refundAmount: '0', decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelCashbackClawback(c);
    assert.equal(r.clawbackAmount + r.retainedCashbackAmount, r.cashbackAmount);
    assert.equal(r.refundAmount + r.keptPurchaseAmount, r.amount);
    assert.equal(r.keptPurchaseAmount - r.retainedCashbackAmount, r.netCostAmount);
  }
});

test('the clawback is the pro-rata share of the cashback actually returned, never the rate re-applied to the refund', () => {
  // Decimals 0: 999 at 500 bps returns floor(999 x 500 / 10000) = 49.
  // A 500 refund's pro-rata clawback is floor(49 x 500 / 999) = 24;
  // the rate taken on the 500 refund states 25 — one unit more than
  // the refunded part's share of what actually came back.
  const r = modelCashbackClawback({ amount: '999', cashbackRateBps: 500, refundAmount: '500', decimals: 0 });
  assert.equal(r.cashbackAmount, 49n);
  assert.equal(r.clawbackAmount, 24n);
  assert.equal(r.retainedCashbackAmount, 25n);
  assert.equal(r.netCostAmount, 474n);
  assert.equal(r.clawbackRecomputedFromRate, false);
});

test('the clawback never exceeds the cashback actually returned', () => {
  for (const refundAmount of ['1', '250', '500', '999', '1000']) {
    const r = modelCashbackClawback({ amount: '1000', cashbackRateBps: 500, refundAmount, decimals: 0 });
    assert.ok(r.clawbackAmount <= r.cashbackAmount);
    assert.equal(r.clawbackIsFee, false);
    assert.equal(r.clawbackIsPenalty, false);
  }
});

test('a refund of zero states no clawback: the cashback stands whole and the net cost is the base net cost', () => {
  const r = modelCashbackClawback({ ...DEFAULT, refundAmount: '0' });
  assert.equal(r.noRefundStated, true);
  assert.equal(r.clawbackAmount, 0n);
  assert.equal(r.retainedCashbackAmount, r.cashbackAmount);
  assert.equal(r.netCostAmount, r.netCostBeforeRefundAmount);
});

test('a refund of the whole purchase claws the cashback back whole: retained zero, net cost zero', () => {
  const r = modelCashbackClawback({ ...DEFAULT, refundAmount: '1000' });
  assert.equal(r.refundIsWhole, true);
  assert.equal(r.clawbackTakesWholeCashback, true);
  assert.equal(r.clawbackAmount, r.cashbackAmount);
  assert.equal(r.retainedCashbackAmount, 0n);
  assert.equal(r.keptPurchaseAmount, 0n);
  assert.equal(r.netCostAmount, 0n);
});

test('a refund beyond the purchase is refused, never capped', () => {
  assert.throws(() => modelCashbackClawback({ ...DEFAULT, refundAmount: '1001' }), /must not exceed the purchase/);
  assert.throws(() => modelCashbackClawback({ amount: '0', cashbackRateBps: 500, refundAmount: '0', decimals: 6 }), /greater than zero/);
});

test('where no cashback rate is stated there is nothing to claw back, whatever the refund', () => {
  const r = modelCashbackClawback({ amount: '1000', cashbackRateBps: 0, refundAmount: '400', decimals: 6 });
  assert.equal(r.noCashbackStated, true);
  assert.equal(r.noCashbackToClawBack, true);
  assert.equal(r.clawbackAmount, 0n);
  assert.equal(r.netCostAmount, 600000000n);
});

test('where the stated rate floors to zero there is nothing to claw back', () => {
  const r = modelCashbackClawback({ amount: '0.000001', cashbackRateBps: 500, refundAmount: '0.000001', decimals: 6 });
  assert.equal(r.cashbackAmount, 0n);
  assert.equal(r.cashbackFloorsToZero, true);
  assert.equal(r.noCashbackToClawBack, true);
  assert.equal(r.clawbackAmount, 0n);
});

test('a small partial refund whose pro-rata share is below one base unit claws nothing back at that size', () => {
  const r = modelCashbackClawback({ amount: '1000', cashbackRateBps: 500, refundAmount: '1', decimals: 0 });
  assert.equal(r.cashbackAmount, 50n);
  assert.equal(r.clawbackAmount, 0n);
  assert.equal(r.clawbackFloorsToZero, true);
  assert.equal(r.retainedCashbackAmount, 50n);
  assert.equal(r.netCostAmount, 949n);
});

test('a whole-rate cashback refunded in part keeps the same share: refunding half of a fully returned purchase claws half back', () => {
  const r = modelCashbackClawback({ amount: '200', cashbackRateBps: 10000, refundAmount: '100', decimals: 0 });
  assert.equal(r.cashbackAmount, 200n);
  assert.equal(r.clawbackAmount, 100n);
  assert.equal(r.retainedCashbackAmount, 100n);
  assert.equal(r.netCostAmount, 0n);
});

test('the buyer still paid the purchase whole first, whatever the refund', () => {
  for (const refundAmount of ['0', '400', '1000']) {
    const r = modelCashbackClawback({ ...DEFAULT, refundAmount });
    assert.equal(r.amountPaidAtPurchase, r.amount);
  }
});

test('what is not priced stays unpriced: refund eligibility, timing, and clawback recovery', () => {
  const r = modelCashbackClawback(DEFAULT);
  assert.equal(r.refundEligibilityPriced, false);
  assert.equal(r.refundTimingPriced, false);
  assert.equal(r.clawbackRecoveryPriced, false);
  assert.equal(r.clawbackIsFee, false);
  assert.equal(r.clawbackIsPenalty, false);
});

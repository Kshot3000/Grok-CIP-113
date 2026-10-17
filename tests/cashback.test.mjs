import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelCashback } from '../src/domain.js';

// Cashback model (v1.236): a NEW axis — the buyer pays the
// FULL purchase amount first and a stated share of it
// comes back afterwards. The cashback is floor(purchase x
// rate / 10,000), measured against the full purchase,
// never against the net cost it itself leaves; cashback +
// net cost === purchase exactly, and the amount paid at
// purchase is the purchase whole. A cashback is not a
// discount. No eligibility, cap, timing, funding, or
// refund clawback priced.
const DEFAULT = { amount: '1000', cashbackRateBps: 500, decimals: 6 };

test('the preloaded cashback: a 1,000 purchase at a stated 5% returns 50 and leaves a net cost of 950', () => {
  const r = modelCashback(DEFAULT);
  assert.equal(r.amount, 1000000000n);
  assert.equal(r.cashbackRateBps, 500);
  assert.equal(r.cashbackAmount, 50000000n);
  assert.equal(r.netCostAmount, 950000000n);
  assert.equal(r.cashbackShareBpsText, '500.00');
  assert.equal(r.netCostShareBpsText, '9500.00');
  assert.equal(r.noCashbackStated, false);
  assert.equal(r.cashbackReturnsWhole, false);
});

test('the buyer pays the purchase whole at the point of sale, whatever the rate', () => {
  for (const cashbackRateBps of [0, 500, 5000, 10000]) {
    const r = modelCashback({ ...DEFAULT, cashbackRateBps });
    assert.equal(r.amountPaidAtPurchase, r.amount);
  }
});

test('identity holds across purchases: cashback plus net cost is the purchase, exactly', () => {
  const cases = [
    DEFAULT,
    { amount: '777', cashbackRateBps: 250, decimals: 0 },
    { amount: '100', cashbackRateBps: 10000, decimals: 6 },
    { amount: '100', cashbackRateBps: 0, decimals: 6 },
    { amount: '0.000001', cashbackRateBps: 500, decimals: 6 },
    { amount: '9007199254740993', cashbackRateBps: 500, decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelCashback(c);
    assert.equal(r.cashbackAmount + r.netCostAmount, r.amount);
    assert.ok(r.cashbackAmount <= r.amount);
  }
});

test('measuring the cashback against the net cost instead would understate it: the base is the full purchase', () => {
  const r = modelCashback({ amount: '1000', cashbackRateBps: 500, decimals: 0 });
  const cashbackOnNet = r.netCostAmount * BigInt(r.cashbackRateBps) / 10000n;
  assert.equal(cashbackOnNet, 47n);
  assert.equal(r.cashbackAmount, 50n);
  assert.equal(r.cashbackAmount - cashbackOnNet, 3n);
  assert.equal(r.cashbackMeasuredOnNetCost, false);
});

test('a cashback is not a discount: the amount paid is never reduced, only the net cost falls', () => {
  const r = modelCashback(DEFAULT);
  assert.equal(r.cashbackIsDiscount, false);
  assert.equal(r.amountPaidAtPurchase, 1000000000n);
  assert.ok(r.netCostAmount < r.amountPaidAtPurchase);
});

test('a cashback rate of zero states no cashback: nothing comes back and the net cost is the purchase whole', () => {
  const r = modelCashback({ ...DEFAULT, cashbackRateBps: 0 });
  assert.equal(r.cashbackAmount, 0n);
  assert.equal(r.netCostAmount, r.amount);
  assert.equal(r.noCashbackStated, true);
  assert.equal(r.cashbackShareBpsText, '0.00');
  assert.equal(r.netCostShareBpsText, '10000.00');
});

test('a stated rate that floors to zero on a one-base-unit purchase returns nothing at that size', () => {
  const r = modelCashback({ amount: '0.000001', cashbackRateBps: 500, decimals: 6 });
  assert.equal(r.amount, 1n);
  assert.equal(r.cashbackAmount, 0n);
  assert.equal(r.netCostAmount, 1n);
  assert.equal(r.cashbackFloorsToZero, true);
  assert.equal(r.noCashbackStated, false);
});

test('a cashback rate of the whole returns the purchase whole, stated: the net cost is zero and the buyer still paid in full first', () => {
  const r = modelCashback({ ...DEFAULT, cashbackRateBps: 10000 });
  assert.equal(r.cashbackAmount, r.amount);
  assert.equal(r.netCostAmount, 0n);
  assert.equal(r.amountPaidAtPurchase, r.amount);
  assert.equal(r.cashbackReturnsWhole, true);
  assert.equal(r.cashbackFloorsToZero, false);
});

test('flooring is exact at no decimals: 777 at 250 bps returns 19 and leaves 758', () => {
  const r = modelCashback({ amount: '777', cashbackRateBps: 250, decimals: 0 });
  assert.equal(r.cashbackAmount, 19n);
  assert.equal(r.netCostAmount, 758n);
  assert.equal(r.cashbackShareBpsText, '244.53');
  assert.equal(r.netCostShareBpsText, '9755.46');
});

test('a purchase of zero or less is refused', () => {
  assert.throws(() => modelCashback({ amount: '0', cashbackRateBps: 500 }), /greater than zero/);
});

test('a cashback rate beyond the whole is refused, as is a fractional rate', () => {
  assert.throws(() => modelCashback({ ...DEFAULT, cashbackRateBps: 10001 }), /basis points between 0 and 10,000/);
  assert.throws(() => modelCashback({ ...DEFAULT, cashbackRateBps: -1 }), /basis points between 0 and 10,000/);
  assert.throws(() => modelCashback({ ...DEFAULT, cashbackRateBps: 2.5 }), /basis points between 0 and 10,000/);
});

test('nothing beyond the return is priced: eligibility, cap, timing, funding, and refund clawback are all unpriced', () => {
  const r = modelCashback(DEFAULT);
  assert.equal(r.eligibilityPriced, false);
  assert.equal(r.cashbackCapPriced, false);
  assert.equal(r.cashbackTimingPriced, false);
  assert.equal(r.cashbackFundingPriced, false);
  assert.equal(r.refundClawbackPriced, false);
});

test('decimals follow the design: the same purchase at 0 decimals states whole units', () => {
  const r = modelCashback({ amount: '1000', cashbackRateBps: 500, decimals: 0 });
  assert.equal(r.decimals, 0);
  assert.equal(r.amount, 1000n);
  assert.equal(r.cashbackAmount, 50n);
  assert.equal(r.netCostAmount, 950n);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelLoyaltyRedemption } from '../src/domain.js';

// Loyalty-points redemption model (v1.259): a NEW axis —
// points are not money; they become value only at a stated
// redemption value per point. Points are taken whole, each
// gives exactly its stated value, and only the whole points
// that fit inside the purchase are taken. Identities:
// applied + remaining due === purchase; points used +
// points remaining === points held; applied === points
// used x value per point.
const DEFAULT = { amount: '250', pointsBalance: '400', pointValueAmount: '1', decimals: 6 };

test('the preloaded redemption: 250 of 400 points at 1 each pays the 250 purchase whole and 150 points stay standing', () => {
  const r = modelLoyaltyRedemption(DEFAULT);
  assert.equal(r.amount, 250000000n);
  assert.equal(r.pointsBalance, 400n);
  assert.equal(r.pointValueAmount, 1000000n);
  assert.equal(r.grossValueAmount, 400000000n);
  assert.equal(r.pointsUsed, 250n);
  assert.equal(r.appliedAmount, 250000000n);
  assert.equal(r.remainingDueAmount, 0n);
  assert.equal(r.pointsRemaining, 150n);
  assert.equal(r.appliedShareBpsText, '10000.00');
  assert.equal(r.pointsUsedShareBpsText, '6250.00');
  assert.equal(r.pointsCoverWhole, true);
  assert.equal(r.balanceValueExceedsPurchase, true);
  assert.equal(r.excessPaidAsCash, false);
});

test('identities hold across cases: applied plus due is the purchase, used plus remaining is the balance held, applied is used times value', () => {
  const cases = [
    DEFAULT,
    { amount: '100', pointsBalance: '150', pointValueAmount: '0.5', decimals: 6 },
    { amount: '10', pointsBalance: '10', pointValueAmount: '3', decimals: 0 },
    { amount: '250', pointsBalance: '0', pointValueAmount: '1', decimals: 6 },
    { amount: '100', pointsBalance: '100', pointValueAmount: '1', decimals: 6 },
    { amount: '1', pointsBalance: '3', pointValueAmount: '2', decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelLoyaltyRedemption(c);
    assert.equal(r.appliedAmount + r.remainingDueAmount, r.amount);
    assert.equal(r.pointsUsed + r.pointsRemaining, r.pointsBalance);
    assert.equal(r.appliedAmount, r.pointsUsed * r.pointValueAmount);
    assert.ok(r.appliedAmount <= r.amount);
    assert.ok(r.pointsUsed <= r.pointsBalance);
  }
});

test('points worth less than the purchase apply whole: 150 points at 0.5 each apply 75 to a 100 purchase and 25 remains due', () => {
  const r = modelLoyaltyRedemption({ amount: '100', pointsBalance: '150', pointValueAmount: '0.5', decimals: 6 });
  assert.equal(r.pointsUsed, 150n);
  assert.equal(r.appliedAmount, 75000000n);
  assert.equal(r.remainingDueAmount, 25000000n);
  assert.equal(r.pointsRemaining, 0n);
  assert.equal(r.pointsArePartial, true);
  assert.equal(r.allPointsUsed, true);
  assert.equal(r.appliedShareBpsText, '7500.00');
  assert.equal(r.pointsUsedShareBpsText, '10000.00');
});

test('a remainder below one point is left due while points still stand: a 10 purchase at 3 per point takes 3 points, applies 9, and leaves 1 due with 7 points standing', () => {
  const r = modelLoyaltyRedemption({ amount: '10', pointsBalance: '10', pointValueAmount: '3', decimals: 0 });
  assert.equal(r.pointsUsed, 3n);
  assert.equal(r.appliedAmount, 9n);
  assert.equal(r.remainingDueAmount, 1n);
  assert.equal(r.pointsRemaining, 7n);
  assert.equal(r.remainderBelowOnePoint, true);
  assert.equal(r.balanceValueExceedsPurchase, true);
  assert.equal(r.appliedShareBpsText, '9000.00');
  assert.equal(r.pointsUsedShareBpsText, '3000.00');
});

test('a purchase smaller than one point redeems nothing: a 1 purchase at 2 per point takes no point, because a whole point would overshoot it', () => {
  const r = modelLoyaltyRedemption({ amount: '1', pointsBalance: '3', pointValueAmount: '2', decimals: 0 });
  assert.equal(r.pointsUsed, 0n);
  assert.equal(r.appliedAmount, 0n);
  assert.equal(r.remainingDueAmount, 1n);
  assert.equal(r.pointsRemaining, 3n);
  assert.equal(r.remainderBelowOnePoint, true);
  assert.equal(r.noPointsStated, false);
});

test('no points stated states no redemption: the whole purchase remains due', () => {
  const r = modelLoyaltyRedemption({ amount: '250', pointsBalance: '0', pointValueAmount: '1', decimals: 6 });
  assert.equal(r.noPointsStated, true);
  assert.equal(r.pointsUsed, 0n);
  assert.equal(r.appliedAmount, 0n);
  assert.equal(r.remainingDueAmount, 250000000n);
  assert.equal(r.appliedShareBpsText, '0.00');
});

test('points that exactly cover the purchase take every point and leave nothing due and nothing standing', () => {
  const r = modelLoyaltyRedemption({ amount: '100', pointsBalance: '100', pointValueAmount: '1', decimals: 6 });
  assert.equal(r.pointsExactlyCover, true);
  assert.equal(r.pointsCoverWhole, true);
  assert.equal(r.allPointsUsed, true);
  assert.equal(r.pointsRemaining, 0n);
  assert.equal(r.remainingDueAmount, 0n);
});

test('the gross value beyond the purchase is never applied and never paid as cash: applied is capped by the purchase however large the balance', () => {
  const r = modelLoyaltyRedemption({ amount: '10', pointsBalance: '1000000', pointValueAmount: '1', decimals: 0 });
  assert.equal(r.grossValueAmount, 1000000n);
  assert.equal(r.appliedAmount, 10n);
  assert.equal(r.pointsUsed, 10n);
  assert.equal(r.pointsRemaining, 999990n);
  assert.equal(r.excessPaidAsCash, false);
});

test('the smallest units convert exactly: 3 points at 0.000002 each apply 0.000006 to a 0.000010 purchase', () => {
  const r = modelLoyaltyRedemption({ amount: '0.000010', pointsBalance: '3', pointValueAmount: '0.000002', decimals: 6 });
  assert.equal(r.pointsUsed, 3n);
  assert.equal(r.appliedAmount, 6n);
  assert.equal(r.remainingDueAmount, 4n);
  assert.equal(r.appliedShareBpsText, '6000.00');
});

test('shares are floored from the amounts: 3 of 10 points used is 3000.00, never rounded up', () => {
  const r = modelLoyaltyRedemption({ amount: '10', pointsBalance: '10', pointValueAmount: '3', decimals: 0 });
  assert.equal(r.pointsUsedShareBpsText, '3000.00');
  const r2 = modelLoyaltyRedemption({ amount: '3', pointsBalance: '3', pointValueAmount: '2', decimals: 0 });
  assert.equal(r2.pointsUsed, 1n);
  assert.equal(r2.appliedAmount, 2n);
  assert.equal(r2.pointsUsedShareBpsText, '3333.33');
});

test('a redemption is not stored value, not a discount, and not cashback', () => {
  const r = modelLoyaltyRedemption(DEFAULT);
  assert.equal(r.redemptionIsStoredValue, false);
  assert.equal(r.redemptionIsDiscount, false);
  assert.equal(r.redemptionIsCashback, false);
});

test('a point value of zero is refused: a point with no stated value cannot be redeemed at a value', () => {
  assert.throws(() => modelLoyaltyRedemption({ amount: '10', pointsBalance: '5', pointValueAmount: '0', decimals: 6 }), /Point value must be greater than zero/);
});

test('a fractional or negative points balance and a zero purchase are refused', () => {
  assert.throws(() => modelLoyaltyRedemption({ amount: '10', pointsBalance: '2.5', pointValueAmount: '1', decimals: 6 }), /whole number of points/);
  assert.throws(() => modelLoyaltyRedemption({ amount: '10', pointsBalance: '-5', pointValueAmount: '1', decimals: 6 }), /whole number of points/);
  assert.throws(() => modelLoyaltyRedemption({ amount: '0', pointsBalance: '5', pointValueAmount: '1', decimals: 6 }), /Purchase amount must be greater than zero/);
});

test('what is not priced stays unpriced: earning, expiry, value change, minimum redemption, and transfer', () => {
  const r = modelLoyaltyRedemption(DEFAULT);
  assert.equal(r.pointsEarningPriced, false);
  assert.equal(r.pointsExpiryPriced, false);
  assert.equal(r.pointValueChangePriced, false);
  assert.equal(r.minimumRedemptionPriced, false);
  assert.equal(r.pointsTransferPriced, false);
});

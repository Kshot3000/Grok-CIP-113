import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelLoyaltyEarning } from '../src/domain.js';

// Loyalty-points earning model (v1.274): the loyalty axis's
// second moment — a stated purchase earns a stated whole
// number of points per whole token unit spent, floored once.
// Identity: points held before + points earned === points
// held after. A fraction below the next whole point earns
// nothing and is never rounded up.
const DEFAULT = { amount: '250', pointsBalance: '150', pointsPerUnit: '1', decimals: 6 };

test('the preloaded earning: a 250 purchase at 1 point per unit earns 250 points onto the 150 standing, for 400 after', () => {
  const r = modelLoyaltyEarning(DEFAULT);
  assert.equal(r.amount, 250000000n);
  assert.equal(r.pointsBalance, 150n);
  assert.equal(r.pointsPerUnit, 1n);
  assert.equal(r.pointsEarned, 250n);
  assert.equal(r.pointsBalanceAfter, 400n);
  assert.equal(r.earningRemainder, 0n);
  assert.equal(r.earningFloored, false);
  assert.equal(r.pointsEarnedShareBpsText, '6250.00');
});

test('identity holds across cases: before plus earned is after, and earned is the floor of purchase times rate per whole unit', () => {
  const cases = [
    DEFAULT,
    { amount: '10', pointsBalance: '7', pointsPerUnit: '3', decimals: 0 },
    { amount: '2.5', pointsBalance: '10', pointsPerUnit: '1', decimals: 6 },
    { amount: '0.5', pointsBalance: '5', pointsPerUnit: '1', decimals: 6 },
    { amount: '999', pointsBalance: '0', pointsPerUnit: '2', decimals: 0 },
    { amount: '100', pointsBalance: '5', pointsPerUnit: '0', decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelLoyaltyEarning(c);
    assert.equal(r.pointsBalance + r.pointsEarned, r.pointsBalanceAfter);
    const scale = 10n ** BigInt(r.decimals);
    assert.ok(r.pointsEarned * scale <= r.amount * r.pointsPerUnit);
    assert.ok(r.amount * r.pointsPerUnit < (r.pointsEarned + 1n) * scale);
    assert.equal(r.earningRemainder, r.amount * r.pointsPerUnit - r.pointsEarned * scale);
  }
});

test('a higher rate earns proportionally more whole points: 10 at 3 per unit earns 30', () => {
  const r = modelLoyaltyEarning({ amount: '10', pointsBalance: '7', pointsPerUnit: '3', decimals: 0 });
  assert.equal(r.pointsEarned, 30n);
  assert.equal(r.pointsBalanceAfter, 37n);
  assert.equal(r.pointsEarnedShareBpsText, '8108.10');
});

test('earning floors once: a 2.5 purchase at 1 per unit earns 2 points, never 3 — the half below the next point earns nothing', () => {
  const r = modelLoyaltyEarning({ amount: '2.5', pointsBalance: '10', pointsPerUnit: '1', decimals: 6 });
  assert.equal(r.pointsEarned, 2n);
  assert.equal(r.pointsBalanceAfter, 12n);
  assert.equal(r.earningRemainder, 500000n);
  assert.equal(r.earningFloored, true);
});

test('a purchase below the size that earns one whole point earns nothing at all', () => {
  const r = modelLoyaltyEarning({ amount: '0.5', pointsBalance: '5', pointsPerUnit: '1', decimals: 6 });
  assert.equal(r.pointsEarned, 0n);
  assert.equal(r.pointsBalanceAfter, 5n);
  assert.equal(r.noPointsEarned, true);
  assert.equal(r.purchaseBelowOnePoint, true);
});

test('no earn rate stated states NO EARNING and the balance stands as it was', () => {
  const r = modelLoyaltyEarning({ amount: '100', pointsBalance: '5', pointsPerUnit: '0', decimals: 6 });
  assert.equal(r.noEarningStated, true);
  assert.equal(r.noPointsEarned, true);
  assert.equal(r.purchaseBelowOnePoint, false);
  assert.equal(r.pointsEarned, 0n);
  assert.equal(r.pointsBalanceAfter, 5n);
});

test('earning onto an empty balance opens it at exactly what was earned', () => {
  const r = modelLoyaltyEarning({ amount: '999', pointsBalance: '0', pointsPerUnit: '2', decimals: 0 });
  assert.equal(r.pointsEarned, 1998n);
  assert.equal(r.pointsBalanceAfter, 1998n);
  assert.equal(r.pointsBalanceOpened, true);
  assert.equal(r.pointsEarnedShareBpsText, '10000.00');
});

test('an earning is not money, not cashback, not a discount, and not stored value', () => {
  const r = modelLoyaltyEarning(DEFAULT);
  assert.equal(r.earningIsMoney, false);
  assert.equal(r.earningIsCashback, false);
  assert.equal(r.earningIsDiscount, false);
  assert.equal(r.earningIsStoredValue, false);
});

test('a fractional or negative earn rate and a fractional points balance are refused', () => {
  assert.throws(() => modelLoyaltyEarning({ amount: '10', pointsBalance: '5', pointsPerUnit: '1.5', decimals: 6 }), /Points earned per token unit must be a whole number/);
  assert.throws(() => modelLoyaltyEarning({ amount: '10', pointsBalance: '5', pointsPerUnit: '-1', decimals: 6 }), /Points earned per token unit must be a whole number/);
  assert.throws(() => modelLoyaltyEarning({ amount: '10', pointsBalance: '2.5', pointsPerUnit: '1', decimals: 6 }), /Points balance must be a whole number/);
});

test('a zero purchase is refused: points are earned on a purchase, and no purchase earns on nothing', () => {
  assert.throws(() => modelLoyaltyEarning({ amount: '0', pointsBalance: '5', pointsPerUnit: '1', decimals: 6 }), /Purchase amount must be greater than zero/);
});

test('what is not priced stays unpriced: redemption value, expiry, transfer, tiers, caps, and minimum purchase', () => {
  const r = modelLoyaltyEarning(DEFAULT);
  assert.equal(r.pointsValuePriced, false);
  assert.equal(r.pointsExpiryPriced, false);
  assert.equal(r.pointsTransferPriced, false);
  assert.equal(r.earnTierPriced, false);
  assert.equal(r.earningCapPriced, false);
  assert.equal(r.minimumPurchasePriced, false);
});

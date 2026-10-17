import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelStoredValuePayment } from '../src/domain.js';

// Stored-value payment model (v1.245): a NEW axis — the
// buyer pays with value they already hold: applied is
// min(balance, purchase), capped by the amount due, and
// any excess STAYS on the balance, never paid out as
// cash. Identities: applied + remaining due === purchase;
// applied + balance remaining === balance.
const DEFAULT = { amount: '250', balanceAmount: '400', decimals: 6 };

test('the preloaded payment: a 250 purchase paid from a 400 balance applies 250, leaves nothing due, and leaves 150 standing', () => {
  const r = modelStoredValuePayment(DEFAULT);
  assert.equal(r.amount, 250000000n);
  assert.equal(r.balanceAmount, 400000000n);
  assert.equal(r.appliedAmount, 250000000n);
  assert.equal(r.remainingDueAmount, 0n);
  assert.equal(r.balanceRemainingAmount, 150000000n);
  assert.equal(r.appliedShareBpsText, '10000.00');
  assert.equal(r.balanceUsedShareBpsText, '6250.00');
  assert.equal(r.balanceCoversWhole, true);
  assert.equal(r.excessStaysOnBalance, true);
  assert.equal(r.balanceIsPartial, false);
});

test('identities hold across cases: applied + remaining due is the purchase, applied + balance remaining is the balance', () => {
  const cases = [
    DEFAULT,
    { amount: '250', balanceAmount: '100', decimals: 6 },
    { amount: '250', balanceAmount: '250', decimals: 6 },
    { amount: '250', balanceAmount: '0', decimals: 6 },
    { amount: '999', balanceAmount: '1', decimals: 0 },
    { amount: '0.000001', balanceAmount: '0.000002', decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelStoredValuePayment(c);
    assert.equal(r.appliedAmount + r.remainingDueAmount, r.amount);
    assert.equal(r.appliedAmount + r.balanceRemainingAmount, r.balanceAmount);
    assert.ok(r.appliedAmount <= r.amount);
    assert.ok(r.appliedAmount <= r.balanceAmount);
  }
});

test('a balance below the purchase applies whole and the remainder is still due', () => {
  const r = modelStoredValuePayment({ amount: '250', balanceAmount: '100', decimals: 6 });
  assert.equal(r.appliedAmount, 100000000n);
  assert.equal(r.remainingDueAmount, 150000000n);
  assert.equal(r.balanceRemainingAmount, 0n);
  assert.equal(r.balanceIsPartial, true);
  assert.equal(r.balanceCoversWhole, false);
  assert.equal(r.appliedShareBpsText, '4000.00');
  assert.equal(r.balanceUsedShareBpsText, '10000.00');
});

test('a balance exactly equal to the purchase leaves nothing due and nothing standing', () => {
  const r = modelStoredValuePayment({ amount: '250', balanceAmount: '250', decimals: 6 });
  assert.equal(r.appliedAmount, 250000000n);
  assert.equal(r.remainingDueAmount, 0n);
  assert.equal(r.balanceRemainingAmount, 0n);
  assert.equal(r.balanceExactlyCovers, true);
  assert.equal(r.excessStaysOnBalance, false);
});

test('a balance of zero states no stored value applied: the whole purchase remains due', () => {
  const r = modelStoredValuePayment({ amount: '250', balanceAmount: '0', decimals: 6 });
  assert.equal(r.noStoredValueStated, true);
  assert.equal(r.appliedAmount, 0n);
  assert.equal(r.remainingDueAmount, 250000000n);
  assert.equal(r.balanceRemainingAmount, 0n);
});

test('excess beyond the purchase is never paid out as cash: it stays on the balance', () => {
  for (const balanceAmount of ['251', '400', '1000000']) {
    const r = modelStoredValuePayment({ amount: '250', balanceAmount, decimals: 6 });
    assert.equal(r.appliedAmount, 250000000n);
    assert.equal(r.excessPaidOutAsCash, false);
    assert.equal(r.balanceRemainingAmount, r.balanceAmount - 250000000n);
  }
});

test('stored value is not a discount, not cashback, and not credit', () => {
  const r = modelStoredValuePayment(DEFAULT);
  assert.equal(r.storedValueIsDiscount, false);
  assert.equal(r.storedValueIsCashback, false);
  assert.equal(r.storedValueIsCredit, false);
});

test('a purchase of zero is refused and a negative balance is refused', () => {
  assert.throws(() => modelStoredValuePayment({ amount: '0', balanceAmount: '10', decimals: 6 }), /greater than zero/);
  assert.throws(() => modelStoredValuePayment({ amount: '10', balanceAmount: '-1', decimals: 6 }), /positive decimal/);
});

test('one base unit of balance against a larger purchase applies that one unit exactly', () => {
  const r = modelStoredValuePayment({ amount: '999', balanceAmount: '1', decimals: 0 });
  assert.equal(r.appliedAmount, 1n);
  assert.equal(r.remainingDueAmount, 998n);
  assert.equal(r.balanceRemainingAmount, 0n);
  assert.equal(r.balanceIsPartial, true);
});

test('what is not priced stays unpriced: funding, expiry, refund of the balance, and the remaining tender', () => {
  const r = modelStoredValuePayment(DEFAULT);
  assert.equal(r.balanceFundingPriced, false);
  assert.equal(r.balanceExpiryPriced, false);
  assert.equal(r.balanceRefundPriced, false);
  assert.equal(r.remainingTenderPriced, false);
});

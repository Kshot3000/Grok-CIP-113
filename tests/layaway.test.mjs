import test from 'node:test';
import assert from 'node:assert/strict';
import { modelLayaway } from '../src/domain.js';

const DEFAULT = { amount: '250', paidAmount: '100', decimals: 6 };

test('preload: paying 100 toward a 250 purchase leaves 150 remaining and the goods held', () => {
  const r = modelLayaway(DEFAULT);
  assert.equal(r.amount, 250000000n);
  assert.equal(r.paidAmount, 100000000n);
  assert.equal(r.remainingAmount, 150000000n);
  assert.equal(r.goodsHeld, true);
  assert.equal(r.goodsReleased, false);
  assert.equal(r.fullyPaid, false);
  assert.equal(r.noPaymentStated, false);
});

test('identity: paid plus remaining is the price exactly, at every size', () => {
  for (const [amount, paidAmount, decimals] of [['250', '100', 6], ['7', '2', 0], ['2.5', '1.25', 6], ['1000', '999', 0], ['1', '0', 6]]) {
    const r = modelLayaway({ amount, paidAmount, decimals });
    assert.equal(r.paidAmount + r.remainingAmount, r.amount);
  }
});

test('shares are derived from the amounts: 100 of 250 paid is a 4000.00 share, 150 remaining a 6000.00 share', () => {
  const r = modelLayaway(DEFAULT);
  assert.equal(r.paidShareBpsText, '4000.00');
  assert.equal(r.remainingShareBpsText, '6000.00');
});

test('shares floor, never round: 2 of 7 paid is a 2857.14 share and 5 remaining a 7142.85 share', () => {
  const r = modelLayaway({ amount: '7', paidAmount: '2', decimals: 0 });
  assert.equal(r.paidShareBpsText, '2857.14');
  assert.equal(r.remainingShareBpsText, '7142.85');
});

test('nothing paid states no payment: the whole price remains and the goods are held whole', () => {
  const r = modelLayaway({ amount: '250', paidAmount: '0', decimals: 6 });
  assert.equal(r.noPaymentStated, true);
  assert.equal(r.remainingAmount, r.amount);
  assert.equal(r.goodsHeld, true);
  assert.equal(r.goodsReleased, false);
});

test('the price paid whole releases the goods: nothing remains', () => {
  const r = modelLayaway({ amount: '250', paidAmount: '250', decimals: 6 });
  assert.equal(r.fullyPaid, true);
  assert.equal(r.goodsReleased, true);
  assert.equal(r.goodsHeld, false);
  assert.equal(r.remainingAmount, 0n);
});

test('a price almost paid is not a price paid: one base unit remaining leaves the goods held', () => {
  const r = modelLayaway({ amount: '1000', paidAmount: '999', decimals: 0 });
  assert.equal(r.remainingAmount, 1n);
  assert.equal(r.goodsHeld, true);
  assert.equal(r.goodsReleased, false);
  assert.equal(r.fullyPaid, false);
});

test('paying beyond the price is refused, never capped', () => {
  assert.throws(() => modelLayaway({ amount: '250', paidAmount: '251', decimals: 6 }), /cannot exceed the purchase amount/);
  assert.throws(() => modelLayaway({ amount: '250', paidAmount: '250.000001', decimals: 6 }), /cannot exceed the purchase amount/);
});

test('a zero purchase is refused: layaway pays toward a purchase, and no purchase holds no goods', () => {
  assert.throws(() => modelLayaway({ amount: '0', paidAmount: '0', decimals: 6 }), /Purchase amount must be greater than zero/);
});

test('fractional part payments are exact in BigInt: 1.25 paid toward 2.5 leaves exactly 1.25', () => {
  const r = modelLayaway({ amount: '2.5', paidAmount: '1.25', decimals: 6 });
  assert.equal(r.paidAmount, 1250000n);
  assert.equal(r.remainingAmount, 1250000n);
  assert.equal(r.paidShareBpsText, '5000.00');
});

test('a layaway is not credit, not escrow, and not stored value', () => {
  const r = modelLayaway(DEFAULT);
  assert.equal(r.layawayIsCredit, false);
  assert.equal(r.layawayIsEscrow, false);
  assert.equal(r.layawayIsStoredValue, false);
});

test('what is not priced stays unpriced: holding period, cancellation refund, forfeiture, fee, and partial release', () => {
  const r = modelLayaway(DEFAULT);
  assert.equal(r.holdingPeriodPriced, false);
  assert.equal(r.cancellationRefundPriced, false);
  assert.equal(r.forfeiturePriced, false);
  assert.equal(r.layawayFeePriced, false);
  assert.equal(r.partialReleasePriced, false);
});

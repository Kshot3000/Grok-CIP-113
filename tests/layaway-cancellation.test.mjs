import test from 'node:test';
import assert from 'node:assert/strict';
import { modelLayawayCancellation } from '../src/domain.js';

const DEFAULT = { amount: '250', paidAmount: '100', forfeitureRateBps: 1000, decimals: 6 };

test('preload: cancelling after paying 100 toward 250 at 1000 bps forfeits 10, refunds 90, and the 150 remaining never falls due', () => {
  const r = modelLayawayCancellation(DEFAULT);
  assert.equal(r.amount, 250000000n);
  assert.equal(r.paidAmount, 100000000n);
  assert.equal(r.forfeitureAmount, 10000000n);
  assert.equal(r.refundAmount, 90000000n);
  assert.equal(r.cancelledRemainderAmount, 150000000n);
  assert.equal(r.goodsReleasedOnCancellation, false);
  assert.equal(r.noPaymentStated, false);
});

test('identities: forfeiture plus refund is the payments made exactly, and payments plus cancelled remainder is the price exactly', () => {
  for (const [amount, paidAmount, forfeitureRateBps, decimals] of [['250', '100', 1000, 6], ['1000', '999', 500, 0], ['2.5', '1.25', 1000, 6], ['7', '2', 333, 0], ['250', '0', 1000, 6]]) {
    const r = modelLayawayCancellation({ amount, paidAmount, forfeitureRateBps, decimals });
    assert.equal(r.forfeitureAmount + r.refundAmount, r.paidAmount);
    assert.equal(r.paidAmount + r.cancelledRemainderAmount, r.amount);
    assert.equal(r.forfeitureAmount + r.refundAmount + r.cancelledRemainderAmount, r.amount);
  }
});

test('the forfeiture is measured on the payments made, never on the price: 1000 bps of the 100 paid is 10, not the 25 the price would state', () => {
  const r = modelLayawayCancellation(DEFAULT);
  assert.equal(r.forfeitureAmount, 10000000n);
  assert.notEqual(r.forfeitureAmount, 25000000n);
  assert.equal(r.forfeitureMeasuredOnPrice, false);
});

test('shares are derived from the amounts against the payments made: 10 forfeited of 100 paid is a 1000.00 share, 90 refunded a 9000.00 share', () => {
  const r = modelLayawayCancellation(DEFAULT);
  assert.equal(r.forfeitureShareBpsText, '1000.00');
  assert.equal(r.refundShareBpsText, '9000.00');
});

test('shares floor, never round: 49 forfeited of 999 paid is a 490.49 share and 950 refunded a 9509.50 share', () => {
  const r = modelLayawayCancellation({ amount: '1000', paidAmount: '999', forfeitureRateBps: 500, decimals: 0 });
  assert.equal(r.forfeitureAmount, 49n);
  assert.equal(r.refundAmount, 950n);
  assert.equal(r.forfeitureShareBpsText, '490.49');
  assert.equal(r.refundShareBpsText, '9509.50');
});

test('the forfeiture floors: 500 bps of 999 paid forfeits 49, never the 50 rounding would state', () => {
  const r = modelLayawayCancellation({ amount: '1000', paidAmount: '999', forfeitureRateBps: 500, decimals: 0 });
  assert.equal(r.forfeitureAmount, 49n);
  assert.equal(r.cancelledRemainderAmount, 1n);
});

test('no forfeiture stated refunds the payments whole', () => {
  const r = modelLayawayCancellation({ amount: '250', paidAmount: '100', forfeitureRateBps: 0, decimals: 6 });
  assert.equal(r.noForfeitureStated, true);
  assert.equal(r.forfeitureAmount, 0n);
  assert.equal(r.refundAmount, r.paidAmount);
  assert.equal(r.refundIsWholePayment, true);
});

test('a forfeiture rate of the whole forfeits the payments whole, stated: the refund is zero', () => {
  const r = modelLayawayCancellation({ amount: '250', paidAmount: '100', forfeitureRateBps: 10000, decimals: 6 });
  assert.equal(r.forfeitureAmount, r.paidAmount);
  assert.equal(r.refundAmount, 0n);
  assert.equal(r.forfeitureIsWholePayment, true);
});

test('nothing paid states no settlement: nothing refunded, nothing forfeited, the whole price never falls due', () => {
  const r = modelLayawayCancellation({ amount: '250', paidAmount: '0', forfeitureRateBps: 1000, decimals: 6 });
  assert.equal(r.noPaymentStated, true);
  assert.equal(r.forfeitureAmount, 0n);
  assert.equal(r.refundAmount, 0n);
  assert.equal(r.cancelledRemainderAmount, r.amount);
});

test('a stated rate flooring to zero on a one-base-unit payment forfeits nothing at that size', () => {
  const r = modelLayawayCancellation({ amount: '250', paidAmount: '1', forfeitureRateBps: 500, decimals: 0 });
  assert.equal(r.forfeitureAmount, 0n);
  assert.equal(r.refundAmount, 1n);
  assert.equal(r.forfeitureFloorsToZero, true);
  assert.equal(r.refundIsWholePayment, true);
});

test('a layaway paid whole cannot be cancelled as a layaway: the purchase is complete', () => {
  assert.throws(() => modelLayawayCancellation({ amount: '250', paidAmount: '250', forfeitureRateBps: 1000, decimals: 6 }), /cannot be cancelled as a layaway/);
});

test('a forfeiture rate beyond the whole, negative, or fractional is refused', () => {
  assert.throws(() => modelLayawayCancellation({ amount: '250', paidAmount: '100', forfeitureRateBps: 10001, decimals: 6 }), /whole number of basis points/);
  assert.throws(() => modelLayawayCancellation({ amount: '250', paidAmount: '100', forfeitureRateBps: -1, decimals: 6 }), /whole number of basis points/);
  assert.throws(() => modelLayawayCancellation({ amount: '250', paidAmount: '100', forfeitureRateBps: 2.5, decimals: 6 }), /whole number of basis points/);
});

test('paying beyond the price is still refused, through the composed layaway model', () => {
  assert.throws(() => modelLayawayCancellation({ amount: '250', paidAmount: '251', forfeitureRateBps: 1000, decimals: 6 }), /cannot exceed the purchase amount/);
});

test('fractional payments settle exactly in BigInt: 1.25 paid at 1000 bps forfeits 0.125 and refunds 1.125', () => {
  const r = modelLayawayCancellation({ amount: '2.5', paidAmount: '1.25', forfeitureRateBps: 1000, decimals: 6 });
  assert.equal(r.forfeitureAmount, 125000n);
  assert.equal(r.refundAmount, 1125000n);
  assert.equal(r.cancelledRemainderAmount, 1250000n);
});

test('the refund is not income and not stored value, and the forfeiture never exceeds the payments made', () => {
  const r = modelLayawayCancellation(DEFAULT);
  assert.equal(r.refundIsIncome, false);
  assert.equal(r.refundIsStoredValue, false);
  assert.equal(r.forfeitureExceedsPaid, false);
});

test('what is not priced stays unpriced: cancellation eligibility, non-completion, refund timing, and partial cancellation', () => {
  const r = modelLayawayCancellation(DEFAULT);
  assert.equal(r.cancellationEligibilityPriced, false);
  assert.equal(r.nonCompletionPriced, false);
  assert.equal(r.refundTimingPriced, false);
  assert.equal(r.partialCancellationPriced, false);
});

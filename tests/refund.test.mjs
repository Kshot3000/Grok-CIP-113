import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelRefund, modelPriceDiscount } from '../src/domain.js';

// Refund model (v1.258): a NEW axis — a stated amount was
// paid and a stated share of it is handed back. The refund
// is measured against the amount PAID (never a list price),
// floored to the base unit, and can never exceed the
// payment; the shares are derived from the amounts against
// the amount paid, floored.
const DEFAULT = { amountPaid: '1000', refundRateBps: 2500, decimals: 6 };

test('the preloaded refund: 1000 paid at a stated 2500 bps rate hands 250 back and retains 750, shares 2500.00 and 7500.00', () => {
  const r = modelRefund(DEFAULT);
  assert.equal(r.amountPaid, 1000000000n);
  assert.equal(r.refundAmount, 250000000n);
  assert.equal(r.amountRetained, 750000000n);
  assert.equal(r.refundShareBpsText, '2500.00');
  assert.equal(r.retainedShareBpsText, '7500.00');
});

test('the default rate is none stated when none is given: the amount retained is the amount paid whole', () => {
  const r = modelRefund({ amountPaid: '1000', decimals: 6 });
  assert.equal(r.refundRateBps, 0);
  assert.equal(r.refundAmount, 0n);
  assert.equal(r.amountRetained, r.amountPaid);
  assert.equal(r.noRefundStated, true);
});

test('identities hold across payments: the refund handed back plus the amount retained is the amount paid, exactly', () => {
  const cases = [
    DEFAULT,
    { amountPaid: '1000', refundRateBps: 0, decimals: 6 },
    { amountPaid: '1000', refundRateBps: 10000, decimals: 6 },
    { amountPaid: '777', refundRateBps: 2000, decimals: 0 },
    { amountPaid: '9007199254740993', refundRateBps: 2500, decimals: 0 },
    { amountPaid: '0.000001', refundRateBps: 100, decimals: 6 },
    { amountPaid: '999', refundRateBps: 3333, decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelRefund(c);
    assert.equal(r.refundAmount + r.amountRetained, r.amountPaid);
    assert.ok(r.refundAmount <= r.amountPaid);
  }
});

test('the refund is measured against the amount paid, never against a list price: a buyer who paid 750 on a 1000 list after a 25% discount is handed 150 back at a stated 20% rate, not the 200 a list-price base states', () => {
  const paid = modelPriceDiscount({ priceAmount: '1000', discountRateBps: 2500, decimals: 0 });
  assert.equal(paid.amountDue, 750n);
  const r = modelRefund({ amountPaid: '750', refundRateBps: 2000, decimals: 0 });
  assert.equal(r.refundAmount, 150n);
  assert.equal(r.amountRetained, 600n);
  assert.notEqual(r.refundAmount, 1000n * 2000n / 10000n);
  assert.equal(r.refundMeasuredOnListPrice, false);
});

test('measuring against the list price overstates the refund by exactly the stated rate taken on the discount: on the 1000 list at a 25% discount it states 50 more than the 150 handed back', () => {
  const r = modelRefund({ amountPaid: '750', refundRateBps: 2000, decimals: 0 });
  assert.equal(1000n * 2000n / 10000n, 200n);
  assert.equal(200n - r.refundAmount, 250n * 2000n / 10000n);
});

test('eligibility is not priced: the model states the hand-back the stated rate describes, never whether a refund is owed, who may claim one, or how long a claim stays open', () => {
  const r = modelRefund(DEFAULT);
  assert.equal(r.eligibilityPriced, false);
});

test('a rate of zero states no refund: the amount retained is the amount paid whole, with refund share 0.00 and retained share 10000.00', () => {
  const r = modelRefund({ amountPaid: '1000', refundRateBps: 0, decimals: 6 });
  assert.equal(r.noRefundStated, true);
  assert.equal(r.fullRefund, false);
  assert.equal(r.refundAmount, 0n);
  assert.equal(r.amountRetained, 1000000000n);
  assert.equal(r.refundShareBpsText, '0.00');
  assert.equal(r.retainedShareBpsText, '10000.00');
});

test('a stated rate that floors to zero on a tiny payment hands nothing back at that size, stated as such: 1 base unit at 100 bps carries no whole base unit of refund, and the rate still stands', () => {
  const r = modelRefund({ amountPaid: '0.000001', refundRateBps: 100, decimals: 6 });
  assert.equal(r.noRefundStated, false);
  assert.equal(r.refundFloorsToZero, true);
  assert.equal(r.refundAmount, 0n);
  assert.equal(r.amountRetained, 1n);
});

test('a rate of the whole states a full refund: 1000 paid at 10000 bps hands the whole 1000 back and the amount retained is zero exactly', () => {
  const r = modelRefund({ amountPaid: '1000', refundRateBps: 10000, decimals: 6 });
  assert.equal(r.fullRefund, true);
  assert.equal(r.refundAmount, 1000000000n);
  assert.equal(r.amountRetained, 0n);
  assert.equal(r.refundShareBpsText, '10000.00');
  assert.equal(r.retainedShareBpsText, '0.00');
});

test('the refund can never exceed the payment: at every stated rate up to the whole, the hand-back is at most what was paid and the amount retained never goes below zero', () => {
  for (const rate of [1, 3333, 5000, 9999, 10000]) {
    const r = modelRefund({ amountPaid: '777', refundRateBps: rate, decimals: 0 });
    assert.ok(r.refundAmount <= 777n);
    assert.ok(r.amountRetained >= 0n);
  }
});

test('shares are derived from the amounts against the amount paid: on the no-decimals 777 payment, a refund of 155 states shares 1994.85 and 8005.14', () => {
  const r = modelRefund({ amountPaid: '777', refundRateBps: 2000, decimals: 0 });
  assert.equal(r.refundAmount, 155n);
  assert.equal(r.amountRetained, 622n);
  assert.equal(r.refundShareBpsText, '1994.85');
  assert.equal(r.retainedShareBpsText, '8005.14');
});

test('the refund share is floored, never rounded up: a refund of 1 off a payment of 3 states 3333.33, not the 3333.34 rounding would state', () => {
  const r = modelRefund({ amountPaid: '3', refundRateBps: 5000, decimals: 0 });
  assert.equal(r.refundAmount, 1n);
  assert.equal(r.amountRetained, 2n);
  assert.equal(r.refundShareBpsText, '3333.33');
  assert.equal(r.retainedShareBpsText, '6666.66');
});

test('amounts beyond float precision stay exact: a 2^53+1 payment at 2500 bps hands 2251799813685248 back and retains 6755399441055745', () => {
  const r = modelRefund({ amountPaid: '9007199254740993', refundRateBps: 2500, decimals: 0 });
  assert.equal(r.refundAmount, 2251799813685248n);
  assert.equal(r.amountRetained, 6755399441055745n);
  assert.equal(r.refundShareBpsText, '2499.99');
  assert.equal(r.retainedShareBpsText, '7500.00');
});

test('the refund floors on an odd payment: 999 at 3333 bps hands 332 back and retains 667, never more handed back by rounding up', () => {
  const r = modelRefund({ amountPaid: '999', refundRateBps: 3333, decimals: 0 });
  assert.equal(r.refundAmount, 332n);
  assert.equal(r.amountRetained, 667n);
});

test('a zero amount paid is refused: a payment of nothing carries no refund', () => {
  assert.throws(() => modelRefund({ amountPaid: '0', refundRateBps: 2500, decimals: 6 }), /Amount paid must be greater than zero/);
  assert.throws(() => modelRefund({ refundRateBps: 2500, decimals: 6 }), /Amount paid must be greater than zero/);
});

test('a rate beyond the whole or fractional is refused: a hand-back larger than the payment is not a refund, and the stated rate is a whole share of the amount paid', () => {
  assert.throws(() => modelRefund({ amountPaid: '1000', refundRateBps: 10001, decimals: 6 }), /Refund rate must be a whole number of basis points/);
  assert.throws(() => modelRefund({ amountPaid: '1000', refundRateBps: 12.5, decimals: 6 }), /Refund rate must be a whole number of basis points/);
  assert.throws(() => modelRefund({ amountPaid: '1000', refundRateBps: -1, decimals: 6 }), /Refund rate must be a whole number of basis points/);
});

test('a negative payment is refused at parsing, before the model ever sees it', () => {
  assert.throws(() => modelRefund({ amountPaid: '-1', refundRateBps: 2500, decimals: 6 }), /Enter a positive decimal amount/);
});

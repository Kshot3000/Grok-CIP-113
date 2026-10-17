import test from 'node:test';
import assert from 'node:assert/strict';
import { modelBookingCancellation, modelBookingDeposit } from '../src/domain.js';

const DEFAULT = { amount: '500', depositRateBps: 2000, keepRateBps: 1000, decimals: 6 };

test('preload: cancelling the 500 booking kept 10 of its 100 deposit, refunds 90, and the 400 remainder never falls due', () => {
  const r = modelBookingCancellation(DEFAULT);
  assert.equal(r.priceAmount, 500000000n);
  assert.equal(r.depositAmount, 100000000n);
  assert.equal(r.keepRateBps, 1000);
  assert.equal(r.keptAmount, 10000000n);
  assert.equal(r.refundAmount, 90000000n);
  assert.equal(r.remainderNeverDueAmount, 400000000n);
  assert.equal(r.keptShareBpsText, '1000.00');
  assert.equal(r.refundShareBpsText, '9000.00');
  assert.equal(r.keptIsPartial, true);
});

test('composition: the settlement divides exactly the deposit the deposit model states, unchanged', () => {
  const base = modelBookingDeposit({ amount: '500', depositRateBps: 2000, decimals: 6 });
  const r = modelBookingCancellation(DEFAULT);
  assert.equal(r.depositAmount, base.depositAmount);
  assert.equal(r.remainderNeverDueAmount, base.remainderAmount);
  assert.equal(r.keptAmount + r.refundAmount, base.depositAmount);
});

test('identities: kept plus refund is the deposit exactly, and deposit plus remainder never due is the price exactly', () => {
  for (const [amount, depositRateBps, keepRateBps, decimals] of [['500', 2000, 1000, 6], ['500', 0, 1000, 6], ['500', 2000, 10000, 6], ['999', 1000, 1000, 0], ['1', 10000, 1, 0], ['10', 2500, 2500, 6]]) {
    const r = modelBookingCancellation({ amount, depositRateBps, keepRateBps, decimals });
    assert.equal(r.keptAmount + r.refundAmount, r.depositAmount);
    assert.equal(r.depositAmount + r.remainderNeverDueAmount, r.priceAmount);
  }
});

test('what is kept is measured on the deposit actually paid, never on the price', () => {
  const r = modelBookingCancellation(DEFAULT);
  assert.equal(r.keptMeasuredOnDeposit, true);
  // 10% of the 500 price would be 50 — the stated share of the 100 deposit actually paid is 10.
  assert.equal(r.keptAmount, 10000000n);
  assert.notEqual(r.keptAmount, 50000000n);
});

test('no deposit due states no settlement: nothing is kept, nothing is refunded, and the whole price never falls due', () => {
  const r = modelBookingCancellation({ amount: '500', depositRateBps: 0, keepRateBps: 1000, decimals: 6 });
  assert.equal(r.noDepositDue, true);
  assert.equal(r.noSettlement, true);
  assert.equal(r.depositAmount, 0n);
  assert.equal(r.keptAmount, 0n);
  assert.equal(r.refundAmount, 0n);
  assert.equal(r.remainderNeverDueAmount, r.priceAmount);
  assert.equal(r.keptShareBpsText, '0.00');
});

test('no keep stated refunds the deposit whole', () => {
  const r = modelBookingCancellation({ amount: '500', depositRateBps: 2000, keepRateBps: 0, decimals: 6 });
  assert.equal(r.keepStated, false);
  assert.equal(r.refundIsWholeDeposit, true);
  assert.equal(r.keptAmount, 0n);
  assert.equal(r.refundAmount, 100000000n);
});

test('a keep of the whole deposit keeps it whole, stated, and refunds nothing', () => {
  const r = modelBookingCancellation({ amount: '500', depositRateBps: 2000, keepRateBps: 10000, decimals: 6 });
  assert.equal(r.keptIsWholeDeposit, true);
  assert.equal(r.keptAmount, 100000000n);
  assert.equal(r.refundAmount, 0n);
  assert.equal(r.keptShareBpsText, '10000.00');
});

test('a stated keep flooring to zero on a one-base-unit deposit keeps nothing at that size', () => {
  const r = modelBookingCancellation({ amount: '1', depositRateBps: 10000, keepRateBps: 1, decimals: 0 });
  assert.equal(r.keepFloorsToZero, true);
  assert.equal(r.refundIsWholeDeposit, true);
  assert.equal(r.keptAmount, 0n);
  assert.equal(r.refundAmount, 1n);
});

test('the settlement floors, never rounds: a 1,000 bps keep of a 99 deposit keeps 9 and refunds 90', () => {
  const r = modelBookingCancellation({ amount: '999', depositRateBps: 1000, keepRateBps: 1000, decimals: 0 });
  assert.equal(r.depositAmount, 99n);
  assert.equal(r.keptAmount, 9n);
  assert.equal(r.refundAmount, 90n);
  assert.equal(r.keptShareBpsText, '909.09');
  assert.equal(r.refundShareBpsText, '9090.90');
});

test('fractional amounts state exactly in BigInt: a 2,500 bps keep of a 2.5 deposit keeps 0.625 and refunds 1.875', () => {
  const r = modelBookingCancellation({ amount: '10', depositRateBps: 2500, keepRateBps: 2500, decimals: 6 });
  assert.equal(r.depositAmount, 2500000n);
  assert.equal(r.keptAmount, 625000n);
  assert.equal(r.refundAmount, 1875000n);
});

test('a keep rate beyond the whole is refused, and a fractional rate is refused', () => {
  assert.throws(() => modelBookingCancellation({ amount: '500', depositRateBps: 2000, keepRateBps: 10001, decimals: 6 }), /Keep rate must be a whole number of basis points between 0 and 10,000/);
  assert.throws(() => modelBookingCancellation({ amount: '500', depositRateBps: 2000, keepRateBps: 2.5, decimals: 6 }), /Keep rate must be a whole number of basis points between 0 and 10,000/);
  const r = modelBookingCancellation(DEFAULT);
  assert.equal(r.keptExceedsDeposit, false);
});

test('the deposit model refusals carry through: a price of zero and a deposit rate beyond the whole are refused', () => {
  assert.throws(() => modelBookingCancellation({ amount: '0', depositRateBps: 2000, keepRateBps: 1000, decimals: 6 }), /Price must be greater than zero/);
  assert.throws(() => modelBookingCancellation({ amount: '500', depositRateBps: 10001, keepRateBps: 1000, decimals: 6 }), /Deposit rate must be a whole number of basis points between 0 and 10,000/);
});

test('what is kept is not an additional charge: it comes out of the deposit already paid and the remainder never falls due', () => {
  const r = modelBookingCancellation(DEFAULT);
  assert.equal(r.keptIsAdditionalCharge, false);
  assert.equal(r.remainderStillDue, false);
});

test('the refund is not income and not stored value: it is the buyer\u2019s own money back', () => {
  const r = modelBookingCancellation(DEFAULT);
  assert.equal(r.refundIsIncome, false);
  assert.equal(r.refundIsStoredValue, false);
});

test('what is not priced stays unpriced: cancellation eligibility, refund timing, no-show treatment, and rebooking', () => {
  const r = modelBookingCancellation(DEFAULT);
  assert.equal(r.cancellationEligibilityPriced, false);
  assert.equal(r.refundTimingPriced, false);
  assert.equal(r.noShowPriced, false);
  assert.equal(r.rebookingPriced, false);
});

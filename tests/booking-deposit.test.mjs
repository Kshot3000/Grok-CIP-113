import test from 'node:test';
import assert from 'node:assert/strict';
import { modelBookingDeposit, modelSecurityDepositReturn } from '../src/domain.js';

const DEFAULT = { amount: '500', depositRateBps: 2000, decimals: 6 };

test('preload: a 2,000 bps deposit on a 500 price is 100 due upfront and 400 remains due', () => {
  const r = modelBookingDeposit(DEFAULT);
  assert.equal(r.priceAmount, 500000000n);
  assert.equal(r.depositRateBps, 2000);
  assert.equal(r.depositAmount, 100000000n);
  assert.equal(r.remainderAmount, 400000000n);
  assert.equal(r.depositShareBpsText, '2000.00');
  assert.equal(r.remainderShareBpsText, '8000.00');
  assert.equal(r.depositIsPartial, true);
  assert.equal(r.depositIsWholePrice, false);
});

test('identities: deposit plus remainder is the price exactly', () => {
  for (const [amount, depositRateBps, decimals] of [['500', 2000, 6], ['500', 0, 6], ['500', 10000, 6], ['999', 1000, 0], ['1', 1, 0], ['10', 2500, 6]]) {
    const r = modelBookingDeposit({ amount, depositRateBps, decimals });
    assert.equal(r.depositAmount + r.remainderAmount, r.priceAmount);
  }
});

test('the deposit is measured on the price, never on the remainder it leaves', () => {
  const r = modelBookingDeposit(DEFAULT);
  assert.equal(r.depositMeasuredOnPrice, true);
  // 20% of the 400 remainder would be 80 — the stated share of the price is 100.
  assert.equal(r.depositAmount, 100000000n);
  assert.notEqual(r.depositAmount, 80000000n);
});

test('no deposit stated states no deposit due: the whole price remains due', () => {
  const r = modelBookingDeposit({ amount: '500', depositRateBps: 0, decimals: 6 });
  assert.equal(r.noDepositStated, true);
  assert.equal(r.noDepositDue, true);
  assert.equal(r.depositAmount, 0n);
  assert.equal(r.remainderAmount, r.priceAmount);
  assert.equal(r.depositShareBpsText, '0.00');
});

test('a deposit of the whole price states it due upfront whole and nothing remains due', () => {
  const r = modelBookingDeposit({ amount: '500', depositRateBps: 10000, decimals: 6 });
  assert.equal(r.depositIsWholePrice, true);
  assert.equal(r.depositAmount, 500000000n);
  assert.equal(r.remainderAmount, 0n);
  assert.equal(r.remainderShareBpsText, '0.00');
});

test('a stated rate flooring to zero on a one-base-unit price states no deposit due at that size', () => {
  const r = modelBookingDeposit({ amount: '1', depositRateBps: 1, decimals: 0 });
  assert.equal(r.depositFloorsToZero, true);
  assert.equal(r.noDepositDue, true);
  assert.equal(r.depositAmount, 0n);
  assert.equal(r.remainderAmount, 1n);
});

test('the deposit floors, never rounds: 1,000 bps of a 999 price is 99, and the shares floor too', () => {
  const r = modelBookingDeposit({ amount: '999', depositRateBps: 1000, decimals: 0 });
  assert.equal(r.depositAmount, 99n);
  assert.equal(r.remainderAmount, 900n);
  assert.equal(r.depositShareBpsText, '990.99');
  assert.equal(r.remainderShareBpsText, '9009.00');
});

test('fractional amounts state exactly in BigInt: 2,500 bps of a 10 price is 2.5 due upfront and 7.5 remains', () => {
  const r = modelBookingDeposit({ amount: '10', depositRateBps: 2500, decimals: 6 });
  assert.equal(r.depositAmount, 2500000n);
  assert.equal(r.remainderAmount, 7500000n);
});

test('a deposit rate beyond the whole is refused, and a fractional rate is refused', () => {
  assert.throws(() => modelBookingDeposit({ amount: '500', depositRateBps: 10001, decimals: 6 }), /Deposit rate must be a whole number of basis points between 0 and 10,000/);
  assert.throws(() => modelBookingDeposit({ amount: '500', depositRateBps: 2.5, decimals: 6 }), /Deposit rate must be a whole number of basis points between 0 and 10,000/);
  const r = modelBookingDeposit(DEFAULT);
  assert.equal(r.depositExceedsPrice, false);
});

test('a price of zero or less is refused', () => {
  assert.throws(() => modelBookingDeposit({ amount: '0', depositRateBps: 2000, decimals: 6 }), /Price must be greater than zero/);
});

test('distinction: a security deposit is its own held amount with no price; a booking deposit is a share of the price and counts toward it', () => {
  const sd = modelSecurityDepositReturn({ depositAmount: '2000', decimals: 6, unpaidAmount: '0', repairAmount: '0' });
  assert.equal(sd.remainderAmount, undefined);
  const bd = modelBookingDeposit(DEFAULT);
  assert.equal(bd.depositIsSecurityDeposit, false);
  assert.equal(bd.depositAmount + bd.remainderAmount, bd.priceAmount);
});

test('the deposit is not a discount and not a fee: the price stands whole and the deposit pays toward it', () => {
  const r = modelBookingDeposit(DEFAULT);
  assert.equal(r.depositIsDiscount, false);
  assert.equal(r.depositIsFee, false);
});

test('the deposit is not a layaway payment and not stored value: it is a stated share due upfront, bound to this booking', () => {
  const r = modelBookingDeposit(DEFAULT);
  assert.equal(r.depositIsLayawayPayment, false);
  assert.equal(r.depositIsStoredValue, false);
});

test('what is not priced stays unpriced: cancellation, reservation terms, remainder timing, and fulfillment', () => {
  const r = modelBookingDeposit(DEFAULT);
  assert.equal(r.cancellationPriced, false);
  assert.equal(r.reservationTermsPriced, false);
  assert.equal(r.remainderTimingPriced, false);
  assert.equal(r.fulfillmentPriced, false);
});

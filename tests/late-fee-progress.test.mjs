import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelLateFee, modelLateFeeProgress } from '../src/domain.js';

// Late fee progress model (v1.204): the late-charge axis's
// second moment — what remains owed is the total now due
// minus what has already been paid, never the amount due
// minus what was paid (which drops the charge), and never a
// fresh accrual on what remains; the payment is counted
// against the total as a whole, with no allocation priced.
const DEFAULT = { amountDue: '1000', lateRateBps: 500, periodsLate: 3, amountAlreadyPaid: '400', decimals: 6 };

test('the preloaded position: 400 paid of the 1150 total now due on 1000 due leaves 750 still owed, shares 3478.26 paid and 6521.73 still owed', () => {
  const r = modelLateFeeProgress(DEFAULT);
  assert.equal(r.amountDue, 1000000000n);
  assert.equal(r.lateCharge, 150000000n);
  assert.equal(r.totalNowDue, 1150000000n);
  assert.equal(r.amountAlreadyPaid, 400000000n);
  assert.equal(r.stillOwed, 750000000n);
  assert.equal(r.alreadyPaidShareBpsText, '3478.26');
  assert.equal(r.stillOwedShareBpsText, '6521.73');
  assert.equal(r.partiallyPaid, true);
});

test('the position composes the late fee model unchanged: its total is the base model\u2019s own total', () => {
  const base = modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: 3, decimals: 6 });
  const r = modelLateFeeProgress(DEFAULT);
  assert.equal(r.lateCharge, base.lateCharge);
  assert.equal(r.totalNowDue, base.totalNowDue);
  assert.equal(r.lateChargeShareBpsText, base.lateChargeShareBpsText);
});

test('identities hold across positions: paid plus still owed is the total now due, and the amount due plus the charge is the total, exactly', () => {
  const cases = [
    DEFAULT,
    { amountDue: '1000', lateRateBps: 500, periodsLate: 3, amountAlreadyPaid: '0', decimals: 6 },
    { amountDue: '1000', lateRateBps: 500, periodsLate: 3, amountAlreadyPaid: '1150', decimals: 6 },
    { amountDue: '777', lateRateBps: 250, periodsLate: 4, amountAlreadyPaid: '200', decimals: 0 },
    { amountDue: '1000', lateRateBps: 500, periodsLate: 0, amountAlreadyPaid: '250', decimals: 6 },
    { amountDue: '9007199254740993', lateRateBps: 500, periodsLate: 3, amountAlreadyPaid: '1351079888211148', decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelLateFeeProgress(c);
    assert.equal(r.amountAlreadyPaid + r.stillOwed, r.totalNowDue);
    assert.equal(r.amountDue + r.lateCharge, r.totalNowDue);
  }
});

test('what remains is measured against the total, never the amount due alone: on the preload, the amount-due-only measure states 600 where 750 remains — it drops the whole 150 charge', () => {
  const r = modelLateFeeProgress(DEFAULT);
  const wrongWay = r.amountDue - r.amountAlreadyPaid; // Computed test-side: the position the wrong base would state.
  assert.equal(wrongWay, 600000000n);
  assert.equal(r.stillOwed, 750000000n);
  assert.equal(r.stillOwed - wrongWay, r.lateCharge);
});

test('no fresh charge accrues on what remains: still owed is the total minus the payment, with the stated periods priced once by the base model', () => {
  const r = modelLateFeeProgress(DEFAULT);
  assert.equal(r.furtherAccrualPriced, false);
  assert.equal(r.stillOwed, r.totalNowDue - r.amountAlreadyPaid);
});

test('nothing paid yet leaves the whole total still owed: the base model\u2019s own position', () => {
  const r = modelLateFeeProgress({ amountDue: '1000', lateRateBps: 500, periodsLate: 3, amountAlreadyPaid: '0', decimals: 6 });
  assert.equal(r.stillOwed, r.totalNowDue);
  assert.equal(r.nothingPaidYet, true);
  assert.equal(r.partiallyPaid, false);
  const base = modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: 3, decimals: 6 });
  assert.equal(r.stillOwed, base.totalNowDue);
});

test('an amount paid equal to the total leaves the position fully paid: nothing remains owed', () => {
  const r = modelLateFeeProgress({ amountDue: '1000', lateRateBps: 500, periodsLate: 3, amountAlreadyPaid: '1150', decimals: 6 });
  assert.equal(r.stillOwed, 0n);
  assert.equal(r.fullyPaid, true);
  assert.equal(r.alreadyPaidShareBpsText, '10000.00');
  assert.equal(r.stillOwedShareBpsText, '0.00');
});

test('an amount already paid beyond the total now due is refused, never capped silently at the total', () => {
  assert.throws(() => modelLateFeeProgress({ amountDue: '1000', lateRateBps: 500, periodsLate: 3, amountAlreadyPaid: '1151', decimals: 6 }), /Amount already paid must not exceed the total now due/);
});

test('an amount paid equal to the late charge alone still leaves the amount due whole still owed, flagged as such', () => {
  const r = modelLateFeeProgress({ amountDue: '3', lateRateBps: 3333, periodsLate: 2, amountAlreadyPaid: '1', decimals: 0 });
  assert.equal(r.lateCharge, 1n);
  assert.equal(r.paidEqualsLateCharge, true);
  assert.equal(r.stillOwed, r.amountDue);
});

test('a 777 position at no decimals: 200 paid of the 854 total leaves 654 still owed, shares 2341.92 and 7658.07', () => {
  const r = modelLateFeeProgress({ amountDue: '777', lateRateBps: 250, periodsLate: 4, amountAlreadyPaid: '200', decimals: 0 });
  assert.equal(r.lateCharge, 77n);
  assert.equal(r.totalNowDue, 854n);
  assert.equal(r.stillOwed, 654n);
  assert.equal(r.alreadyPaidShareBpsText, '2341.92');
  assert.equal(r.stillOwedShareBpsText, '7658.07');
});

test('a 2^53+1 position stays exact: paying the charge alone (1351079888211148) leaves the amount due whole (9007199254740993) still owed', () => {
  const r = modelLateFeeProgress({ amountDue: '9007199254740993', lateRateBps: 500, periodsLate: 3, amountAlreadyPaid: '1351079888211148', decimals: 0 });
  assert.equal(r.totalNowDue, 10358279142952141n);
  assert.equal(r.stillOwed, 9007199254740993n);
  assert.equal(r.paidEqualsLateCharge, true);
});

test('no charge stated leaves a position on the amount due alone: zero periods with 250 paid of 1000 due leaves 750 still owed', () => {
  const r = modelLateFeeProgress({ amountDue: '1000', lateRateBps: 500, periodsLate: 0, amountAlreadyPaid: '250', decimals: 6 });
  assert.equal(r.lateCharge, 0n);
  assert.equal(r.noChargeYet, true);
  assert.equal(r.stillOwed, 750000000n);
  assert.equal(r.alreadyPaidShareBpsText, '2500.00');
  assert.equal(r.stillOwedShareBpsText, '7500.00');
});

test('the base model\u2019s refusals propagate: an amount due of zero and a rate beyond the whole are refused here too', () => {
  assert.throws(() => modelLateFeeProgress({ amountDue: '0', amountAlreadyPaid: '0', decimals: 6 }), /Amount due must be greater than zero/);
  assert.throws(() => modelLateFeeProgress({ amountDue: '1000', lateRateBps: 10001, amountAlreadyPaid: '0', decimals: 6 }), /Late rate must be/);
});

test('allocation is never priced: how a payment splits between the charge and the amount due is stated nowhere in the position', () => {
  const r = modelLateFeeProgress(DEFAULT);
  assert.equal(r.allocationPriced, false);
  assert.equal(r.entitlementPriced, false);
});

test('shares are derived from the amounts and floored, never rounded: the preload still-owed share states 6521.73, not 6521.74', () => {
  const r = modelLateFeeProgress(DEFAULT);
  assert.equal(r.stillOwedShareBpsText, '6521.73'); // 750/1150 = 6521.7391... hundredths of a basis point, floored.
});

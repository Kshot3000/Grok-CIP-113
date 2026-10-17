import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSubscriptionPlanChange, modelSubscriptionProration } from '../src/domain.js';

const DEFAULT = { oldAmount: '100', newAmount: '150', remainingBps: 2500, decimals: 6 };

test('preload: switching from a 100 plan to a 150 plan at 2,500 bps remaining credits 25, charges 37.5, and leaves 12.5 due', () => {
  const r = modelSubscriptionPlanChange(DEFAULT);
  assert.equal(r.oldPeriodPriceAmount, 100000000n);
  assert.equal(r.newPeriodPriceAmount, 150000000n);
  assert.equal(r.remainingBps, 2500);
  assert.equal(r.elapsedBps, 7500);
  assert.equal(r.creditAmount, 25000000n);
  assert.equal(r.newChargeAmount, 37500000n);
  assert.equal(r.creditAppliedAmount, 25000000n);
  assert.equal(r.amountDueAmount, 12500000n);
  assert.equal(r.excessCreditAmount, 0n);
  assert.equal(r.switchIsUpgrade, true);
  assert.equal(r.creditFullyApplied, true);
});

test('identities: applied plus due is the new charge, applied plus excess is the credit, and each side sums to its own price', () => {
  for (const [oldAmount, newAmount, remainingBps, decimals] of [['100', '150', 2500, 6], ['150', '100', 2500, 6], ['100', '100', 2500, 6], ['100', '150', 0, 6], ['100', '150', 10000, 6], ['999', '499', 1000, 0], ['10000', '1', 1, 0]]) {
    const r = modelSubscriptionPlanChange({ oldAmount, newAmount, remainingBps, decimals });
    assert.equal(r.creditAppliedAmount + r.amountDueAmount, r.newChargeAmount);
    assert.equal(r.creditAppliedAmount + r.excessCreditAmount, r.creditAmount);
    assert.equal(r.creditAmount + r.oldElapsedAmount, r.oldPeriodPriceAmount);
    assert.equal(r.newChargeAmount + r.newNotChargedAmount, r.newPeriodPriceAmount);
    assert.equal(r.remainingBps + r.elapsedBps, 10000);
  }
});

test('composition: the credit and the charge are the proration model unchanged on the old and new prices', () => {
  for (const [oldAmount, newAmount, remainingBps, decimals] of [['100', '150', 2500, 6], ['150', '100', 2500, 6], ['999', '499', 1000, 0], ['100', '150', 10000, 6]]) {
    const r = modelSubscriptionPlanChange({ oldAmount, newAmount, remainingBps, decimals });
    assert.equal(r.creditAmount, modelSubscriptionProration({ amount: oldAmount, remainingBps, decimals }).chargeAmount);
    assert.equal(r.newChargeAmount, modelSubscriptionProration({ amount: newAmount, remainingBps, decimals }).chargeAmount);
    assert.equal(r.oldElapsedAmount, modelSubscriptionProration({ amount: oldAmount, remainingBps, decimals }).notChargedAmount);
  }
});

test('the charge is measured on the new price, never the old: at the old rate the charge would be the credit itself', () => {
  const r = modelSubscriptionPlanChange(DEFAULT);
  assert.equal(r.newChargeAmount, 37500000n);
  assert.notEqual(r.newChargeAmount, r.creditAmount);
});

test('a downgrade states the unapplied credit: switching from 150 to 100 at 2,500 bps credits 37.5, charges 25, and leaves 12.5 not applied', () => {
  const r = modelSubscriptionPlanChange({ oldAmount: '150', newAmount: '100', remainingBps: 2500, decimals: 6 });
  assert.equal(r.creditAmount, 37500000n);
  assert.equal(r.newChargeAmount, 25000000n);
  assert.equal(r.creditAppliedAmount, 25000000n);
  assert.equal(r.amountDueAmount, 0n);
  assert.equal(r.excessCreditAmount, 12500000n);
  assert.equal(r.switchIsDowngrade, true);
  assert.equal(r.noAmountDue, true);
  assert.equal(r.excessCreditRemains, true);
  assert.equal(r.excessShareBpsText, '3333.33');
});

test('the same price on both plans states an exact cover: credit equals charge, nothing due, nothing left over', () => {
  const r = modelSubscriptionPlanChange({ oldAmount: '100', newAmount: '100', remainingBps: 2500, decimals: 6 });
  assert.equal(r.samePlanPrice, true);
  assert.equal(r.creditAmount, 25000000n);
  assert.equal(r.newChargeAmount, 25000000n);
  assert.equal(r.amountDueAmount, 0n);
  assert.equal(r.excessCreditAmount, 0n);
  assert.equal(r.creditFullyApplied, true);
});

test('no remaining share stated states no credit and nothing due: the switch settles at the period boundary', () => {
  const r = modelSubscriptionPlanChange({ oldAmount: '100', newAmount: '150', remainingBps: 0, decimals: 6 });
  assert.equal(r.noRemainingStated, true);
  assert.equal(r.creditAmount, 0n);
  assert.equal(r.newChargeAmount, 0n);
  assert.equal(r.amountDueAmount, 0n);
  assert.equal(r.oldElapsedAmount, r.oldPeriodPriceAmount);
  assert.equal(r.elapsedBps, 10000);
});

test('a remaining share of the whole credits the old price whole and charges the new price whole', () => {
  const r = modelSubscriptionPlanChange({ oldAmount: '100', newAmount: '150', remainingBps: 10000, decimals: 6 });
  assert.equal(r.wholePeriodRemaining, true);
  assert.equal(r.creditAmount, 100000000n);
  assert.equal(r.newChargeAmount, 150000000n);
  assert.equal(r.amountDueAmount, 50000000n);
  assert.equal(r.elapsedBps, 0);
});

test('both sides floor, never round: 1,000 bps of a 999 price is 99 on the credit side and on the charge side alike', () => {
  const r = modelSubscriptionPlanChange({ oldAmount: '999', newAmount: '999', remainingBps: 1000, decimals: 0 });
  assert.equal(r.creditAmount, 99n);
  assert.equal(r.newChargeAmount, 99n);
  assert.equal(r.creditShareBpsText, '990.99');
  assert.equal(r.newChargeShareBpsText, '990.99');
});

test('a credit can stand unapplied whole when the new charge floors to zero: 1 bps of a 10,000 old price credits 1 against a floored 1-unit new price', () => {
  const r = modelSubscriptionPlanChange({ oldAmount: '10000', newAmount: '1', remainingBps: 1, decimals: 0 });
  assert.equal(r.creditAmount, 1n);
  assert.equal(r.newChargeAmount, 0n);
  assert.equal(r.newChargeFloorsToZero, true);
  assert.equal(r.creditAppliedAmount, 0n);
  assert.equal(r.excessCreditAmount, 1n);
  assert.equal(r.amountDueAmount, 0n);
});

test('a remaining share beyond the whole is refused, and a fractional share is refused', () => {
  assert.throws(() => modelSubscriptionPlanChange({ oldAmount: '100', newAmount: '150', remainingBps: 10001, decimals: 6 }), /Remaining share must be a whole number of basis points between 0 and 10,000/);
  assert.throws(() => modelSubscriptionPlanChange({ oldAmount: '100', newAmount: '150', remainingBps: 2.5, decimals: 6 }), /Remaining share must be a whole number of basis points between 0 and 10,000/);
});

test('an old or new period price of zero is refused with its own message', () => {
  assert.throws(() => modelSubscriptionPlanChange({ oldAmount: '0', newAmount: '150', remainingBps: 2500, decimals: 6 }), /Old period price must be greater than zero/);
  assert.throws(() => modelSubscriptionPlanChange({ oldAmount: '100', newAmount: '0', remainingBps: 2500, decimals: 6 }), /New period price must be greater than zero/);
});

test('distinction: joining charges the remaining share with no credit; a plan change nets the credit against the new charge', () => {
  const join = modelSubscriptionProration({ amount: '150', remainingBps: 2500, decimals: 6 });
  assert.equal(join.chargeAmount, 37500000n);
  const change = modelSubscriptionPlanChange(DEFAULT);
  assert.equal(change.newChargeAmount, join.chargeAmount);
  assert.equal(change.amountDueAmount, 12500000n);
  assert.ok(change.amountDueAmount < change.newChargeAmount);
});

test('the credit is not a cash refund and the unapplied part is neither cash nor a balance', () => {
  const r = modelSubscriptionPlanChange({ oldAmount: '150', newAmount: '100', remainingBps: 2500, decimals: 6 });
  assert.equal(r.creditIsCashRefund, false);
  assert.equal(r.excessIsCash, false);
  assert.equal(r.excessBecomesBalance, false);
  assert.equal(r.amountDueIsFee, false);
});

test('what is not priced stays unpriced: switch fee, day-count convention, timing, next period, and taxes', () => {
  const r = modelSubscriptionPlanChange(DEFAULT);
  assert.equal(r.switchFeePriced, false);
  assert.equal(r.dayCountPriced, false);
  assert.equal(r.timingPriced, false);
  assert.equal(r.nextPeriodPriced, false);
  assert.equal(r.taxPriced, false);
});

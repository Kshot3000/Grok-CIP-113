import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSubscriptionProration, modelSubscriptionPull } from '../src/domain.js';

const DEFAULT = { amount: '100', remainingBps: 2500, decimals: 6 };

test('preload: a 2,500 bps remaining share of a 100 period price is 25 due on joining and 75 not charged', () => {
  const r = modelSubscriptionProration(DEFAULT);
  assert.equal(r.periodPriceAmount, 100000000n);
  assert.equal(r.remainingBps, 2500);
  assert.equal(r.elapsedBps, 7500);
  assert.equal(r.chargeAmount, 25000000n);
  assert.equal(r.notChargedAmount, 75000000n);
  assert.equal(r.chargeShareBpsText, '2500.00');
  assert.equal(r.notChargedShareBpsText, '7500.00');
  assert.equal(r.chargeIsPartial, true);
  assert.equal(r.chargeIsWholePrice, false);
});

test('identities: charge plus not charged is the period price exactly', () => {
  for (const [amount, remainingBps, decimals] of [['100', 2500, 6], ['100', 0, 6], ['100', 10000, 6], ['999', 1000, 0], ['1', 1, 0], ['10', 2500, 6]]) {
    const r = modelSubscriptionProration({ amount, remainingBps, decimals });
    assert.equal(r.chargeAmount + r.notChargedAmount, r.periodPriceAmount);
    assert.equal(r.remainingBps + r.elapsedBps, 10000);
  }
});

test('the charge is measured on the period price, never on the part already elapsed', () => {
  const r = modelSubscriptionProration(DEFAULT);
  assert.equal(r.chargeMeasuredOnPeriodPrice, true);
  // 25% of the 75 elapsed part would be 18.75 — the stated share of the period price is 25.
  assert.equal(r.chargeAmount, 25000000n);
  assert.notEqual(r.chargeAmount, 18750000n);
});

test('no remaining share stated states no charge due: the whole period price is not charged', () => {
  const r = modelSubscriptionProration({ amount: '100', remainingBps: 0, decimals: 6 });
  assert.equal(r.noRemainingStated, true);
  assert.equal(r.noChargeDue, true);
  assert.equal(r.chargeAmount, 0n);
  assert.equal(r.notChargedAmount, r.periodPriceAmount);
  assert.equal(r.elapsedBps, 10000);
  assert.equal(r.chargeShareBpsText, '0.00');
});

test('a remaining share of the whole states the whole period price due on joining', () => {
  const r = modelSubscriptionProration({ amount: '100', remainingBps: 10000, decimals: 6 });
  assert.equal(r.chargeIsWholePrice, true);
  assert.equal(r.chargeAmount, 100000000n);
  assert.equal(r.notChargedAmount, 0n);
  assert.equal(r.elapsedBps, 0);
  assert.equal(r.notChargedShareBpsText, '0.00');
});

test('a stated share flooring to zero on a one-base-unit price states no charge due at that size', () => {
  const r = modelSubscriptionProration({ amount: '1', remainingBps: 1, decimals: 0 });
  assert.equal(r.chargeFloorsToZero, true);
  assert.equal(r.noChargeDue, true);
  assert.equal(r.chargeAmount, 0n);
  assert.equal(r.notChargedAmount, 1n);
});

test('the charge floors, never rounds: 1,000 bps of a 999 price is 99, and the shares floor too', () => {
  const r = modelSubscriptionProration({ amount: '999', remainingBps: 1000, decimals: 0 });
  assert.equal(r.chargeAmount, 99n);
  assert.equal(r.notChargedAmount, 900n);
  assert.equal(r.chargeShareBpsText, '990.99');
  assert.equal(r.notChargedShareBpsText, '9009.00');
});

test('fractional amounts state exactly in BigInt: 2,500 bps of a 10 price is 2.5 due and 7.5 not charged', () => {
  const r = modelSubscriptionProration({ amount: '10', remainingBps: 2500, decimals: 6 });
  assert.equal(r.chargeAmount, 2500000n);
  assert.equal(r.notChargedAmount, 7500000n);
});

test('a remaining share beyond the whole is refused, and a fractional share is refused', () => {
  assert.throws(() => modelSubscriptionProration({ amount: '100', remainingBps: 10001, decimals: 6 }), /Remaining share must be a whole number of basis points between 0 and 10,000/);
  assert.throws(() => modelSubscriptionProration({ amount: '100', remainingBps: 2.5, decimals: 6 }), /Remaining share must be a whole number of basis points between 0 and 10,000/);
  const r = modelSubscriptionProration(DEFAULT);
  assert.equal(r.chargeExceedsPrice, false);
});

test('a period price of zero or less is refused', () => {
  assert.throws(() => modelSubscriptionProration({ amount: '0', remainingBps: 2500, decimals: 6 }), /Period price must be greater than zero/);
});

test('distinction: a pull charges the full amount for a period already running; proration charges only the remaining share on joining', () => {
  const pull = modelSubscriptionPull({ amount: '100', periods: 12, allowanceCap: '1200', serviceFeeBps: 0, periodsElapsed: 0, decimals: 6 });
  assert.equal(pull.nextPullAmount, 100000000n);
  const pro = modelSubscriptionProration(DEFAULT);
  assert.equal(pro.chargeAmount, 25000000n);
  assert.ok(pro.chargeAmount < pull.nextPullAmount);
});

test('the charge is not a discount and not a fee: the period price stands whole and the charge is the price for the remaining part', () => {
  const r = modelSubscriptionProration(DEFAULT);
  assert.equal(r.chargeIsDiscount, false);
  assert.equal(r.chargeIsFee, false);
});

test('the charge is not a free trial: no free time is stated and the remaining period is charged at the stated share', () => {
  const r = modelSubscriptionProration(DEFAULT);
  assert.equal(r.chargeIsTrial, false);
});

test('what is not priced stays unpriced: day-count convention, renewal, plan changes, and taxes', () => {
  const r = modelSubscriptionProration(DEFAULT);
  assert.equal(r.dayCountPriced, false);
  assert.equal(r.renewalPriced, false);
  assert.equal(r.planChangePriced, false);
  assert.equal(r.taxPriced, false);
});

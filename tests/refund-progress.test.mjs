import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelRefundProgress, modelRefund } from '../src/domain.js';

// Refund progress model (v1.220): the refund axis's second
// moment — the position after part of a stated refund has
// already been handed back. What remains refundable is the
// stated refund minus what has already been handed back,
// never the stated rate applied to the amount paid a
// second time and never the rate applied to what is
// currently retained; the shares are derived from the
// amounts against the amount paid, floored.
const DEFAULT = { amountPaid: '1000', refundRateBps: 2500, amountAlreadyRefunded: '100', decimals: 6 };

test('the preloaded position: 1000 paid at a stated 2500 bps rate refunds 250 in all, 100 already handed back leaves 150 still refundable, 900 retained so far and 750 retained once the refund completes, shares 2500.00, 1000.00, 1500.00 and 7500.00', () => {
  const r = modelRefundProgress(DEFAULT);
  assert.equal(r.amountPaid, 1000000000n);
  assert.equal(r.refundAmount, 250000000n);
  assert.equal(r.amountAlreadyRefunded, 100000000n);
  assert.equal(r.stillRefundable, 150000000n);
  assert.equal(r.amountRetainedSoFar, 900000000n);
  assert.equal(r.amountRetained, 750000000n);
  assert.equal(r.refundShareBpsText, '2500.00');
  assert.equal(r.alreadyRefundedShareBpsText, '1000.00');
  assert.equal(r.stillRefundableShareBpsText, '1500.00');
  assert.equal(r.retainedShareBpsText, '7500.00');
  assert.equal(r.partiallyRefunded, true);
});

test('the default amount already refunded is none when none is given: the whole stated refund remains refundable, the base model position', () => {
  const r = modelRefundProgress({ amountPaid: '1000', refundRateBps: 2500, decimals: 6 });
  assert.equal(r.amountAlreadyRefunded, 0n);
  assert.equal(r.stillRefundable, r.refundAmount);
  assert.equal(r.nothingRefundedYet, true);
});

test('identities hold across positions: already refunded plus still refundable is the stated refund, already refunded plus still refundable plus the amount finally retained is the amount paid, and the amount retained so far is the still refundable plus the amount finally retained, exactly', () => {
  const cases = [
    DEFAULT,
    { amountPaid: '1000', refundRateBps: 0, amountAlreadyRefunded: '0', decimals: 6 },
    { amountPaid: '1000', refundRateBps: 10000, amountAlreadyRefunded: '1000', decimals: 6 },
    { amountPaid: '777', refundRateBps: 2000, amountAlreadyRefunded: '100', decimals: 0 },
    { amountPaid: '9007199254740993', refundRateBps: 2500, amountAlreadyRefunded: '2251799813685247', decimals: 0 },
    { amountPaid: '0.000001', refundRateBps: 100, amountAlreadyRefunded: '0', decimals: 6 },
    { amountPaid: '999', refundRateBps: 3333, amountAlreadyRefunded: '332', decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelRefundProgress(c);
    assert.equal(r.amountAlreadyRefunded + r.stillRefundable, r.refundAmount);
    assert.equal(r.amountAlreadyRefunded + r.stillRefundable + r.amountRetained, r.amountPaid);
    assert.equal(r.amountRetainedSoFar, r.stillRefundable + r.amountRetained);
    assert.ok(r.amountAlreadyRefunded <= r.refundAmount);
  }
});

test('what remains refundable is measured against what remains, never against the original payment again: applying the stated 25% rate to the 1000 paid a second time states 250, and applying it to the 900 retained so far states 225, where 150 remains refundable', () => {
  const r = modelRefundProgress(DEFAULT);
  assert.equal(r.stillRefundable, 150000000n);
  assert.notEqual(r.stillRefundable, 1000000000n * 2500n / 10000n);
  assert.notEqual(r.stillRefundable, 900000000n * 2500n / 10000n);
  assert.equal(r.furtherRefundMeasuredOnOriginalPayment, false);
});

test('the position composes the refund model unchanged: with nothing handed back yet, the stated refund, the amount still refundable, and the amount finally retained are the base model amounts exactly', () => {
  const base = modelRefund({ amountPaid: '1000', refundRateBps: 2500, decimals: 6 });
  const r = modelRefundProgress({ amountPaid: '1000', refundRateBps: 2500, amountAlreadyRefunded: '0', decimals: 6 });
  assert.equal(r.refundAmount, base.refundAmount);
  assert.equal(r.stillRefundable, base.refundAmount);
  assert.equal(r.amountRetained, base.amountRetained);
  assert.equal(r.amountRetainedSoFar, base.amountPaid);
});

test('an amount already refunded beyond the stated refund is refused, never capped silently at the stated refund: 251 already handed back against a stated refund of 250 is not a refund position', () => {
  assert.throws(() => modelRefundProgress({ amountPaid: '1000', refundRateBps: 2500, amountAlreadyRefunded: '251', decimals: 6 }), /Amount already refunded must not exceed the stated refund/);
  assert.throws(() => modelRefundProgress({ amountPaid: '1000', refundRateBps: 0, amountAlreadyRefunded: '1', decimals: 6 }), /Amount already refunded must not exceed the stated refund/);
});

test('eligibility is not priced: the model states the position the hand-backs describe, never whether a refund is owed, who may claim the part that remains, or how long a claim on it stays open', () => {
  const r = modelRefundProgress(DEFAULT);
  assert.equal(r.eligibilityPriced, false);
});

test('no refund stated is a position: nothing is refundable, nothing has been handed back, and the amount retained so far is the amount paid whole, with retained share 10000.00', () => {
  const r = modelRefundProgress({ amountPaid: '1000', refundRateBps: 0, amountAlreadyRefunded: '0', decimals: 6 });
  assert.equal(r.noRefundStated, true);
  assert.equal(r.refundAmount, 0n);
  assert.equal(r.stillRefundable, 0n);
  assert.equal(r.amountRetainedSoFar, 1000000000n);
  assert.equal(r.amountRetained, 1000000000n);
  assert.equal(r.retainedShareBpsText, '10000.00');
  assert.equal(r.nothingRefundedYet, false);
  assert.equal(r.fullyRefunded, false);
});

test('a stated rate that floors the refund to zero leaves nothing refundable at that size, stated as such: 1 base unit at 100 bps carries no whole base unit of refund at any point in the position', () => {
  const r = modelRefundProgress({ amountPaid: '0.000001', refundRateBps: 100, amountAlreadyRefunded: '0', decimals: 6 });
  assert.equal(r.noRefundStated, false);
  assert.equal(r.refundFloorsToZero, true);
  assert.equal(r.refundAmount, 0n);
  assert.equal(r.stillRefundable, 0n);
  assert.equal(r.amountRetainedSoFar, 1n);
});

test('a refund handed back whole at a rate of the whole is fully refunded: 1000 already refunded on 1000 paid leaves nothing refundable and nothing retained', () => {
  const r = modelRefundProgress({ amountPaid: '1000', refundRateBps: 10000, amountAlreadyRefunded: '1000', decimals: 6 });
  assert.equal(r.fullyRefunded, true);
  assert.equal(r.partiallyRefunded, false);
  assert.equal(r.stillRefundable, 0n);
  assert.equal(r.amountRetainedSoFar, 0n);
  assert.equal(r.amountRetained, 0n);
  assert.equal(r.alreadyRefundedShareBpsText, '10000.00');
  assert.equal(r.stillRefundableShareBpsText, '0.00');
});

test('a refund can be fully refunded at a partial rate: 250 already handed back against the stated 250 refund on 1000 paid leaves nothing refundable and the base model amount of 750 retained', () => {
  const r = modelRefundProgress({ amountPaid: '1000', refundRateBps: 2500, amountAlreadyRefunded: '250', decimals: 6 });
  assert.equal(r.fullyRefunded, true);
  assert.equal(r.stillRefundable, 0n);
  assert.equal(r.amountRetainedSoFar, 750000000n);
  assert.equal(r.amountRetained, 750000000n);
});

test('nothing handed back yet is its own outcome, distinct from part-refunded and fully refunded: the whole stated refund remains refundable', () => {
  const r = modelRefundProgress({ amountPaid: '1000', refundRateBps: 2500, amountAlreadyRefunded: '0', decimals: 6 });
  assert.equal(r.nothingRefundedYet, true);
  assert.equal(r.partiallyRefunded, false);
  assert.equal(r.fullyRefunded, false);
  assert.equal(r.stillRefundable, 250000000n);
  assert.equal(r.amountRetainedSoFar, 1000000000n);
});

test('shares are derived from the amounts against the amount paid: on the no-decimals 777 payment at 2000 bps, 100 already handed back of the 155 refund states shares 1994.85, 1287.00, 707.85 and 8005.14, with 55 still refundable, 677 retained so far and 622 retained at the end', () => {
  const r = modelRefundProgress({ amountPaid: '777', refundRateBps: 2000, amountAlreadyRefunded: '100', decimals: 0 });
  assert.equal(r.refundAmount, 155n);
  assert.equal(r.stillRefundable, 55n);
  assert.equal(r.amountRetainedSoFar, 677n);
  assert.equal(r.amountRetained, 622n);
  assert.equal(r.refundShareBpsText, '1994.85');
  assert.equal(r.alreadyRefundedShareBpsText, '1287.00');
  assert.equal(r.stillRefundableShareBpsText, '707.85');
  assert.equal(r.retainedShareBpsText, '8005.14');
});

test('shares are floored, never rounded up: on a 2^53+1 payment, the single base unit still refundable states a 0.00 share, not a rounded-up one, while the amount itself stands at exactly 1', () => {
  const r = modelRefundProgress({ amountPaid: '9007199254740993', refundRateBps: 2500, amountAlreadyRefunded: '2251799813685247', decimals: 0 });
  assert.equal(r.stillRefundable, 1n);
  assert.equal(r.stillRefundableShareBpsText, '0.00');
  assert.equal(r.alreadyRefundedShareBpsText, '2499.99');
});

test('amounts beyond float precision stay exact: a 2^53+1 payment at 2500 bps states a refund of 2251799813685248, and with 2251799813685247 already handed back exactly 1 remains refundable, 6755399441055746 is retained so far and 6755399441055745 at the end', () => {
  const r = modelRefundProgress({ amountPaid: '9007199254740993', refundRateBps: 2500, amountAlreadyRefunded: '2251799813685247', decimals: 0 });
  assert.equal(r.refundAmount, 2251799813685248n);
  assert.equal(r.amountAlreadyRefunded, 2251799813685247n);
  assert.equal(r.stillRefundable, 1n);
  assert.equal(r.amountRetainedSoFar, 6755399441055746n);
  assert.equal(r.amountRetained, 6755399441055745n);
});

test('the base model refusals propagate: a zero amount paid and a rate beyond the whole are refused by the refund model the position composes', () => {
  assert.throws(() => modelRefundProgress({ amountPaid: '0', refundRateBps: 2500, amountAlreadyRefunded: '0', decimals: 6 }), /Amount paid must be greater than zero/);
  assert.throws(() => modelRefundProgress({ amountPaid: '1000', refundRateBps: 10001, amountAlreadyRefunded: '0', decimals: 6 }), /Refund rate must be a whole number of basis points/);
});

test('a negative amount already refunded is refused at parsing, before the model ever sees it', () => {
  assert.throws(() => modelRefundProgress({ amountPaid: '1000', refundRateBps: 2500, amountAlreadyRefunded: '-1', decimals: 6 }), /Enter a positive decimal amount/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelSubscriptionPull } from '../src/domain.js';

// Recurring subscription pull model (v1.262): a subscriber
// authorises a fixed pull once per period up to a stated number
// of periods and a stated allowance cap — two ceilings, the
// lower wins. The service fee is floored on each pull, a cap
// that does not divide by the amount ends with one partial
// final pull, and a history exceeding the effective total is
// refused.
const DEFAULT = { amount: '25', decimals: 6, periods: 12, allowanceCap: '250', serviceFeeBps: 250, periodsElapsed: 4 };

test('the preloaded subscription: the 250 cap, not the 300 authorised total, is the ceiling', () => {
  const r = modelSubscriptionPull(DEFAULT);
  assert.equal(r.amount, 25000000n);
  assert.equal(r.authorisedTotal, 300000000n);
  assert.equal(r.allowanceCap, 250000000n);
  assert.equal(r.effectiveTotal, 250000000n);
  assert.equal(r.cappedByAllowance, true);
  assert.equal(r.fullPulls, 10n);
  assert.equal(r.partialAmount, 0n);
  assert.equal(r.pullCount, 10n);
  assert.equal(r.feePerPeriod, 625000n);
  assert.equal(r.merchantPerPeriod, 24375000n);
  assert.equal(r.totalFees, 6250000n);
  assert.equal(r.merchantTotal, 243750000n);
  assert.equal(r.merchantTotal + r.totalFees, r.effectiveTotal);
  assert.equal(r.paidSoFar, 100000000n);
  assert.equal(r.feesPaidSoFar, 2500000n);
  assert.equal(r.merchantReceivedSoFar, 97500000n);
  assert.equal(r.remainingTotal, 150000000n);
  assert.equal(r.paidSoFar + r.remainingTotal, r.effectiveTotal);
  assert.equal(r.remainingPullCount, 6n);
  assert.equal(r.nextPullAmount, 25000000n);
  assert.equal(r.remainingFees, 3750000n);
  assert.equal(r.merchantRemaining, 146250000n);
  assert.equal(r.totalFeeShareBpsText, '250.00');
  assert.equal(r.paidShareBpsText, '4000.00');
  assert.equal(r.effectiveShareBpsText, '8333.33');
});

test('identities hold across amounts, periods, caps, and fees', () => {
  const cases = [
    { amount: '5000', decimals: 6, periods: 10, allowanceCap: '40000', serviceFeeBps: 400, periodsElapsed: 3 },
    { amount: '250', decimals: 2, periods: 40, allowanceCap: '9999', serviceFeeBps: 125, periodsElapsed: 39 },
    { amount: '777', decimals: 0, periods: 3, allowanceCap: '2000', serviceFeeBps: 9999, periodsElapsed: 2 },
    { amount: '1000000', decimals: 6, periods: 120, allowanceCap: '1000000', serviceFeeBps: 0, periodsElapsed: 0 },
  ];
  for (const c of cases) {
    const r = modelSubscriptionPull(c);
    assert.equal(r.effectiveTotal, r.allowanceCap < r.authorisedTotal ? r.allowanceCap : r.authorisedTotal);
    assert.equal(r.fullPulls * r.amount + r.partialAmount, r.effectiveTotal);
    assert.equal(r.merchantTotal + r.totalFees, r.effectiveTotal);
    assert.equal(r.paidSoFar + r.remainingTotal, r.effectiveTotal);
    assert.equal(r.feesPaidSoFar + r.remainingFees, r.totalFees);
    assert.equal(r.merchantReceivedSoFar + r.merchantRemaining, r.merchantTotal);
    assert.equal(r.remainingFullPulls * r.amount + r.remainingPartialAmount, r.remainingTotal);
  }
});

test('an unstated cap is the authorised total itself and an unstated elapsed state is not started', () => {
  const r = modelSubscriptionPull({ amount: '25', decimals: 6, periods: 12, serviceFeeBps: 250 });
  assert.equal(r.allowanceCap, r.authorisedTotal);
  assert.equal(r.capEqualsAuthorised, true);
  assert.equal(r.cappedByAllowance, false);
  assert.equal(r.effectiveTotal, 300000000n);
  assert.equal(r.pullCount, 12n);
  assert.equal(r.totalFees, 7500000n);
  assert.equal(r.notStarted, true);
  assert.equal(r.paidShareBpsText, '0.00');
  assert.equal(r.effectiveShareBpsText, '10000.00');
});

test('a cap above the authorised total changes nothing: the periods run out first', () => {
  const r = modelSubscriptionPull({ ...DEFAULT, allowanceCap: '500', periodsElapsed: 12 });
  assert.equal(r.capAboveAuthorised, true);
  assert.equal(r.effectiveTotal, r.authorisedTotal);
  assert.equal(r.pullCount, 12n);
  assert.equal(r.allPeriodsPulled, true);
  assert.equal(r.allowanceExhausted, true);
  assert.equal(r.nextPullAmount, 0n);
});

test('a cap that does not divide by the amount ends with one partial final pull, never rounded up', () => {
  const r = modelSubscriptionPull({ ...DEFAULT, allowanceCap: '260', periodsElapsed: 10 });
  assert.equal(r.effectiveTotal, 260000000n);
  assert.equal(r.fullPulls, 10n);
  assert.equal(r.partialAmount, 10000000n);
  assert.equal(r.pullCount, 11n);
  assert.equal(r.partialFinalPull, true);
  // The partial pull's fee is floored on the partial amount, not charged as a full pull's fee.
  assert.equal(r.feeOnPartial, 250000n);
  assert.equal(r.totalFees, 6500000n);
  // Only the partial pull remains, so it is the next pull.
  assert.equal(r.remainingTotal, 10000000n);
  assert.equal(r.nextPullAmount, 10000000n);
  assert.equal(r.nextPullIsPartial, true);
  assert.equal(r.remainingFees, 250000n);
  assert.equal(r.merchantRemaining, 9750000n);
  assert.equal(r.effectiveShareBpsText, '8666.66');
});

test('the cap shortens the subscription even when every authorised period remains unpulled', () => {
  const capped = modelSubscriptionPull({ ...DEFAULT, periodsElapsed: 0 });
  const uncapped = modelSubscriptionPull({ amount: '25', decimals: 6, periods: 12, serviceFeeBps: 250, periodsElapsed: 0 });
  assert.equal(capped.pullCount, 10n);
  assert.equal(uncapped.pullCount, 12n);
  assert.equal(uncapped.effectiveTotal - capped.effectiveTotal, 50000000n);
});

test('a zero service fee takes nothing: the merchant receives every pull whole', () => {
  const r = modelSubscriptionPull({ ...DEFAULT, serviceFeeBps: 0 });
  assert.equal(r.noFee, true);
  assert.equal(r.feePerPeriod, 0n);
  assert.equal(r.totalFees, 0n);
  assert.equal(r.merchantTotal, r.effectiveTotal);
  assert.equal(r.totalFeeShareBpsText, '0.00');
});

test('a stated fee that floors to zero on a small amount at low decimals is stated, never presented as taken', () => {
  const r = modelSubscriptionPull({ amount: '10', decimals: 0, periods: 4, allowanceCap: '40', serviceFeeBps: 1, periodsElapsed: 1 });
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.noFee, false);
  assert.equal(r.feePerPeriod, 0n);
  assert.equal(r.totalFees, 0n);
  assert.equal(r.merchantPerPeriod, 10n);
  assert.equal(r.capEqualsAuthorised, true);
});

test('beyond float: shares are derived from the floored amounts, not the entered counts', () => {
  const r = modelSubscriptionPull({ amount: '1234567', decimals: 6, periods: 7, allowanceCap: '8000000', serviceFeeBps: 333, periodsElapsed: 3 });
  assert.equal(r.feePerPeriod, 41111081100n);
  assert.equal(r.partialAmount, 592598000000n);
  assert.equal(r.feeOnPartial, 19733513400n);
  assert.equal(r.totalFees, 266400000000n);
  assert.equal(r.merchantTotal, 7733600000000n);
  // 3 of 7 periods would state 4285.71; the paid share of the effective total states 4629.62.
  assert.equal(r.paidShareBpsText, '4629.62');
  assert.equal(r.effectiveShareBpsText, '9257.14');
  assert.equal(r.totalFeeShareBpsText, '333.00');
});

test('exhausting the cap exactly leaves nothing and no next pull', () => {
  const r = modelSubscriptionPull({ ...DEFAULT, periodsElapsed: 10 });
  assert.equal(r.paidSoFar, r.effectiveTotal);
  assert.equal(r.allowanceExhausted, true);
  assert.equal(r.remainingPullCount, 0n);
  assert.equal(r.nextPullAmount, 0n);
  assert.equal(r.remainingFees, 0n);
});

test('a subscription of one period and one pull is priced whole', () => {
  const r = modelSubscriptionPull({ amount: '999', decimals: 0, periods: 1, allowanceCap: '999', serviceFeeBps: 250, periodsElapsed: 0 });
  assert.equal(r.pullCount, 1n);
  assert.equal(r.feePerPeriod, 24n);
  assert.equal(r.merchantTotal, 975n);
  assert.equal(r.nextPullAmount, 999n);
});

test('pulls already made totalling more than the effective total are refused', () => {
  // 11 periods at 25 totals 275, over the 250 cap — that history cannot have happened under this authorisation.
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, periodsElapsed: 11 }), /exceed the effective authorised total/);
});

test('a service fee taking the whole pull is refused', () => {
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, serviceFeeBps: 10000 }), /must not take the whole subscription pull/);
});

test('validation: amount, periods, fee, cap, and elapsed periods are each refused out of range', () => {
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, amount: '0' }), /Subscription amount per period must be greater than zero\./);
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, periods: 0 }), /Authorised periods must be a whole number between 1 and 120\./);
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, periods: 121 }), /Authorised periods must be a whole number between 1 and 120\./);
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, serviceFeeBps: 10001 }), /Service fee must be a whole number of basis points between 0 and 10,000\./);
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, serviceFeeBps: 2.5 }), /Service fee must be a whole number of basis points between 0 and 10,000\./);
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, allowanceCap: '0' }), /Allowance cap must be greater than zero\./);
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, periodsElapsed: -1 }), /Periods already pulled must be a whole number from 0 up to the authorised periods\./);
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, periodsElapsed: 13 }), /Periods already pulled must be a whole number from 0 up to the authorised periods\./);
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, allowanceCap: '1,000' }), /positive decimal amount/);
  assert.throws(() => modelSubscriptionPull({ ...DEFAULT, decimals: 9 }), /Decimals must be between 0 and 6\./);
});

test('the fee never enters the ceilings: two fees on the same authorisation allow the same pulls', () => {
  const free = modelSubscriptionPull({ ...DEFAULT, serviceFeeBps: 0 });
  const charged = modelSubscriptionPull({ ...DEFAULT, serviceFeeBps: 5000 });
  assert.equal(free.effectiveTotal, charged.effectiveTotal);
  assert.equal(free.pullCount, charged.pullCount);
  assert.equal(free.paidSoFar, charged.paidSoFar);
  assert.equal(charged.merchantTotal + charged.totalFees, free.merchantTotal);
});

test('wiring: app.js imports the model, renders a subscription panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelSubscriptionPull/);
  assert.match(app, /data-subpull/);
  assert.match(app, /subpull-output/);
  assert.match(app, /v1\.262/);
  assert.match(readme, /Subscription pull model/);
});

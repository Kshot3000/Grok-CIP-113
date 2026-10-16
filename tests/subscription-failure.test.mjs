import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelSubscriptionFailedPull } from '../src/domain.js';

// Subscription failed-pull model (v1.207): a failed pull moves
// nothing, charges no fee, and consumes no authorisation — a
// retry attempts exactly the same amount. After a stated number
// of consecutive failures the subscription lapses and only then
// does what remains stop being pullable.
const DEFAULT = { amount: '25', decimals: 6, periods: 12, allowanceCap: '250', serviceFeeBps: 250, periodsElapsed: 4, consecutiveFailures: 3, failureLimit: 3 };

test('the preloaded failure: three consecutive failures reach the limit and lapse all 150 that remained', () => {
  const r = modelSubscriptionFailedPull(DEFAULT);
  assert.equal(r.effectiveTotal, 250000000n);
  assert.equal(r.paidSoFar, 100000000n);
  assert.equal(r.remainingTotal, 150000000n);
  assert.equal(r.attemptedPerAttempt, 25000000n);
  assert.equal(r.totalAttempted, 75000000n);
  assert.equal(r.pulledByFailures, 0n);
  assert.equal(r.feesChargedOnFailures, 0n);
  assert.equal(r.merchantReceivedFromFailures, 0n);
  assert.equal(r.feeOnNextPull, 625000n);
  assert.equal(r.lapsed, true);
  assert.equal(r.lapsedAmount, 150000000n);
  assert.equal(r.activeRemaining, 0n);
  assert.equal(r.feesNeverCharged, 3750000n);
  assert.equal(r.merchantNeverReceives, 146250000n);
  assert.equal(r.attemptsBeforeLapse, 0);
  assert.equal(r.lapsedShareBpsText, '6000.00');
  assert.equal(r.activeRemainingShareBpsText, '0.00');
  assert.equal(r.stillActive, false);
});

test('identities hold across amounts, periods, caps, fees, failures, and limits', () => {
  const cases = [
    { amount: '5000', decimals: 6, periods: 10, allowanceCap: '40000', serviceFeeBps: 400, periodsElapsed: 3, consecutiveFailures: 2, failureLimit: 5 },
    { amount: '250', decimals: 2, periods: 40, allowanceCap: '9999', serviceFeeBps: 125, periodsElapsed: 39, consecutiveFailures: 1, failureLimit: 1 },
    { amount: '777', decimals: 0, periods: 3, allowanceCap: '2000', serviceFeeBps: 9999, periodsElapsed: 2, consecutiveFailures: 0, failureLimit: 3 },
    { amount: '1000000', decimals: 6, periods: 120, allowanceCap: '1000000', serviceFeeBps: 0, periodsElapsed: 0, consecutiveFailures: 4, failureLimit: 4 },
  ];
  for (const c of cases) {
    const r = modelSubscriptionFailedPull(c);
    assert.equal(r.lapsedAmount + r.activeRemaining, r.remainingTotal);
    assert.equal(r.feesNeverCharged + r.merchantNeverReceives, r.lapsedAmount);
    assert.equal(r.totalAttempted, r.attemptedPerAttempt * BigInt(r.consecutiveFailures));
    assert.equal(r.pulledByFailures, 0n);
    assert.equal(r.feesChargedOnFailures, 0n);
    assert.equal(r.paidSoFar + r.remainingTotal, r.effectiveTotal);
    if (r.lapsed) assert.equal(r.feesNeverCharged, r.remainingFees);
    else { assert.equal(r.lapsedAmount, 0n); assert.equal(r.activeRemaining, r.remainingTotal); }
  }
});

test('failures below the limit move nothing, lapse nothing, and leave what remains exactly as it was', () => {
  const r = modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures: 1 });
  assert.equal(r.stillActive, true);
  assert.equal(r.lapsed, false);
  assert.equal(r.totalAttempted, 25000000n);
  assert.equal(r.activeRemaining, 150000000n);
  assert.equal(r.activeRemainingShareBpsText, '6000.00');
  assert.equal(r.attemptsBeforeLapse, 2);
  assert.equal(r.feesNeverCharged, 0n);
  assert.equal(r.merchantNeverReceives, 0n);
  assert.equal(r.nextPullAmount, 25000000n);
});

test('no failures: nothing attempted, nothing lapsed, the whole remainder still active', () => {
  const r = modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures: 0 });
  assert.equal(r.noFailures, true);
  assert.equal(r.totalAttempted, 0n);
  assert.equal(r.lapsed, false);
  assert.equal(r.stillActive, false);
  assert.equal(r.attemptsBeforeLapse, 3);
  assert.equal(r.activeRemaining, r.remainingTotal);
});

test('a failure limit of one lapses the subscription on the first failure', () => {
  const r = modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures: 1, failureLimit: 1 });
  assert.equal(r.lapsed, true);
  assert.equal(r.lapsedAmount, 150000000n);
  assert.equal(r.totalAttempted, 25000000n);
});

test('every retry attempts exactly the same amount: the total attempted is the next pull times the failures, never more', () => {
  for (const consecutiveFailures of [1, 2, 3]) {
    const r = modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures, failureLimit: 3 });
    assert.equal(r.attemptedPerAttempt, r.nextPullAmount);
    assert.equal(r.totalAttempted, 25000000n * BigInt(consecutiveFailures));
  }
});

test('a failed pull charges no fee, and the fee it did not charge is the fee a successful pull would have carried', () => {
  const r = modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures: 2, failureLimit: 3 });
  assert.equal(r.feesChargedOnFailures, 0n);
  assert.equal(r.feeOnNextPull, r.feePerPeriod);
  assert.equal(r.feeOnNextPull, 625000n);
});

test('pulls already made stay pulled at every failure count: a failure never claws back a successful pull', () => {
  for (const consecutiveFailures of [0, 1, 2, 3]) {
    const r = modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures });
    assert.equal(r.paidSoFar, 100000000n);
    assert.equal(r.feesPaidSoFar, 2500000n);
    assert.equal(r.merchantReceivedSoFar, 97500000n);
  }
});

test('when only the partial remainder is left, each attempt tries for that remainder and the lapse leaves exactly it unpulled', () => {
  const r = modelSubscriptionFailedPull({ amount: '25', decimals: 6, periods: 12, allowanceCap: '260', serviceFeeBps: 250, periodsElapsed: 10, consecutiveFailures: 2, failureLimit: 2 });
  assert.equal(r.nextPullIsPartial, true);
  assert.equal(r.attemptedPerAttempt, 10000000n);
  assert.equal(r.totalAttempted, 20000000n);
  assert.equal(r.feeOnNextPull, 250000n);
  assert.equal(r.lapsed, true);
  assert.equal(r.lapsedAmount, 10000000n);
  assert.equal(r.feesNeverCharged, 250000n);
  assert.equal(r.merchantNeverReceives, 9750000n);
  // One pull of eleven would state 909.09 as a count ratio; the lapsed share of the effective total, from the amounts, is 384.61.
  assert.equal(r.lapsedShareBpsText, '384.61');
});

test('shares are derived from the amounts, not the failure or pull counts', () => {
  const r = modelSubscriptionFailedPull({ amount: '7', decimals: 6, periods: 7, allowanceCap: '49', serviceFeeBps: 333, periodsElapsed: 3, consecutiveFailures: 2, failureLimit: 2 });
  assert.equal(r.lapsedAmount, 28000000n);
  assert.equal(r.feesNeverCharged, 932400n);
  assert.equal(r.merchantNeverReceives, 27067600n);
  assert.equal(r.lapsedShareBpsText, '5714.28');
});

test('a failure on an already-exhausted authorisation is moot: no pull remained to fail and nothing is attempted', () => {
  const r = modelSubscriptionFailedPull({ ...DEFAULT, periodsElapsed: 10, consecutiveFailures: 1 });
  assert.equal(r.failureMoot, true);
  assert.equal(r.allowanceExhausted, true);
  assert.equal(r.attemptedPerAttempt, 0n);
  assert.equal(r.totalAttempted, 0n);
  assert.equal(r.feeOnNextPull, 0n);
  assert.equal(r.lapsed, false);
  assert.equal(r.lapsedAmount, 0n);
  assert.equal(r.stillActive, false);
});

test('with no service fee, the merchant would have received the whole lapsed amount', () => {
  const r = modelSubscriptionFailedPull({ ...DEFAULT, serviceFeeBps: 0 });
  assert.equal(r.noFee, true);
  assert.equal(r.feeOnNextPull, 0n);
  assert.equal(r.feesNeverCharged, 0n);
  assert.equal(r.merchantNeverReceives, r.lapsedAmount);
});

test('a stated fee flooring to zero at decimals 0 means a successful pull would have carried no fee either', () => {
  const r = modelSubscriptionFailedPull({ amount: '10', decimals: 0, periods: 5, serviceFeeBps: 1, periodsElapsed: 1, consecutiveFailures: 1, failureLimit: 3 });
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.feeOnNextPull, 0n);
  assert.equal(r.stillActive, true);
  assert.equal(r.activeRemaining, 40n);
  assert.equal(r.activeRemainingShareBpsText, '8000.00');
});

test('more consecutive failures than the limit are refused: at the limit the subscription lapses, so no further attempt is made', () => {
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures: 4, failureLimit: 3 }), /must not exceed the failure limit/);
});

test('the pull model refusals propagate: an impossible history and a whole-pull fee are refused here too', () => {
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, allowanceCap: '90' }), /Periods already pulled exceed the effective authorised total/);
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, serviceFeeBps: 10000 }), /Service fee must not take the whole subscription pull\./);
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, periodsElapsed: 13 }), /Periods already pulled must be a whole number from 0 up to the authorised periods\./);
});

test('invalid failure counts and limits are refused', () => {
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures: -1 }), /Consecutive failed pulls must be a whole number between 0 and 120\./);
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures: 121 }), /Consecutive failed pulls must be a whole number between 0 and 120\./);
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, consecutiveFailures: 1.5 }), /Consecutive failed pulls must be a whole number between 0 and 120\./);
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, failureLimit: 0 }), /Failure limit must be a whole number between 1 and 120\./);
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, failureLimit: 121 }), /Failure limit must be a whole number between 1 and 120\./);
  assert.throws(() => modelSubscriptionFailedPull({ ...DEFAULT, failureLimit: 2.5 }), /Failure limit must be a whole number between 1 and 120\./);
});

test('wiring: app.js imports the model, renders a failed-pull panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelSubscriptionFailedPull/);
  assert.match(app, /data-subfail/);
  assert.match(app, /subfail-output/);
  assert.match(app, /v1\.207/);
  assert.match(readme, /Subscription failed-pull model/);
});

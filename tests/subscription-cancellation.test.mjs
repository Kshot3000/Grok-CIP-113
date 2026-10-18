import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelSubscriptionCancellation } from '../src/domain.js';

// Subscription cancellation model (v1.264): cancelling a
// subscription does not refund pulls already made, pulls during
// a notice period still happen, and only what remains after
// notice is revoked. A cancellation after the authorisation is
// exhausted changes nothing, and a notice period longer than
// what remains means the subscription ends naturally — the
// cancellation is moot, not a revocation.
const DEFAULT = { amount: '25', decimals: 6, periods: 12, allowanceCap: '250', serviceFeeBps: 250, periodsElapsed: 4, noticePeriods: 2 };

test('the preloaded cancellation: two notice pulls still happen, 100 of authorisation is revoked', () => {
  const r = modelSubscriptionCancellation(DEFAULT);
  assert.equal(r.effectiveTotal, 250000000n);
  assert.equal(r.paidSoFar, 100000000n);
  assert.equal(r.remainingTotal, 150000000n);
  assert.equal(r.noticeRequested, 50000000n);
  assert.equal(r.noticePulled, 50000000n);
  assert.equal(r.noticePullCount, 2n);
  assert.equal(r.noticeFees, 1250000n);
  assert.equal(r.noticeMerchant, 48750000n);
  assert.equal(r.totalPaidAfterNotice, 150000000n);
  assert.equal(r.revoked, 100000000n);
  assert.equal(r.revokedPullCount, 4n);
  assert.equal(r.feesNeverCharged, 2500000n);
  assert.equal(r.merchantNeverReceives, 97500000n);
  assert.equal(r.paidSoFar + r.noticePulled + r.revoked, r.effectiveTotal);
  assert.equal(r.revokedShareBpsText, '4000.00');
  assert.equal(r.noticeShareBpsText, '2000.00');
  assert.equal(r.paidAfterNoticeShareBpsText, '6000.00');
  assert.equal(r.immediate, false);
  assert.equal(r.nothingRevoked, false);
});

test('identities hold across amounts, periods, caps, fees, and notice periods', () => {
  const cases = [
    { amount: '5000', decimals: 6, periods: 10, allowanceCap: '40000', serviceFeeBps: 400, periodsElapsed: 3, noticePeriods: 2 },
    { amount: '250', decimals: 2, periods: 40, allowanceCap: '9999', serviceFeeBps: 125, periodsElapsed: 39, noticePeriods: 5 },
    { amount: '777', decimals: 0, periods: 3, allowanceCap: '2000', serviceFeeBps: 9999, periodsElapsed: 2, noticePeriods: 1 },
    { amount: '1000000', decimals: 6, periods: 120, allowanceCap: '1000000', serviceFeeBps: 0, periodsElapsed: 0, noticePeriods: 0 },
  ];
  for (const c of cases) {
    const r = modelSubscriptionCancellation(c);
    assert.equal(r.paidSoFar + r.noticePulled + r.revoked, r.effectiveTotal);
    assert.equal(r.noticePulled + r.revoked, r.remainingTotal);
    assert.equal(r.noticeFees + r.noticeMerchant, r.noticePulled);
    assert.equal(r.feesNeverCharged + r.merchantNeverReceives, r.revoked);
    assert.equal(r.feesPaidSoFar + r.noticeFees + r.feesNeverCharged, r.totalFees);
    assert.equal(r.noticeFullPulls * r.amount + r.noticePartialAmount, r.noticePulled);
    assert.equal(r.revokedFullPulls * r.amount + r.revokedPartialAmount, r.revoked);
    assert.ok(r.noticePulled <= r.noticeRequested);
  }
});

test('an immediate cancellation revokes everything that remains and pulls nothing more', () => {
  const r = modelSubscriptionCancellation({ ...DEFAULT, noticePeriods: 0 });
  assert.equal(r.immediate, true);
  assert.equal(r.revokesAllRemaining, true);
  assert.equal(r.noticePulled, 0n);
  assert.equal(r.noticeFees, 0n);
  assert.equal(r.revoked, 150000000n);
  assert.equal(r.revokedPullCount, 6n);
  assert.equal(r.feesNeverCharged, 3750000n);
  assert.equal(r.totalPaidAfterNotice, r.paidSoFar);
  assert.equal(r.revokedShareBpsText, '6000.00');
});

test('cancelling before the first pull revokes the whole effective authorisation', () => {
  const r = modelSubscriptionCancellation({ ...DEFAULT, periodsElapsed: 0, noticePeriods: 0 });
  assert.equal(r.notStarted, true);
  assert.equal(r.paidSoFar, 0n);
  assert.equal(r.revoked, 250000000n);
  assert.equal(r.revokedShareBpsText, '10000.00');
  assert.equal(r.merchantNeverReceives, 243750000n);
});

test('a notice period longer than what remains ends the subscription naturally: the cancellation is moot', () => {
  const r = modelSubscriptionCancellation({ ...DEFAULT, noticePeriods: 10 });
  assert.equal(r.noticeRequested, 250000000n);
  assert.equal(r.noticePulled, 150000000n);
  assert.equal(r.noticePullCount, 6n);
  assert.equal(r.revoked, 0n);
  assert.equal(r.nothingRevoked, true);
  assert.equal(r.endsNaturallyDuringNotice, true);
  assert.equal(r.alreadyExhausted, false);
  assert.equal(r.totalPaidAfterNotice, r.effectiveTotal);
});

test('a notice period exactly equal to the remaining pulls also ends naturally, revoking nothing', () => {
  const r = modelSubscriptionCancellation({ ...DEFAULT, noticePeriods: 6 });
  assert.equal(r.endsNaturallyDuringNotice, true);
  assert.equal(r.revoked, 0n);
  assert.equal(r.noticePulled, r.remainingTotal);
});

test('cancelling an already-exhausted authorisation changes nothing and is not a natural ending during notice', () => {
  const r = modelSubscriptionCancellation({ ...DEFAULT, periodsElapsed: 10, noticePeriods: 2 });
  assert.equal(r.alreadyExhausted, true);
  assert.equal(r.allowanceExhausted, true);
  assert.equal(r.noticePulled, 0n);
  assert.equal(r.revoked, 0n);
  assert.equal(r.nothingRevoked, true);
  assert.equal(r.endsNaturallyDuringNotice, false);
  assert.equal(r.totalPaidAfterNotice, 250000000n);
});

test('notice that consumes the ceiling partial remainder ends with a partial pull, its fee floored on the partial amount', () => {
  const r = modelSubscriptionCancellation({ amount: '25', decimals: 6, periods: 12, allowanceCap: '260', serviceFeeBps: 250, periodsElapsed: 4, noticePeriods: 7 });
  assert.equal(r.remainingTotal, 160000000n);
  assert.equal(r.noticePulled, 160000000n);
  assert.equal(r.noticeFullPulls, 6n);
  assert.equal(r.noticePartialAmount, 10000000n);
  assert.equal(r.noticePullCount, 7n);
  assert.equal(r.noticeEndsWithPartial, true);
  assert.equal(r.noticeFees, 4000000n);
  assert.equal(r.endsNaturallyDuringNotice, true);
  assert.equal(r.revoked, 0n);
});

test('a partial remainder can also be the revoked amount when notice stops before it', () => {
  const r = modelSubscriptionCancellation({ amount: '25', decimals: 6, periods: 12, allowanceCap: '260', serviceFeeBps: 250, periodsElapsed: 4, noticePeriods: 6 });
  assert.equal(r.noticePulled, 150000000n);
  assert.equal(r.revoked, 10000000n);
  assert.equal(r.revokedFullPulls, 0n);
  assert.equal(r.revokedPartialAmount, 10000000n);
  assert.equal(r.revokedPullCount, 1n);
  assert.equal(r.feesNeverCharged, 250000n);
  assert.equal(r.merchantNeverReceives, 9750000n);
});

test('shares are derived from the amounts, not the pull counts', () => {
  const r = modelSubscriptionCancellation({ amount: '25', decimals: 6, periods: 12, allowanceCap: '260', serviceFeeBps: 250, periodsElapsed: 4, noticePeriods: 7 });
  // 7 of 11 pulls happen during notice, which as a pull-count ratio would state 6363.63; the amount share is 6153.84.
  assert.equal(r.noticeShareBpsText, '6153.84');
  const s = modelSubscriptionCancellation({ amount: '7', decimals: 6, periods: 7, allowanceCap: '49', serviceFeeBps: 333, periodsElapsed: 3, noticePeriods: 2 });
  assert.equal(s.paidAfterNoticeShareBpsText, '7142.85');
  assert.equal(s.noticeFees, 466200n);
  assert.equal(s.feesNeverCharged, 466200n);
});

test('already-pulled amounts are never refunded by cancelling: paid stays paid at every notice length', () => {
  for (const noticePeriods of [0, 1, 2, 6, 10]) {
    const r = modelSubscriptionCancellation({ ...DEFAULT, noticePeriods });
    assert.equal(r.paidSoFar, 100000000n);
    assert.equal(r.feesPaidSoFar, 2500000n);
    assert.equal(r.merchantReceivedSoFar, 97500000n);
    assert.ok(r.totalPaidAfterNotice >= r.paidSoFar);
  }
});

test('with no service fee, the merchant would have received the whole revoked amount', () => {
  const r = modelSubscriptionCancellation({ ...DEFAULT, serviceFeeBps: 0 });
  assert.equal(r.noFee, true);
  assert.equal(r.noticeFees, 0n);
  assert.equal(r.noticeMerchant, r.noticePulled);
  assert.equal(r.feesNeverCharged, 0n);
  assert.equal(r.merchantNeverReceives, r.revoked);
});

test('a stated fee flooring to zero at decimals 0 charges nothing during notice and revokes no fee', () => {
  const r = modelSubscriptionCancellation({ amount: '10', decimals: 0, periods: 5, serviceFeeBps: 1, periodsElapsed: 1, noticePeriods: 1 });
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.noticePulled, 10n);
  assert.equal(r.noticeFees, 0n);
  assert.equal(r.revoked, 30n);
  assert.equal(r.feesNeverCharged, 0n);
  assert.equal(r.merchantNeverReceives, 30n);
});

test('notice pulls are charged the same per-pull fee as any other pull, never a cancellation surcharge', () => {
  const a = modelSubscriptionCancellation({ ...DEFAULT, noticePeriods: 2 });
  const b = modelSubscriptionCancellation({ ...DEFAULT, noticePeriods: 4 });
  assert.equal(a.noticeFees * 2n, b.noticeFees);
  assert.equal(b.noticePulled, 100000000n);
  assert.equal(b.revoked, 50000000n);
});

test('the pull model refusals propagate: an impossible history and a whole-pull fee are refused here too', () => {
  assert.throws(() => modelSubscriptionCancellation({ ...DEFAULT, allowanceCap: '90' }), /Periods already pulled exceed the effective authorised total/);
  assert.throws(() => modelSubscriptionCancellation({ ...DEFAULT, serviceFeeBps: 10000 }), /Service fee must not take the whole subscription pull\./);
  assert.throws(() => modelSubscriptionCancellation({ ...DEFAULT, periodsElapsed: 13 }), /Periods already pulled must be a whole number from 0 up to the authorised periods\./);
});

test('invalid notice periods are refused', () => {
  assert.throws(() => modelSubscriptionCancellation({ ...DEFAULT, noticePeriods: -1 }), /Notice periods must be a whole number between 0 and 120\./);
  assert.throws(() => modelSubscriptionCancellation({ ...DEFAULT, noticePeriods: 121 }), /Notice periods must be a whole number between 0 and 120\./);
  assert.throws(() => modelSubscriptionCancellation({ ...DEFAULT, noticePeriods: 1.5 }), /Notice periods must be a whole number between 0 and 120\./);
});

test('wiring: app.js imports the model, renders a cancellation panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelSubscriptionCancellation/);
  assert.match(app, /data-subcancel/);
  assert.match(app, /subcancel-output/);
  assert.match(app, /v1\.264/);
  assert.match(readme, /Subscription cancellation model/);
});

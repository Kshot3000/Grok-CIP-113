import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelPaymentStreamCancellation } from '../src/domain.js';

// Payment stream cancellation model (v1.239): cancelling a stream
// at a stated elapsed point. What has streamed stays with the
// recipient, net of the fee already floored on it — cancelling is
// not a clawback. What has not streamed returns to the sender
// whole. Cancellation charges no fee of its own, and no fee is
// charged on the returned amount; the fee it would have carried is
// stated as never charged. Shares are derived from the amounts.
const DEFAULT = { totalAmount: '12000', decimals: 6, durationPeriods: 12, elapsedPeriods: 5, platformFeeBps: 250 };

test('the preloaded cancellation: cancelling after 5 of 12 periods — the recipient keeps 4875 of the 5000 streamed, the 125 fee on it is kept, and 7000 returns to the sender', () => {
  const r = modelPaymentStreamCancellation(DEFAULT);
  assert.equal(r.streamed, 5000000000n);
  assert.equal(r.recipientKeeps, 4875000000n);
  assert.equal(r.platformFeeKept, 125000000n);
  assert.equal(r.returnedToSender, 7000000000n);
  assert.equal(r.periodsRemaining, 7);
  assert.equal(r.returnedShareBpsText, '5833.33');
  assert.equal(r.recipientKeepsShareBpsText, '4062.50');
});

test('identities hold across terms: recipient keeps plus fee kept plus returned is the deposit, and elapsed plus remaining is the duration', () => {
  const cases = [
    DEFAULT,
    { totalAmount: '777', decimals: 6, durationPeriods: 11, elapsedPeriods: 7, platformFeeBps: 333 },
    { totalAmount: '9', decimals: 0, durationPeriods: 3, elapsedPeriods: 2, platformFeeBps: 500 },
    { totalAmount: '1000', decimals: 2, durationPeriods: 100, elapsedPeriods: 99, platformFeeBps: 1 },
  ];
  for (const c of cases) {
    const r = modelPaymentStreamCancellation(c);
    assert.equal(r.recipientKeeps + r.platformFeeKept + r.returnedToSender, r.totalAmount);
    assert.equal(r.elapsedPeriods + r.periodsRemaining, r.durationPeriods);
  }
});

test('cancelling before the first period returns the whole deposit: the recipient keeps nothing and no fee is kept', () => {
  const r = modelPaymentStreamCancellation({ ...DEFAULT, elapsedPeriods: 0 });
  assert.equal(r.cancelsBeforeStart, true);
  assert.equal(r.recipientKeeps, 0n);
  assert.equal(r.platformFeeKept, 0n);
  assert.equal(r.returnedToSender, r.totalAmount);
  assert.equal(r.returnedShareBpsText, '10000.00');
  assert.equal(r.periodsRemaining, 12);
});

test('cancelling at the full duration is moot: the stream already completed, nothing returns, and the recipient keeps the whole streamed amount net of its fee', () => {
  const r = modelPaymentStreamCancellation({ ...DEFAULT, elapsedPeriods: 12 });
  assert.equal(r.alreadyComplete, true);
  assert.equal(r.returnedToSender, 0n);
  assert.equal(r.feeNeverCharged, 0n);
  assert.equal(r.recipientKeeps, 11700000000n);
  assert.equal(r.platformFeeKept, 300000000n);
  assert.equal(r.periodsRemaining, 0);
});

test('cancellation charges no fee of its own: the only fee in the outcome is the 125 already floored on what streamed, and the fee the returned 7000 would have carried — 175 — is stated as never charged', () => {
  const r = modelPaymentStreamCancellation(DEFAULT);
  assert.equal(r.noCancellationFee, true);
  assert.equal(r.platformFeeKept, 125000000n);
  assert.equal(r.feeNeverCharged, 175000000n);
  assert.equal(r.feeNeverChargedShareBpsText, '250.00');
});

test('shares are derived from the amounts: on the 777-over-11 case cancelled at 7 elapsed the recipient keeps share is 6151.72 and the fee never charged is 9408763 base units', () => {
  const r = modelPaymentStreamCancellation({ totalAmount: '777', decimals: 6, durationPeriods: 11, elapsedPeriods: 7, platformFeeBps: 333 });
  assert.equal(r.recipientKeeps, 477989209n);
  assert.equal(r.platformFeeKept, 16465336n);
  assert.equal(r.returnedToSender, 282545455n);
  assert.equal(r.feeNeverCharged, 9408763n);
  assert.equal(r.recipientKeepsShareBpsText, '6151.72');
  assert.equal(r.returnedShareBpsText, '3636.36');
  assert.equal(r.feeKeptShareBpsText, '332.99');
  assert.equal(r.feeNeverChargedShareBpsText, '332.99');
});

test('elapsed time alone keeps nothing: cancelling 10 units over 100 periods after 1 period returns the whole 10, because the elapsed share floors below one base unit', () => {
  const r = modelPaymentStreamCancellation({ totalAmount: '10', decimals: 0, durationPeriods: 100, elapsedPeriods: 1, platformFeeBps: 250 });
  assert.equal(r.streamedZeroAtCancel, true);
  assert.equal(r.recipientKeeps, 0n);
  assert.equal(r.returnedToSender, 10n);
  assert.equal(r.periodsRemaining, 99);
});

test('a fee taking the whole streamed amount is still refused at cancellation, through the base model', () => {
  assert.throws(() => modelPaymentStreamCancellation({ ...DEFAULT, platformFeeBps: 10000 }), /must not take the whole streamed amount/);
});

test('with no platform fee the recipient keeps the whole streamed amount and the sender is returned the rest, with nothing kept or never-charged as a fee', () => {
  const r = modelPaymentStreamCancellation({ ...DEFAULT, platformFeeBps: 0 });
  assert.equal(r.noFee, true);
  assert.equal(r.platformFeeKept, 0n);
  assert.equal(r.feeNeverCharged, 0n);
  assert.equal(r.recipientKeeps, r.streamed);
  assert.equal(r.recipientKeeps + r.returnedToSender, r.totalAmount);
});

test('a stated fee that floors to zero on the streamed amount keeps no fee at cancellation either', () => {
  const r = modelPaymentStreamCancellation({ totalAmount: '0.001', decimals: 6, durationPeriods: 1, elapsedPeriods: 1, platformFeeBps: 1 });
  assert.equal(r.platformFeeKept, 0n);
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.alreadyComplete, true);
});

test('cancelling one period before the end returns only the final period share: 1000 of a 1000-unit stream over 100 periods at 99 elapsed, in base units', () => {
  const r = modelPaymentStreamCancellation({ totalAmount: '1000', decimals: 2, durationPeriods: 100, elapsedPeriods: 99, platformFeeBps: 1 });
  assert.equal(r.returnedToSender, 1000n);
  assert.equal(r.recipientKeeps, 98991n);
  assert.equal(r.platformFeeKept, 9n);
  assert.equal(r.feeNeverCharged, 0n);
  assert.equal(r.returnedShareBpsText, '100.00');
});

test('amounts beyond float precision stay exact: half of 2^53+1 has streamed and is kept, and one base unit more than half returns', () => {
  const r = modelPaymentStreamCancellation({ totalAmount: '9007199254740993', decimals: 0, durationPeriods: 2, elapsedPeriods: 1, platformFeeBps: 0 });
  assert.equal(r.recipientKeeps, 4503599627370496n);
  assert.equal(r.returnedToSender, 4503599627370497n);
  assert.equal(r.recipientKeepsShareBpsText, '4999.99');
  assert.equal(r.returnedShareBpsText, '5000.00');
});

test('validation is the base model validation: a non-positive total, out-of-range duration, elapsed beyond the duration, and an out-of-range fee are refused', () => {
  assert.throws(() => modelPaymentStreamCancellation({ ...DEFAULT, totalAmount: '0' }), /Stream total must be greater than zero/);
  assert.throws(() => modelPaymentStreamCancellation({ ...DEFAULT, durationPeriods: 0 }), /between 1 and 1,000/);
  assert.throws(() => modelPaymentStreamCancellation({ ...DEFAULT, elapsedPeriods: 13 }), /between 0 and the stream duration/);
  assert.throws(() => modelPaymentStreamCancellation({ ...DEFAULT, platformFeeBps: 10001 }), /between 0 and 10,000/);
});

test('the total is validated as an amount through the base model: commas and exponents are refused', () => {
  assert.throws(() => modelPaymentStreamCancellation({ ...DEFAULT, totalAmount: '1,000' }), /without commas or exponents/);
  assert.throws(() => modelPaymentStreamCancellation({ ...DEFAULT, totalAmount: '1e3' }), /without commas or exponents/);
});

test('defaults: an unstated elapsed cancels before the start and returns the whole deposit', () => {
  const { elapsedPeriods, platformFeeBps, ...rest } = DEFAULT;
  const r = modelPaymentStreamCancellation(rest);
  assert.equal(r.elapsedPeriods, 0);
  assert.equal(r.cancelsBeforeStart, true);
  assert.equal(r.returnedToSender, r.totalAmount);
});

test('the returned amount never exceeds what has not streamed: across every cancellation point of the 777-over-11 stream, keeps plus kept fee plus returned is the deposit and returned falls monotonically', () => {
  let prev = 777000001n;
  for (let e = 0; e <= 11; e++) {
    const r = modelPaymentStreamCancellation({ totalAmount: '777', decimals: 6, durationPeriods: 11, elapsedPeriods: e, platformFeeBps: 333 });
    assert.equal(r.recipientKeeps + r.platformFeeKept + r.returnedToSender, 777000000n);
    assert.ok(r.returnedToSender < prev);
    prev = r.returnedToSender;
  }
  assert.equal(prev, 0n);
});

test('cancelling is not a clawback: at every cancellation point the recipient keeps exactly what the stream model states as withdrawable at that point, never less', () => {
  for (let e = 0; e <= 12; e++) {
    const r = modelPaymentStreamCancellation({ ...DEFAULT, elapsedPeriods: e });
    assert.equal(r.recipientKeeps + r.platformFeeKept, r.streamed);
    assert.ok(r.recipientKeeps >= 0n);
  }
});

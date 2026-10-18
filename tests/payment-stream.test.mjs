import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelPaymentStream } from '../src/domain.js';

// Payment stream model (v1.254): a deposit streams linearly to a
// recipient over a stated number of periods. The streamed amount is
// floor(total x elapsed / duration) — never rounded up, because that
// would make more withdrawable than the elapsed share. The platform
// fee is floored on the STREAMED amount, never on the whole deposit.
// Shares are derived from the amounts, never the elapsed ratio.
const DEFAULT = { totalAmount: '12000', decimals: 6, durationPeriods: 12, elapsedPeriods: 5, platformFeeBps: 250 };

test('the preloaded stream: 12000 over 12 periods, 5 elapsed — 5000 has streamed, 125 is the fee on it, the recipient can withdraw 4875, and 7000 has not streamed', () => {
  const r = modelPaymentStream(DEFAULT);
  assert.equal(r.streamed, 5000000000n);
  assert.equal(r.unstreamed, 7000000000n);
  assert.equal(r.platformFee, 125000000n);
  assert.equal(r.recipientNet, 4875000000n);
  assert.equal(r.streamedShareBpsText, '4166.66');
  assert.equal(r.unstreamedShareBpsText, '5833.33');
});

test('identities hold across terms: streamed plus unstreamed is the deposit, and fee plus recipient net is the streamed amount', () => {
  const cases = [
    DEFAULT,
    { totalAmount: '777', decimals: 6, durationPeriods: 11, elapsedPeriods: 7, platformFeeBps: 333 },
    { totalAmount: '9', decimals: 0, durationPeriods: 3, elapsedPeriods: 2, platformFeeBps: 500 },
    { totalAmount: '1000', decimals: 2, durationPeriods: 100, elapsedPeriods: 99, platformFeeBps: 1 },
  ];
  for (const c of cases) {
    const r = modelPaymentStream(c);
    assert.equal(r.streamed + r.unstreamed, r.totalAmount);
    assert.equal(r.platformFee + r.recipientNet, r.streamed);
  }
});

test('at zero elapsed nothing has streamed: nothing is withdrawable, no fee is charged, and the whole deposit is unstreamed', () => {
  const r = modelPaymentStream({ ...DEFAULT, elapsedPeriods: 0 });
  assert.equal(r.notStarted, true);
  assert.equal(r.streamed, 0n);
  assert.equal(r.platformFee, 0n);
  assert.equal(r.recipientNet, 0n);
  assert.equal(r.unstreamed, r.totalAmount);
});

test('at the full duration the whole deposit has streamed exactly, with no flooring loss', () => {
  const r = modelPaymentStream({ ...DEFAULT, elapsedPeriods: 12 });
  assert.equal(r.fullyStreamed, true);
  assert.equal(r.streamed, r.totalAmount);
  assert.equal(r.unstreamed, 0n);
  assert.equal(r.streamFloors, false);
  assert.equal(r.streamedShareBpsText, '10000.00');
});

test('the fee is floored on the streamed amount, not the deposit: on the preload it is 125, not the 300 a fee on the whole 12000 would take', () => {
  const r = modelPaymentStream(DEFAULT);
  assert.equal(r.platformFee, 125000000n);
  assert.equal(r.feeShareBpsText, '250.00');
  assert.equal(r.recipientShareBpsText, '9750.00');
});

test('shares are derived from the amounts: on the 777-over-11 case at 7 elapsed the streamed share is 6363.63, where the 7-of-11 period ratio would state 6363.64', () => {
  const r = modelPaymentStream({ totalAmount: '777', decimals: 6, durationPeriods: 11, elapsedPeriods: 7, platformFeeBps: 333 });
  assert.equal(r.streamed, 494454545n);
  assert.equal(r.unstreamed, 282545455n);
  assert.equal(r.platformFee, 16465336n);
  assert.equal(r.recipientNet, 477989209n);
  assert.equal(r.streamedShareBpsText, '6363.63');
  assert.equal(r.feeShareBpsText, '332.99');
  assert.equal(r.recipientShareBpsText, '9667.00');
  assert.equal(r.streamFloors, true);
});

test('elapsed time alone does not create a withdrawable amount: 10 units over 100 periods has streamed nothing after 1 period', () => {
  const r = modelPaymentStream({ totalAmount: '10', decimals: 0, durationPeriods: 100, elapsedPeriods: 1, platformFeeBps: 250 });
  assert.equal(r.streamed, 0n);
  assert.equal(r.streamedZero, true);
  assert.equal(r.recipientNet, 0n);
  assert.equal(r.unstreamed, 10n);
});

test('a fee taking the whole streamed amount is refused', () => {
  assert.throws(() => modelPaymentStream({ ...DEFAULT, platformFeeBps: 10000 }), /must not take the whole streamed amount/);
});

test('a whole-stream fee before anything has streamed is not refused: nothing has streamed to take a fee from', () => {
  const r = modelPaymentStream({ ...DEFAULT, elapsedPeriods: 0, platformFeeBps: 10000 });
  assert.equal(r.streamed, 0n);
  assert.equal(r.platformFee, 0n);
});

test('with no platform fee the recipient receives the whole streamed amount', () => {
  const r = modelPaymentStream({ ...DEFAULT, platformFeeBps: 0 });
  assert.equal(r.noFee, true);
  assert.equal(r.platformFee, 0n);
  assert.equal(r.recipientNet, r.streamed);
});

test('a stated fee that floors to zero on a small streamed amount is flagged, never presented as taken', () => {
  const r = modelPaymentStream({ totalAmount: '0.001', decimals: 6, durationPeriods: 1, elapsedPeriods: 1, platformFeeBps: 1 });
  assert.equal(r.streamed, 1000n);
  assert.equal(r.platformFee, 0n);
  assert.equal(r.feeFloorsToZero, true);
});

test('a one-period stream streams nothing until its single period elapses, then everything', () => {
  const before = modelPaymentStream({ totalAmount: '50', decimals: 6, durationPeriods: 1, elapsedPeriods: 0, platformFeeBps: 250 });
  assert.equal(before.streamed, 0n);
  const after = modelPaymentStream({ totalAmount: '50', decimals: 6, durationPeriods: 1, elapsedPeriods: 1, platformFeeBps: 250 });
  assert.equal(after.streamed, 50000000n);
  assert.equal(after.fullyStreamed, true);
});

test('amounts beyond float precision stay exact: half of 2^53+1 streamed over 2 periods is 4503599627370496, and the unstreamed remainder is one unit more', () => {
  const r = modelPaymentStream({ totalAmount: '9007199254740993', decimals: 0, durationPeriods: 2, elapsedPeriods: 1, platformFeeBps: 0 });
  assert.equal(r.streamed, 4503599627370496n);
  assert.equal(r.unstreamed, 4503599627370497n);
  assert.equal(r.streamedShareBpsText, '4999.99');
});

test('validation: a non-positive total, out-of-range duration, elapsed beyond the duration, and an out-of-range fee are refused', () => {
  assert.throws(() => modelPaymentStream({ ...DEFAULT, totalAmount: '0' }), /Stream total must be greater than zero/);
  assert.throws(() => modelPaymentStream({ ...DEFAULT, durationPeriods: 0 }), /between 1 and 1,000/);
  assert.throws(() => modelPaymentStream({ ...DEFAULT, durationPeriods: 1001 }), /between 1 and 1,000/);
  assert.throws(() => modelPaymentStream({ ...DEFAULT, elapsedPeriods: 13 }), /between 0 and the stream duration/);
  assert.throws(() => modelPaymentStream({ ...DEFAULT, elapsedPeriods: -1 }), /between 0 and the stream duration/);
  assert.throws(() => modelPaymentStream({ ...DEFAULT, platformFeeBps: 10001 }), /between 0 and 10,000/);
});

test('the total is validated as an amount: commas, exponents, and too many decimal places are refused', () => {
  assert.throws(() => modelPaymentStream({ ...DEFAULT, totalAmount: '1,000' }), /without commas or exponents/);
  assert.throws(() => modelPaymentStream({ ...DEFAULT, totalAmount: '1e3' }), /without commas or exponents/);
  assert.throws(() => modelPaymentStream({ ...DEFAULT, totalAmount: '0.0000001' }), /at most 6 decimal places/);
});

test('defaults: an unstated elapsed is zero and an unstated fee is 250 basis points', () => {
  const { elapsedPeriods, platformFeeBps, ...rest } = DEFAULT;
  const r = modelPaymentStream(rest);
  assert.equal(r.elapsedPeriods, 0);
  assert.equal(r.platformFeeBps, 250);
  assert.equal(r.streamed, 0n);
});

test('the streamed amount never exceeds the elapsed share: across every elapsed point of the 777-over-11 stream, streamed x duration is at most total x elapsed and one period later it is more', () => {
  let prev = -1n;
  for (let e = 0; e <= 11; e++) {
    const r = modelPaymentStream({ totalAmount: '777', decimals: 6, durationPeriods: 11, elapsedPeriods: e, platformFeeBps: 333 });
    assert.ok(r.streamed * 11n <= 777000000n * BigInt(e));
    assert.ok(r.streamed > prev);
    prev = r.streamed;
  }
  assert.equal(prev, 777000000n);
});

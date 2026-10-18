import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCreditDefaultSwapSettlement } from '../src/domain.js';

const DEFAULT = { notionalAmount: '1000000', recoveryRateBps: 2000, premiumBps: 100, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, recoveryRateBps: 0 },
  { ...DEFAULT, recoveryRateBps: 10000 },
  { ...DEFAULT, premiumBps: 0 },
  { ...DEFAULT, recoveryRateBps: 5000, premiumBps: 250 },
  { notionalAmount: '333333.333333', recoveryRateBps: 111, premiumBps: 37, decimals: 6 },
  { notionalAmount: '1', recoveryRateBps: 1, premiumBps: 1, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { notionalAmount: '2', recoveryRateBps: 10000, premiumBps: 10000, decimals: 6 },
  { ...DEFAULT, premiumBps: 9999 },
];

test('preload: a notional of 1000000 recovering 2000 bps on a stated credit event states a recovery value of 200000, a protection payment of 800000, and a premium of 10000 at 100 bps', () => {
  const r = modelCreditDefaultSwapSettlement(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.notionalAmount, 1000000000000n);
  assert.equal(r.recoveryRateBps, 2000);
  assert.equal(r.premiumBps, 100);
  assert.equal(r.recoveryValue, 200000000000n);
  assert.equal(r.protectionPayment, 800000000000n);
  assert.equal(r.premiumAmount, 10000000000n);
});

test('the protection payment is measured on the loss actually stated, never on the whole notional where any value is recovered', () => {
  const r = modelCreditDefaultSwapSettlement(DEFAULT);
  assert.equal(r.paymentOnLossOnly, true);
  assert.notEqual(r.protectionPayment, 1000000000000n);
  assert.equal(r.protectionPayment, r.notionalAmount - r.recoveryValue);
});

test('the protection payment plus the recovery value is the notional exactly, on every stated case: the buyer is made whole once, never twice', () => {
  for (const input of CASES) {
    const r = modelCreditDefaultSwapSettlement(input);
    assert.equal(r.protectionPayment + r.recoveryValue, r.notionalAmount);
    assert.equal(r.noDoubleRecovery, true);
  }
});

test('the premium is measured on the whole notional actually protected and is stated gross, never netted against the protection payment', () => {
  const r = modelCreditDefaultSwapSettlement(DEFAULT);
  assert.equal(r.premiumNotNetted, true);
  assert.equal(r.premiumAmount, r.notionalAmount * 100n / 10000n);
  assert.notEqual(r.protectionPayment, r.notionalAmount - r.recoveryValue - r.premiumAmount);
});

test('the notional is not exchanged: it is the amount protected, paid by neither party under the swap', () => {
  const r = modelCreditDefaultSwapSettlement(DEFAULT);
  assert.equal(r.notionalNotExchanged, true);
});

test('neither the protection payment nor the premium is a fee, and the credit event, physical settlement, later periods, term, and seller default are not priced', () => {
  const r = modelCreditDefaultSwapSettlement(DEFAULT);
  assert.equal(r.paymentIsFee, false);
  assert.equal(r.premiumIsFee, false);
  assert.equal(r.creditEventPriced, false);
  assert.equal(r.physicalSettlementPriced, false);
  assert.equal(r.laterPeriodsPriced, false);
  assert.equal(r.termPriced, false);
  assert.equal(r.sellerDefaultPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a recovery of zero is stated, not refused: nothing is recovered, so the protection payment is the whole notional', () => {
  const r = modelCreditDefaultSwapSettlement({ ...DEFAULT, recoveryRateBps: 0 });
  assert.equal(r.recoveryValue, 0n);
  assert.equal(r.protectionPayment, 1000000000000n);
});

test('a full recovery is stated, not refused: the obligation keeps its whole value, so no loss stands and the protection payment is zero', () => {
  const r = modelCreditDefaultSwapSettlement({ ...DEFAULT, recoveryRateBps: 10000 });
  assert.equal(r.recoveryValue, 1000000000000n);
  assert.equal(r.protectionPayment, 0n);
});

test('a premium of zero is stated, not refused: protection for the period is stated at no premium and the payment stands whole', () => {
  const r = modelCreditDefaultSwapSettlement({ ...DEFAULT, premiumBps: 0 });
  assert.equal(r.premiumAmount, 0n);
  assert.equal(r.protectionPayment, 800000000000n);
});

test('flooring is exact on a fractional notional: the recovery value and the premium floor and the conservation stays exact', () => {
  const r = modelCreditDefaultSwapSettlement({ notionalAmount: '333333.333333', recoveryRateBps: 111, premiumBps: 37, decimals: 6 });
  assert.equal(r.recoveryValue, 3699999999n);
  assert.equal(r.protectionPayment, 329633333334n);
  assert.equal(r.premiumAmount, 1233333333n);
});

test('on a tiny notional stated rates can floor the recovery value and the premium, and that is stated, not hidden', () => {
  const r = modelCreditDefaultSwapSettlement({ notionalAmount: '1', recoveryRateBps: 1, premiumBps: 1, decimals: 6 });
  assert.equal(r.recoveryValue, 100n);
  assert.equal(r.protectionPayment, 999900n);
  assert.equal(r.premiumAmount, 100n);
});

test('a recovery rate and a premium of 10000 basis points are each stated', () => {
  const r = modelCreditDefaultSwapSettlement({ notionalAmount: '2', recoveryRateBps: 10000, premiumBps: 10000, decimals: 6 });
  assert.equal(r.recoveryValue, 2000000n);
  assert.equal(r.protectionPayment, 0n);
  assert.equal(r.premiumAmount, 2000000n);
});

test('a notional of zero is refused', () => {
  assert.throws(() => modelCreditDefaultSwapSettlement({ ...DEFAULT, notionalAmount: '0' }), /Notional amount must be greater than zero/);
});

test('a recovery rate above 10000 basis points or not a whole number is refused', () => {
  assert.throws(() => modelCreditDefaultSwapSettlement({ ...DEFAULT, recoveryRateBps: 10001 }), /Recovery rate must be a whole number of basis points/);
  assert.throws(() => modelCreditDefaultSwapSettlement({ ...DEFAULT, recoveryRateBps: 100.5 }), /Recovery rate must be a whole number of basis points/);
});

test('a premium above 10000 basis points or not a whole number is refused', () => {
  assert.throws(() => modelCreditDefaultSwapSettlement({ ...DEFAULT, premiumBps: 10001 }), /Premium must be a whole number of basis points/);
  assert.throws(() => modelCreditDefaultSwapSettlement({ ...DEFAULT, premiumBps: 100.5 }), /Premium must be a whole number of basis points/);
});

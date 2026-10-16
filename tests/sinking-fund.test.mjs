import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelSinkingFund } from '../src/domain.js';

// Sinking fund model (v1.221): a NEW axis — money set aside
// in stated deposits until a stated target is reached. No
// yield is priced (the deposits alone sum to the target
// exactly), the regular deposit is floored, and the final
// deposit absorbs the flooring remainder so the fund reaches
// its target exactly — never short, never over-collected.
const DEFAULT = { targetAmount: '10000', periods: 7, decimals: 6 };

test('the preloaded fund: 10000 over 7 deposits — six deposits of 1428.571428 and a final 1428.571432 reach the target exactly', () => {
  const r = modelSinkingFund(DEFAULT);
  assert.equal(r.regularDeposit, 1428571428n);
  assert.equal(r.finalDeposit, 1428571432n);
  assert.equal(r.depositsBeforeFinal, 8571428568n);
  assert.equal(r.totalDeposits, 10000000000n);
});

test('identities hold across funds: regular times (periods - 1) plus final is the target, and deposits before final plus final is the target', () => {
  const cases = [
    DEFAULT,
    { targetAmount: '12000', periods: 12, decimals: 6 },
    { targetAmount: '5000', periods: 1, decimals: 6 },
    { targetAmount: '777', periods: 11, decimals: 0 },
    { targetAmount: '9007199254740993', periods: 2, decimals: 0 },
    { targetAmount: '0.000005', periods: 7, decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelSinkingFund(c);
    assert.equal(r.regularDeposit * BigInt(r.periods - 1) + r.finalDeposit, r.targetAmount);
    assert.equal(r.depositsBeforeFinal + r.finalDeposit, r.targetAmount);
    assert.equal(r.totalDeposits, r.targetAmount);
  }
});

test('flooring every deposit and dropping the remainder would leave the fund short: 7 regular deposits on the preload fall 4 base units short of the target', () => {
  const r = modelSinkingFund(DEFAULT);
  assert.equal(r.regularDeposit * 7n, 9999999996n);
  assert.ok(r.regularDeposit * 7n < r.targetAmount);
  assert.equal(r.targetAmount - r.regularDeposit * 7n, 4n);
});

test('no yield is priced: the deposits alone are the whole fund — total deposits equal the target, never the target plus invented earnings', () => {
  for (const c of [DEFAULT, { targetAmount: '777', periods: 11, decimals: 0 }]) {
    const r = modelSinkingFund(c);
    assert.equal(r.yieldPriced, false);
    assert.equal(r.totalDeposits, r.targetAmount);
  }
});

test('the final deposit absorbs exactly the flooring remainder: on the preload it exceeds the regular deposit by exactly 4 base units', () => {
  const r = modelSinkingFund(DEFAULT);
  assert.equal(r.finalAbsorbsRemainder, true);
  assert.equal(r.finalDeposit - r.regularDeposit, 4n);
});

test('a target that divides exactly has equal deposits: 12000 over 12 is 1000 every period, the final included, with nothing left over', () => {
  const r = modelSinkingFund({ targetAmount: '12000', periods: 12, decimals: 6 });
  assert.equal(r.equalDeposits, true);
  assert.equal(r.finalAbsorbsRemainder, false);
  assert.equal(r.regularDeposit, 1000000000n);
  assert.equal(r.finalDeposit, 1000000000n);
});

test('a single deposit is its own outcome: the deposit is the target whole and nothing comes before the final deposit', () => {
  const r = modelSinkingFund({ targetAmount: '5000', periods: 1, decimals: 6 });
  assert.equal(r.singlePeriod, true);
  assert.equal(r.regularDeposit, 5000000000n);
  assert.equal(r.finalDeposit, 5000000000n);
  assert.equal(r.depositsBeforeFinal, 0n);
});

test('a target below one base unit per deposit floors the regular deposit to zero: on a 5-base-unit target over 7, every deposit but the final is nothing and the final is the whole target', () => {
  const r = modelSinkingFund({ targetAmount: '0.000005', periods: 7, decimals: 6 });
  assert.equal(r.regularDepositZero, true);
  assert.equal(r.regularDeposit, 0n);
  assert.equal(r.finalDeposit, 5n);
  assert.equal(r.finalShareBpsText, '10000.00');
});

test('shares are derived from the amounts against the target: on the preload both deposits state a 1428.57 share of the 10000 target', () => {
  const r = modelSinkingFund(DEFAULT);
  assert.equal(r.regularShareBpsText, '1428.57');
  assert.equal(r.finalShareBpsText, '1428.57');
});

test('on the no-decimals 777 case over 11 deposits, the regular deposit is 70, the final 77, with shares 900.90 and 990.99 of the target', () => {
  const r = modelSinkingFund({ targetAmount: '777', periods: 11, decimals: 0 });
  assert.equal(r.regularDeposit, 70n);
  assert.equal(r.finalDeposit, 77n);
  assert.equal(r.depositsBeforeFinal, 700n);
  assert.equal(r.regularShareBpsText, '900.90');
  assert.equal(r.finalShareBpsText, '990.99');
});

test('amounts beyond float precision stay exact: a 2^53+1 target over 2 deposits splits 4503599627370496 and 4503599627370497', () => {
  const r = modelSinkingFund({ targetAmount: '9007199254740993', periods: 2, decimals: 0 });
  assert.equal(r.regularDeposit, 4503599627370496n);
  assert.equal(r.finalDeposit, 4503599627370497n);
  assert.equal(r.regularShareBpsText, '4999.99');
  assert.equal(r.finalShareBpsText, '5000.00');
});

test('a zero target is refused — a fund with no target has no schedule', () => {
  assert.throws(() => modelSinkingFund({ targetAmount: '0', periods: 7 }), /Target amount must be greater than zero/);
});

test('a negative target is refused at parsing — amounts are positive decimals', () => {
  assert.throws(() => modelSinkingFund({ targetAmount: '-5', periods: 7, decimals: 6 }), /positive decimal amount/);
});

test('zero deposits are refused — a fund cannot be built in no periods', () => {
  assert.throws(() => modelSinkingFund({ targetAmount: '100', periods: 0 }), /whole number, one or more/);
});

test('a fractional deposit count is refused — deposits are made whole or not at all', () => {
  assert.throws(() => modelSinkingFund({ targetAmount: '100', periods: 2.5 }), /whole number, one or more/);
});

test('the default schedule is 12 deposits when none is stated: 10000 over 12 deposits 833.333333 regularly and 833.333337 finally', () => {
  const r = modelSinkingFund({ targetAmount: '10000', decimals: 6 });
  assert.equal(r.periods, 12);
  assert.equal(r.regularDeposit, 833333333n);
  assert.equal(r.finalDeposit, 833333337n);
});

test('the final deposit is never smaller than the regular one, and deposits before the final are exactly the regular deposits counted', () => {
  const cases = [
    DEFAULT,
    { targetAmount: '12000', periods: 12, decimals: 6 },
    { targetAmount: '777', periods: 11, decimals: 0 },
    { targetAmount: '0.000005', periods: 7, decimals: 6 },
    { targetAmount: '9007199254740993', periods: 2, decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelSinkingFund(c);
    assert.ok(r.finalDeposit >= r.regularDeposit);
    assert.equal(r.depositsBeforeFinal, r.regularDeposit * BigInt(r.periods - 1));
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelSinkingFund, modelSinkingFundProgress } from '../src/domain.js';

// Sinking fund progress model (v1.236): the sinking-fund
// axis's second moment — the position part way through a
// stated fund. Deposited-so-far is counted at the schedule's
// own amounts, the deposits still to come sum to the amount
// still to save exactly (on schedule, no catch-up invented),
// no yield is credited while the fund waits, and a fund with
// every deposit made is complete — finished, not waived.
const DEFAULT = { targetAmount: '10000', periods: 7, decimals: 6, depositsMade: 3 };

test('the preloaded position: 3 of 7 deposits made toward the 10000 target — 4285.714284 deposited, 5714.285716 still to save, next deposit 1428.571428', () => {
  const r = modelSinkingFundProgress(DEFAULT);
  assert.equal(r.depositedSoFar, 4285714284n);
  assert.equal(r.stillToSave, 5714285716n);
  assert.equal(r.depositsRemaining, 4);
  assert.equal(r.remainingScheduleTotal, 5714285716n);
  assert.equal(r.nextDeposit, 1428571428n);
});

test('the default position is 3 deposits made when none is stated', () => {
  const r = modelSinkingFundProgress({ targetAmount: '10000', periods: 7, decimals: 6 });
  assert.equal(r.depositsMade, 3);
  assert.equal(r.depositedSoFar, 4285714284n);
});

test('identities hold across funds: deposited plus still to save is the target, the remaining schedule is the amount still to save, and made plus remaining is the deposit count', () => {
  const cases = [
    DEFAULT,
    { targetAmount: '12000', periods: 12, decimals: 6, depositsMade: 12 },
    { targetAmount: '5000', periods: 1, decimals: 6, depositsMade: 0 },
    { targetAmount: '777', periods: 11, decimals: 0, depositsMade: 4 },
    { targetAmount: '9007199254740993', periods: 2, decimals: 0, depositsMade: 1 },
    { targetAmount: '0.000005', periods: 7, decimals: 6, depositsMade: 3 },
  ];
  for (const c of cases) {
    const r = modelSinkingFundProgress(c);
    assert.equal(r.depositedSoFar + r.stillToSave, r.targetAmount);
    assert.equal(r.remainingScheduleTotal, r.stillToSave);
    assert.equal(r.depositsMade + r.depositsRemaining, r.periods);
    assert.equal(r.remainingScheduleReachesTarget, true);
  }
});

test('deposited-so-far is counted at the schedule\u2019s own amounts: 3 regular deposits on the preload, never the target divided back \u2014 dividing back would credit 1 base unit the final deposit has not yet carried', () => {
  const r = modelSinkingFundProgress(DEFAULT);
  assert.equal(r.depositedSoFar, 3n * r.regularDeposit);
  assert.equal(r.targetAmount * 3n / 7n, 4285714285n);
  assert.notEqual(r.depositedSoFar, r.targetAmount * 3n / 7n);
});

test('the remaining schedule still reaches the target exactly: on the preload the 4 deposits still to come (3 regular plus the final, remainder included) sum to the 5714.285716 still to save \u2014 no catch-up deposit is needed or invented', () => {
  const r = modelSinkingFundProgress(DEFAULT);
  assert.equal(r.regularDeposit * 3n + r.finalDeposit, 5714285716n);
  assert.equal(r.remainingScheduleTotal, r.stillToSave);
});

test('no yield is credited while the fund waits: the fund holds exactly what has been deposited, and what it holds plus what remains is the target and nothing more', () => {
  const r = modelSinkingFundProgress(DEFAULT);
  assert.equal(r.yieldPriced, false);
  assert.equal(r.depositedSoFar, 3n * r.regularDeposit);
  assert.equal(r.depositedSoFar + r.stillToSave, r.targetAmount);
});

test('a fund with every deposit made is complete: it holds its target exactly, nothing is still to save, and the next deposit is zero', () => {
  const r = modelSinkingFundProgress({ ...DEFAULT, depositsMade: 7 });
  assert.equal(r.fundComplete, true);
  assert.equal(r.depositedSoFar, 10000000000n);
  assert.equal(r.stillToSave, 0n);
  assert.equal(r.remainingScheduleTotal, 0n);
  assert.equal(r.nextDeposit, 0n);
  assert.equal(r.depositsRemaining, 0);
});

test('a complete fund is finished, not waived: the amount still to save is zero because the deposits reached the target whole, final remainder included', () => {
  const r = modelSinkingFundProgress({ ...DEFAULT, depositsMade: 7 });
  assert.equal(r.depositedSoFar, r.targetAmount);
  assert.equal(r.depositedSoFar, r.depositsBeforeFinal + r.finalDeposit);
});

test('no deposit made yet: the whole target is still to save, the next deposit is the regular amount, and the whole schedule still remains', () => {
  const r = modelSinkingFundProgress({ ...DEFAULT, depositsMade: 0 });
  assert.equal(r.noneMade, true);
  assert.equal(r.depositedSoFar, 0n);
  assert.equal(r.stillToSave, r.targetAmount);
  assert.equal(r.remainingScheduleTotal, r.targetAmount);
  assert.equal(r.nextDeposit, r.regularDeposit);
});

test('only the final deposit remains: the next deposit is the final amount with its remainder \u2014 on the preload 6 made leaves the 1428.571432 final deposit', () => {
  const r = modelSinkingFundProgress({ ...DEFAULT, depositsMade: 6 });
  assert.equal(r.finalDepositNext, true);
  assert.equal(r.depositedSoFar, 8571428568n);
  assert.equal(r.stillToSave, 1428571432n);
  assert.equal(r.nextDeposit, 1428571432n);
  assert.equal(r.nextDeposit, r.finalDeposit);
});

test('shares are derived from the amounts against the target: on the preload what has been deposited states 4285.71 and what remains 5714.28', () => {
  const r = modelSinkingFundProgress(DEFAULT);
  assert.equal(r.depositedShareBpsText, '4285.71');
  assert.equal(r.stillToSaveShareBpsText, '5714.28');
});

test('on the no-decimals 777 case over 11 deposits with 4 made, 280 is deposited, 497 is still to save, the next deposit is 70, with shares 3603.60 and 6396.39', () => {
  const r = modelSinkingFundProgress({ targetAmount: '777', periods: 11, decimals: 0, depositsMade: 4 });
  assert.equal(r.depositedSoFar, 280n);
  assert.equal(r.stillToSave, 497n);
  assert.equal(r.remainingScheduleTotal, 497n);
  assert.equal(r.nextDeposit, 70n);
  assert.equal(r.depositedShareBpsText, '3603.60');
  assert.equal(r.stillToSaveShareBpsText, '6396.39');
});

test('amounts beyond float precision stay exact: a 2^53+1 target over 2 deposits with 1 made has deposited 4503599627370496 and still owes the 4503599627370497 final deposit', () => {
  const r = modelSinkingFundProgress({ targetAmount: '9007199254740993', periods: 2, decimals: 0, depositsMade: 1 });
  assert.equal(r.depositedSoFar, 4503599627370496n);
  assert.equal(r.stillToSave, 4503599627370497n);
  assert.equal(r.nextDeposit, 4503599627370497n);
  assert.equal(r.finalDepositNext, true);
  assert.equal(r.depositedShareBpsText, '4999.99');
  assert.equal(r.stillToSaveShareBpsText, '5000.00');
});

test('a target below one base unit per deposit makes progress without movement, stated: on a 5-base-unit target over 7 with 3 made, nothing has been deposited yet, the next deposit is nothing, and the whole 5 is still to save in the final deposit', () => {
  const r = modelSinkingFundProgress({ targetAmount: '0.000005', periods: 7, decimals: 6, depositsMade: 3 });
  assert.equal(r.regularDepositZero, true);
  assert.equal(r.depositedSoFar, 0n);
  assert.equal(r.stillToSave, 5n);
  assert.equal(r.nextDeposit, 0n);
  assert.equal(r.remainingScheduleTotal, 5n);
});

test('a single-deposit fund: with none made the next deposit is the target whole, and with it made the fund is complete', () => {
  const before = modelSinkingFundProgress({ targetAmount: '5000', periods: 1, decimals: 6, depositsMade: 0 });
  assert.equal(before.finalDepositNext, true);
  assert.equal(before.nextDeposit, 5000000000n);
  const after = modelSinkingFundProgress({ targetAmount: '5000', periods: 1, decimals: 6, depositsMade: 1 });
  assert.equal(after.fundComplete, true);
  assert.equal(after.depositedSoFar, 5000000000n);
});

test('the progress model composes the schedule model unchanged: its schedule fields are the base model\u2019s exactly', () => {
  const base = modelSinkingFund({ targetAmount: '10000', periods: 7, decimals: 6 });
  const r = modelSinkingFundProgress(DEFAULT);
  assert.equal(r.regularDeposit, base.regularDeposit);
  assert.equal(r.finalDeposit, base.finalDeposit);
  assert.equal(r.depositsBeforeFinal, base.depositsBeforeFinal);
  assert.equal(r.totalDeposits, base.totalDeposits);
});

test('deposits made beyond the fund\u2019s deposits are refused, as are negative and fractional counts', () => {
  assert.throws(() => modelSinkingFundProgress({ ...DEFAULT, depositsMade: 8 }), /Deposits made must be a whole number between zero and the number of deposits in the fund/);
  assert.throws(() => modelSinkingFundProgress({ ...DEFAULT, depositsMade: -1 }), /Deposits made must be a whole number between zero and the number of deposits in the fund/);
  assert.throws(() => modelSinkingFundProgress({ ...DEFAULT, depositsMade: 2.5 }), /Deposits made must be a whole number between zero and the number of deposits in the fund/);
});

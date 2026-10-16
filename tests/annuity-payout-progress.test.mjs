import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelAnnuityPayout, modelAnnuityPayoutProgress } from '../src/domain.js';

// Annuity payout progress model (v1.207): the annuity
// axis's second moment — the position part way through a
// stated fund's payouts. Paid-out-so-far is counted at the
// schedule's own amounts, the payouts still to come sum to
// the balance remaining exactly (on schedule, no extra
// payout invented), no yield or growth is credited while
// the fund waits, and a fund with every payout made is
// exhausted — finished, not waived.
const DEFAULT = { fundAmount: '20000', periods: 9, decimals: 6, payoutsMade: 3 };

test('the preloaded position: 3 of 9 payouts made on the 20000 fund — 6666.666666 paid out, 13333.333334 remains, next payout 2222.222222', () => {
  const r = modelAnnuityPayoutProgress(DEFAULT);
  assert.equal(r.paidOutSoFar, 6666666666n);
  assert.equal(r.balanceRemaining, 13333333334n);
  assert.equal(r.payoutsRemaining, 6);
  assert.equal(r.remainingScheduleTotal, 13333333334n);
  assert.equal(r.nextPayout, 2222222222n);
});

test('the default position is 3 payouts made when none is stated', () => {
  const r = modelAnnuityPayoutProgress({ fundAmount: '20000', periods: 9, decimals: 6 });
  assert.equal(r.payoutsMade, 3);
  assert.equal(r.paidOutSoFar, 6666666666n);
});

test('identities hold across funds: paid out plus the balance is the fund, the remaining schedule is the balance, and made plus remaining is the payout count', () => {
  const cases = [
    DEFAULT,
    { fundAmount: '12000', periods: 12, decimals: 6, payoutsMade: 12 },
    { fundAmount: '5000', periods: 1, decimals: 6, payoutsMade: 0 },
    { fundAmount: '777', periods: 11, decimals: 0, payoutsMade: 4 },
    { fundAmount: '9007199254740993', periods: 2, decimals: 0, payoutsMade: 1 },
    { fundAmount: '0.000005', periods: 7, decimals: 6, payoutsMade: 3 },
  ];
  for (const c of cases) {
    const r = modelAnnuityPayoutProgress(c);
    assert.equal(r.paidOutSoFar + r.balanceRemaining, r.fundAmount);
    assert.equal(r.remainingScheduleTotal, r.balanceRemaining);
    assert.equal(r.payoutsMade + r.payoutsRemaining, r.periods);
    assert.equal(r.remainingScheduleExhaustsFund, true);
  }
});

test('paid-out-so-far is counted at the schedule\u2019s own amounts: with 8 made it is 8 regular payouts, never the fund divided back \u2014 dividing back would pay out 1 base unit the final payout has not yet carried', () => {
  const r = modelAnnuityPayoutProgress({ ...DEFAULT, payoutsMade: 8 });
  assert.equal(r.paidOutSoFar, 8n * r.regularPayout);
  assert.equal(r.fundAmount * 8n / 9n, 17777777777n);
  assert.notEqual(r.paidOutSoFar, r.fundAmount * 8n / 9n);
});

test('the payouts still to come exhaust the balance exactly: on the preload the 6 payouts remaining (5 regular plus the final, remainder included) sum to the 13333.333334 balance \u2014 no extra payout is needed or invented', () => {
  const r = modelAnnuityPayoutProgress(DEFAULT);
  assert.equal(r.regularPayout * 5n + r.finalPayout, 13333333334n);
  assert.equal(r.remainingScheduleTotal, r.balanceRemaining);
});

test('no yield or growth is credited while the fund waits to pay out: the balance is exactly what has not been paid out yet, and paid out plus the balance is the fund and nothing more', () => {
  const r = modelAnnuityPayoutProgress(DEFAULT);
  assert.equal(r.yieldPriced, false);
  assert.equal(r.paidOutSoFar, 3n * r.regularPayout);
  assert.equal(r.paidOutSoFar + r.balanceRemaining, r.fundAmount);
});

test('a fund with every payout made is exhausted: it holds nothing, its balance is zero, and the next payout is zero', () => {
  const r = modelAnnuityPayoutProgress({ ...DEFAULT, payoutsMade: 9 });
  assert.equal(r.fundExhausted, true);
  assert.equal(r.paidOutSoFar, 20000000000n);
  assert.equal(r.balanceRemaining, 0n);
  assert.equal(r.remainingScheduleTotal, 0n);
  assert.equal(r.nextPayout, 0n);
  assert.equal(r.payoutsRemaining, 0);
});

test('an exhausted fund is finished, not waived: the balance is zero because the payouts paid the fund out whole, final remainder included', () => {
  const r = modelAnnuityPayoutProgress({ ...DEFAULT, payoutsMade: 9 });
  assert.equal(r.paidOutSoFar, r.fundAmount);
  assert.equal(r.paidOutSoFar, r.payoutsBeforeFinal + r.finalPayout);
});

test('no payout made yet: the whole fund remains, the next payout is the regular amount, and the whole schedule still remains', () => {
  const r = modelAnnuityPayoutProgress({ ...DEFAULT, payoutsMade: 0 });
  assert.equal(r.nonePaid, true);
  assert.equal(r.paidOutSoFar, 0n);
  assert.equal(r.balanceRemaining, r.fundAmount);
  assert.equal(r.remainingScheduleTotal, r.fundAmount);
  assert.equal(r.nextPayout, r.regularPayout);
});

test('only the final payout remains: the next payout is the final amount with its remainder \u2014 on the preload 8 made leaves the 2222.222224 final payout', () => {
  const r = modelAnnuityPayoutProgress({ ...DEFAULT, payoutsMade: 8 });
  assert.equal(r.finalPayoutNext, true);
  assert.equal(r.paidOutSoFar, 17777777776n);
  assert.equal(r.balanceRemaining, 2222222224n);
  assert.equal(r.nextPayout, 2222222224n);
  assert.equal(r.nextPayout, r.finalPayout);
});

test('shares are derived from the amounts against the fund: on the preload what has been paid out states 3333.33 and what remains 6666.66', () => {
  const r = modelAnnuityPayoutProgress(DEFAULT);
  assert.equal(r.paidOutShareBpsText, '3333.33');
  assert.equal(r.balanceShareBpsText, '6666.66');
});

test('on the no-decimals 777 case over 11 payouts with 4 made, 280 is paid out, 497 remains, the next payout is 70, with shares 3603.60 and 6396.39', () => {
  const r = modelAnnuityPayoutProgress({ fundAmount: '777', periods: 11, decimals: 0, payoutsMade: 4 });
  assert.equal(r.paidOutSoFar, 280n);
  assert.equal(r.balanceRemaining, 497n);
  assert.equal(r.remainingScheduleTotal, 497n);
  assert.equal(r.nextPayout, 70n);
  assert.equal(r.paidOutShareBpsText, '3603.60');
  assert.equal(r.balanceShareBpsText, '6396.39');
});

test('amounts beyond float precision stay exact: a 2^53+1 fund over 2 payouts with 1 made has paid out 4503599627370496 and still holds the 4503599627370497 final payout', () => {
  const r = modelAnnuityPayoutProgress({ fundAmount: '9007199254740993', periods: 2, decimals: 0, payoutsMade: 1 });
  assert.equal(r.paidOutSoFar, 4503599627370496n);
  assert.equal(r.balanceRemaining, 4503599627370497n);
  assert.equal(r.nextPayout, 4503599627370497n);
  assert.equal(r.finalPayoutNext, true);
  assert.equal(r.paidOutShareBpsText, '4999.99');
  assert.equal(r.balanceShareBpsText, '5000.00');
});

test('a fund below one base unit per payout makes progress without movement, stated: on a 5-base-unit fund over 7 with 3 made, nothing has been paid out yet, the next payout is nothing, and the whole 5 remains in the final payout', () => {
  const r = modelAnnuityPayoutProgress({ fundAmount: '0.000005', periods: 7, decimals: 6, payoutsMade: 3 });
  assert.equal(r.regularPayoutZero, true);
  assert.equal(r.paidOutSoFar, 0n);
  assert.equal(r.balanceRemaining, 5n);
  assert.equal(r.nextPayout, 0n);
  assert.equal(r.remainingScheduleTotal, 5n);
});

test('a single-payout fund: with none made the next payout is the fund whole, and with it made the fund is exhausted', () => {
  const before = modelAnnuityPayoutProgress({ fundAmount: '5000', periods: 1, decimals: 6, payoutsMade: 0 });
  assert.equal(before.finalPayoutNext, true);
  assert.equal(before.nextPayout, 5000000000n);
  const after = modelAnnuityPayoutProgress({ fundAmount: '5000', periods: 1, decimals: 6, payoutsMade: 1 });
  assert.equal(after.fundExhausted, true);
  assert.equal(after.paidOutSoFar, 5000000000n);
});

test('the progress model composes the payout model unchanged: its schedule fields are the base model\u2019s exactly, and it is still a stated-count payout, never a lifetime promise', () => {
  const base = modelAnnuityPayout({ fundAmount: '20000', periods: 9, decimals: 6 });
  const r = modelAnnuityPayoutProgress(DEFAULT);
  assert.equal(r.regularPayout, base.regularPayout);
  assert.equal(r.finalPayout, base.finalPayout);
  assert.equal(r.payoutsBeforeFinal, base.payoutsBeforeFinal);
  assert.equal(r.totalPaidOut, base.totalPaidOut);
  assert.equal(r.lifetimePriced, false);
});

test('payouts made beyond the fund\u2019s payouts are refused, as are negative and fractional counts', () => {
  assert.throws(() => modelAnnuityPayoutProgress({ ...DEFAULT, payoutsMade: 10 }), /Payouts made must be a whole number between zero and the number of payouts in the fund/);
  assert.throws(() => modelAnnuityPayoutProgress({ ...DEFAULT, payoutsMade: -1 }), /Payouts made must be a whole number between zero and the number of payouts in the fund/);
  assert.throws(() => modelAnnuityPayoutProgress({ ...DEFAULT, payoutsMade: 2.5 }), /Payouts made must be a whole number between zero and the number of payouts in the fund/);
});

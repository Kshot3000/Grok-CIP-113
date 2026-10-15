import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelAnnuityPayout } from '../src/domain.js';

// Annuity payout model (v1.197): a NEW axis — a stated fund
// paid out in stated payouts until it is exhausted. No yield
// and no growth are priced (the payouts alone sum to the fund
// exactly), the regular payout is floored and the final
// payout absorbs the remainder, and a stated-count payout is
// never presented as a lifetime promise.
const DEFAULT = { fundAmount: '20000', periods: 9, decimals: 6 };

test('the preloaded schedule: paying a 20000 fund out over 9 payouts — eight payouts of 2222.222222 and a final 2222.222224', () => {
  const r = modelAnnuityPayout(DEFAULT);
  assert.equal(r.regularPayout, 2222222222n);
  assert.equal(r.finalPayout, 2222222224n);
  assert.equal(r.payoutsBeforeFinal, 17777777776n);
  assert.equal(r.totalPaidOut, 20000000000n);
});

test('the default payout count is 12 when none is stated', () => {
  const r = modelAnnuityPayout({ fundAmount: '12000', decimals: 6 });
  assert.equal(r.periods, 12);
  assert.equal(r.regularPayout, 1000000000n);
});

test('identities hold across funds: regular times periods minus one plus the final is the fund, payouts before the final plus the final is the fund, and the total paid out is the fund', () => {
  const cases = [
    DEFAULT,
    { fundAmount: '12000', periods: 12, decimals: 6 },
    { fundAmount: '5000', periods: 1, decimals: 6 },
    { fundAmount: '777', periods: 11, decimals: 0 },
    { fundAmount: '9007199254740993', periods: 2, decimals: 0 },
    { fundAmount: '0.000005', periods: 7, decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelAnnuityPayout(c);
    assert.equal(r.regularPayout * BigInt(r.periods - 1) + r.finalPayout, r.fundAmount);
    assert.equal(r.payoutsBeforeFinal + r.finalPayout, r.fundAmount);
    assert.equal(r.totalPaidOut, r.fundAmount);
  }
});

test('no yield and no growth are priced: the payouts alone sum to the fund exactly — crediting invented earnings would pay out more than the fund holds', () => {
  const r = modelAnnuityPayout(DEFAULT);
  assert.equal(r.yieldPriced, false);
  assert.equal(r.totalPaidOut, r.fundAmount);
  assert.equal(r.payoutsBeforeFinal + r.finalPayout, 20000000000n);
});

test('the final payout absorbs the flooring remainder: on the preload it is exactly 2 base units above the regular payout — dropping it would strand 2 base units in the exhausted fund, and rounding every payout up would overdraw the fund', () => {
  const r = modelAnnuityPayout(DEFAULT);
  assert.equal(r.finalAbsorbsRemainder, true);
  assert.equal(r.finalPayout - r.regularPayout, 2n);
  assert.equal(r.regularPayout * BigInt(r.periods), 19999999998n);
  assert.notEqual(r.regularPayout * BigInt(r.periods), r.fundAmount);
});

test('a fund that divides exactly pays equal payouts: on 12000 over 12 every payout, the final one included, is 1000', () => {
  const r = modelAnnuityPayout({ fundAmount: '12000', periods: 12, decimals: 6 });
  assert.equal(r.equalPayouts, true);
  assert.equal(r.finalAbsorbsRemainder, false);
  assert.equal(r.regularPayout, 1000000000n);
  assert.equal(r.finalPayout, 1000000000n);
});

test('shares are derived from the amounts against the fund: on the preload the regular and final payouts both state a floored 1111.11 share while their amounts differ by the 2-unit remainder', () => {
  const r = modelAnnuityPayout(DEFAULT);
  assert.equal(r.regularShareBpsText, '1111.11');
  assert.equal(r.finalShareBpsText, '1111.11');
  assert.notEqual(r.regularPayout, r.finalPayout);
});

test('on the no-decimals 777 case over 11 payouts the regular payout is 70 and the final 77, with shares 900.90 and 990.99', () => {
  const r = modelAnnuityPayout({ fundAmount: '777', periods: 11, decimals: 0 });
  assert.equal(r.regularPayout, 70n);
  assert.equal(r.finalPayout, 77n);
  assert.equal(r.payoutsBeforeFinal, 700n);
  assert.equal(r.regularShareBpsText, '900.90');
  assert.equal(r.finalShareBpsText, '990.99');
});

test('amounts beyond float precision stay exact: a 2^53+1 fund over 2 payouts pays 4503599627370496 and a final 4503599627370497', () => {
  const r = modelAnnuityPayout({ fundAmount: '9007199254740993', periods: 2, decimals: 0 });
  assert.equal(r.regularPayout, 4503599627370496n);
  assert.equal(r.finalPayout, 4503599627370497n);
  assert.equal(r.regularShareBpsText, '4999.99');
  assert.equal(r.finalShareBpsText, '5000.00');
});

test('a fund below one base unit per payout floors the regular payout to zero, stated: on a 5-base-unit fund over 7 payouts every payout but the final one pays nothing and the final payout is the whole 5', () => {
  const r = modelAnnuityPayout({ fundAmount: '0.000005', periods: 7, decimals: 6 });
  assert.equal(r.regularPayoutZero, true);
  assert.equal(r.regularPayout, 0n);
  assert.equal(r.finalPayout, 5n);
  assert.equal(r.payoutsBeforeFinal, 0n);
  assert.equal(r.finalShareBpsText, '10000.00');
});

test('a single payout is its own outcome: it pays the fund whole and nothing remains', () => {
  const r = modelAnnuityPayout({ fundAmount: '5000', periods: 1, decimals: 6 });
  assert.equal(r.singlePeriod, true);
  assert.equal(r.regularPayout, 5000000000n);
  assert.equal(r.finalPayout, 5000000000n);
  assert.equal(r.payoutsBeforeFinal, 0n);
});

test('this is a stated-count payout, never a lifetime promise: lifetime is not priced and no payout beyond the stated count exists in the model', () => {
  const r = modelAnnuityPayout(DEFAULT);
  assert.equal(r.lifetimePriced, false);
  assert.equal(r.periods, 9);
  assert.equal(r.totalPaidOut, r.fundAmount);
});

test('a fund of zero is refused by the model, and a negative fund is refused at parsing', () => {
  assert.throws(() => modelAnnuityPayout({ fundAmount: '0', periods: 9, decimals: 6 }), /Fund amount must be greater than zero/);
  assert.throws(() => modelAnnuityPayout({ fundAmount: '-5', periods: 9, decimals: 6 }), /Enter a positive decimal amount/);
});

test('zero payouts are refused, as are fractional payout counts', () => {
  assert.throws(() => modelAnnuityPayout({ ...DEFAULT, periods: 0 }), /Periods must be a whole number, one or more/);
  assert.throws(() => modelAnnuityPayout({ ...DEFAULT, periods: 2.5 }), /Periods must be a whole number, one or more/);
});

test('the fund is exhausted exactly by the stated payouts: after the final payout nothing remains and nothing was overdrawn', () => {
  const r = modelAnnuityPayout(DEFAULT);
  assert.equal(r.totalPaidOut - r.payoutsBeforeFinal - r.finalPayout, 0n);
  assert.equal(r.regularPayout * BigInt(r.periods) < r.fundAmount, true);
  assert.equal((r.regularPayout + 1n) * BigInt(r.periods) > r.fundAmount, true);
});

test('decimals default to 6 when none is stated: the preload fund stated without decimals pays the same regular payout', () => {
  const r = modelAnnuityPayout({ fundAmount: '20000', periods: 9 });
  assert.equal(r.decimals, 6);
  assert.equal(r.regularPayout, 2222222222n);
  assert.equal(r.finalPayout, 2222222224n);
});

test('on a 100 fund over 3 payouts the regular payout is 33.333333 and the final 33.333334, both stating a floored 3333.33 share', () => {
  const r = modelAnnuityPayout({ fundAmount: '100', periods: 3, decimals: 6 });
  assert.equal(r.regularPayout, 33333333n);
  assert.equal(r.finalPayout, 33333334n);
  assert.equal(r.payoutsBeforeFinal, 66666666n);
  assert.equal(r.regularShareBpsText, '3333.33');
  assert.equal(r.finalShareBpsText, '3333.33');
});

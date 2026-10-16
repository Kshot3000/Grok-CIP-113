import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelLateFee } from '../src/domain.js';

// Late payment charge model (v1.214): a NEW axis — what an
// amount owed costs when it is paid late. The charge is
// measured against the AMOUNT DUE for every period alike,
// SIMPLE (never on the growing total), and floored ONCE on
// the whole accrual (never per period); the shares are
// derived from the amounts against the total now due,
// floored.
const DEFAULT = { amountDue: '1000', lateRateBps: 500, periodsLate: 3, decimals: 6 };

test('the preloaded late charge: 1000 due at a stated 500 bps per period for 3 periods late charges 150 and the total now due is 1150, shares 1304.34 and 8695.65', () => {
  const r = modelLateFee(DEFAULT);
  assert.equal(r.amountDue, 1000000000n);
  assert.equal(r.lateCharge, 150000000n);
  assert.equal(r.totalNowDue, 1150000000n);
  assert.equal(r.lateChargeShareBpsText, '1304.34');
  assert.equal(r.amountDueShareBpsText, '8695.65');
});

test('the defaults are none stated when none are given: no rate and no periods charge nothing', () => {
  const r = modelLateFee({ amountDue: '1000', decimals: 6 });
  assert.equal(r.lateRateBps, 0);
  assert.equal(r.periodsLate, 0);
  assert.equal(r.lateCharge, 0n);
  assert.equal(r.totalNowDue, r.amountDue);
  assert.equal(r.noChargeYet, true);
  assert.equal(r.noRateStated, true);
});

test('identities hold across amounts due: the amount due plus the charge is the total now due, exactly', () => {
  const cases = [
    DEFAULT,
    { amountDue: '1000', lateRateBps: 500, periodsLate: 0, decimals: 6 },
    { amountDue: '1000', lateRateBps: 0, periodsLate: 12, decimals: 6 },
    { amountDue: '1000', lateRateBps: 10000, periodsLate: 2, decimals: 6 },
    { amountDue: '777', lateRateBps: 250, periodsLate: 4, decimals: 0 },
    { amountDue: '9007199254740993', lateRateBps: 500, periodsLate: 3, decimals: 0 },
    { amountDue: '0.000001', lateRateBps: 100, periodsLate: 1, decimals: 6 },
    { amountDue: '3', lateRateBps: 3333, periodsLate: 2, decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelLateFee(c);
    assert.equal(r.amountDue + r.lateCharge, r.totalNowDue);
  }
});

test('the charge is simple, never compounded: on the preload, compounding the charge on the growing total would state 157.625 where the simple charge is 150', () => {
  const r = modelLateFee(DEFAULT);
  let grown = r.amountDue;
  for (let i = 0; i < 3; i++) grown += grown * 500n / 10000n; // The wrong way, computed test-side: each period charges on the total the earlier charges grew.
  assert.equal(grown - r.amountDue, 157625000n);
  assert.equal(r.lateCharge, 150000000n);
  assert.equal(r.compounded, false);
});

test('the accrual is floored once, never per period: on 777 due at 250 bps for 4 periods, per-period flooring states 76 where the accrual floored once states 77', () => {
  const r = modelLateFee({ amountDue: '777', lateRateBps: 250, periodsLate: 4, decimals: 0 });
  assert.equal(r.lateCharge, 77n);
  assert.equal(r.totalNowDue, 854n);
  assert.equal(r.lateChargeShareBpsText, '901.63');
  assert.equal(r.amountDueShareBpsText, '9098.36');
  const perPeriod = 777n * 250n / 10000n; // The wrong way, computed test-side: each period floored on its own, then summed.
  assert.equal(perPeriod * 4n, 76n);
  assert.equal(r.flooredPerPeriod, false);
});

test('one period at the stated rate charges exactly that rate on the amount due', () => {
  const r = modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: 1, decimals: 0 });
  assert.equal(r.lateCharge, 50n);
  assert.equal(r.totalNowDue, 1050n);
});

test('zero periods late states no charge yet: the amount due is owed whole', () => {
  const r = modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: 0, decimals: 6 });
  assert.equal(r.lateCharge, 0n);
  assert.equal(r.totalNowDue, r.amountDue);
  assert.equal(r.noChargeYet, true);
  assert.equal(r.noRateStated, false);
});

test('a rate of zero states no charge however many periods pass', () => {
  const r = modelLateFee({ amountDue: '1000', lateRateBps: 0, periodsLate: 12, decimals: 6 });
  assert.equal(r.lateCharge, 0n);
  assert.equal(r.totalNowDue, r.amountDue);
  assert.equal(r.noRateStated, true);
  assert.equal(r.noChargeYet, false);
});

test('a stated rate that floors to zero over the stated periods charges nothing at that size, stated as such', () => {
  const r = modelLateFee({ amountDue: '3', lateRateBps: 3333, periodsLate: 1, decimals: 0 });
  assert.equal(r.lateCharge, 0n);
  assert.equal(r.lateChargeFloorsToZero, true);
  const r2 = modelLateFee({ amountDue: '3', lateRateBps: 3333, periodsLate: 2, decimals: 0 });
  assert.equal(r2.lateCharge, 1n);
  assert.equal(r2.lateChargeFloorsToZero, false);
});

test('a charge grown to the whole amount due is flagged, and past it is flagged as exceeding the amount due', () => {
  const whole = modelLateFee({ amountDue: '1000', lateRateBps: 10000, periodsLate: 1, decimals: 0 });
  assert.equal(whole.lateCharge, 1000n);
  assert.equal(whole.chargeEqualsAmountDue, true);
  assert.equal(whole.chargeExceedsAmountDue, false);
  const past = modelLateFee({ amountDue: '1000', lateRateBps: 10000, periodsLate: 2, decimals: 0 });
  assert.equal(past.lateCharge, 2000n);
  assert.equal(past.totalNowDue, 3000n);
  assert.equal(past.chargeExceedsAmountDue, true);
});

test('a 2^53+1 amount due stays exact: at 500 bps for 3 periods the charge is 1351079888211148', () => {
  const r = modelLateFee({ amountDue: '9007199254740993', lateRateBps: 500, periodsLate: 3, decimals: 0 });
  assert.equal(r.lateCharge, 1351079888211148n);
  assert.equal(r.totalNowDue, 10358279142952141n);
});

test('an amount due of zero or less is refused', () => {
  assert.throws(() => modelLateFee({ amountDue: '0', decimals: 6 }), /Amount due must be greater than zero/);
  assert.throws(() => modelLateFee({ decimals: 6 }), /Amount due must be greater than zero/);
});

test('a rate beyond the whole per period is refused, as are fractional and negative rates', () => {
  assert.throws(() => modelLateFee({ amountDue: '1000', lateRateBps: 10001, decimals: 6 }), /Late rate must be a whole number of basis points between 0 and 10,000 per period/);
  assert.throws(() => modelLateFee({ amountDue: '1000', lateRateBps: -1, decimals: 6 }), /Late rate must be/);
  assert.throws(() => modelLateFee({ amountDue: '1000', lateRateBps: 2.5, decimals: 6 }), /Late rate must be/);
});

test('periods late must be a whole count within bounds: fractional, negative, and past the bound are refused', () => {
  assert.throws(() => modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: 1.5, decimals: 6 }), /Periods late must be a whole number between 0 and 1,200/);
  assert.throws(() => modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: -1, decimals: 6 }), /Periods late must be/);
  assert.throws(() => modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: 1201, decimals: 6 }), /Periods late must be/);
  const atBound = modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: 1200, decimals: 0 });
  assert.equal(atBound.periodsLate, 1200);
});

test('the charge scales with the periods on the same base: twice the periods, twice the charge, before flooring', () => {
  const one = modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: 1, decimals: 0 });
  const two = modelLateFee({ amountDue: '1000', lateRateBps: 500, periodsLate: 2, decimals: 0 });
  assert.equal(two.lateCharge, one.lateCharge * 2n);
});

test('shares are derived from the amounts and floored, never rounded: a charge of 1 on a total of 4 states 2500.00, and the preload states 1304.34 not 1304.35', () => {
  const r = modelLateFee({ amountDue: '3', lateRateBps: 3333, periodsLate: 2, decimals: 0 });
  assert.equal(r.lateChargeShareBpsText, '2500.00');
  assert.equal(r.amountDueShareBpsText, '7500.00');
  const pre = modelLateFee(DEFAULT);
  assert.equal(pre.lateChargeShareBpsText, '1304.34'); // 150/1150 = 1304.3478... hundredths of a basis point, floored.
});

test('entitlement is never priced: whether a charge is owed, its grace period, and its cap are stated nowhere in the accrual', () => {
  const r = modelLateFee(DEFAULT);
  assert.equal(r.entitlementPriced, false);
});

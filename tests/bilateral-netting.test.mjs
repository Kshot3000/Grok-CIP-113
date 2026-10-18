import test from 'node:test';
import assert from 'node:assert/strict';
import { modelBilateralNetting } from '../src/domain.js';

const DEFAULT = { partyAOwes: '1000', partyBOwes: '650', decimals: 6 };
const CASES = [['1000', '650', 6], ['650', '1000', 6], ['500', '500', 6], ['1000', '0', 6], ['0', '250', 6], ['0', '0', 6], ['100.25', '40.1', 6], ['7', '1', 0]];

test('preload: party A owing 1000 and party B owing 650 offset 650 on each side, and party A pays the net difference of 350', () => {
  const r = modelBilateralNetting(DEFAULT);
  assert.equal(r.partyAOwesAmount, 1000000000n);
  assert.equal(r.partyBOwesAmount, 650000000n);
  assert.equal(r.grossObligationsAmount, 1650000000n);
  assert.equal(r.offsetAmount, 650000000n);
  assert.equal(r.totalDischargedAmount, 1300000000n);
  assert.equal(r.partyARemainingAmount, 350000000n);
  assert.equal(r.partyBRemainingAmount, 0n);
  assert.equal(r.netPaymentAmount, 350000000n);
  assert.equal(r.netPayer, 'partyA');
  assert.equal(r.hasObligations, true);
  assert.equal(r.fullyOffset, false);
  assert.equal(r.noOffset, false);
});

test('each obligation is conserved: the offset plus each party remaining part equals that party gross obligation, on every stated case', () => {
  for (const [partyAOwes, partyBOwes, decimals] of CASES) {
    const r = modelBilateralNetting({ partyAOwes, partyBOwes, decimals });
    assert.equal(r.obligationsConserved, true);
    assert.equal(r.offsetAmount + r.partyARemainingAmount, r.partyAOwesAmount);
    assert.equal(r.offsetAmount + r.partyBRemainingAmount, r.partyBOwesAmount);
    assert.equal(r.netPaymentAmount + r.totalDischargedAmount, r.grossObligationsAmount);
    assert.equal(r.totalDischargedAmount, r.offsetAmount * 2n);
  }
});

test('exactly one side has a remaining part, and it is the net payment: the party who owed more pays, on every stated case', () => {
  for (const [partyAOwes, partyBOwes, decimals] of CASES) {
    const r = modelBilateralNetting({ partyAOwes, partyBOwes, decimals });
    assert.ok(r.partyARemainingAmount === 0n || r.partyBRemainingAmount === 0n);
    assert.equal(r.partyARemainingAmount + r.partyBRemainingAmount, r.netPaymentAmount);
    if (r.partyAOwesAmount > r.partyBOwesAmount) assert.equal(r.netPayer, 'partyA');
    else if (r.partyBOwesAmount > r.partyAOwesAmount) assert.equal(r.netPayer, 'partyB');
    else assert.equal(r.netPayer, 'none');
  }
});

test('the net is measured on the difference between the two obligations, never on either obligation alone', () => {
  const r = modelBilateralNetting(DEFAULT);
  assert.equal(r.netMeasuredOnDifference, true);
  assert.equal(r.netPaymentAmount, 350000000n);
  assert.notEqual(r.netPaymentAmount, r.partyAOwesAmount);
  assert.notEqual(r.netPaymentAmount, r.partyBOwesAmount);
  assert.notEqual(r.netPaymentAmount, r.grossObligationsAmount);
});

test('the mirror case nets the other way: party B owing more pays party A the difference', () => {
  const r = modelBilateralNetting({ partyAOwes: '650', partyBOwes: '1000', decimals: 6 });
  assert.equal(r.netPayer, 'partyB');
  assert.equal(r.partyARemainingAmount, 0n);
  assert.equal(r.partyBRemainingAmount, 350000000n);
  assert.equal(r.netPaymentAmount, 350000000n);
  assert.equal(r.offsetAmount, 650000000n);
});

test('equal obligations offset in full: both are discharged and no payment moves', () => {
  const r = modelBilateralNetting({ partyAOwes: '500', partyBOwes: '500', decimals: 6 });
  assert.equal(r.fullyOffset, true);
  assert.equal(r.netPayer, 'none');
  assert.equal(r.netPaymentAmount, 0n);
  assert.equal(r.offsetAmount, 500000000n);
  assert.equal(r.totalDischargedAmount, 1000000000n);
  assert.equal(r.grossObligationsAmount, 1000000000n);
});

test('where one side owes nothing there is nothing to offset and the other obligation stands whole as the net', () => {
  const a = modelBilateralNetting({ partyAOwes: '1000', partyBOwes: '0', decimals: 6 });
  assert.equal(a.noOffset, true);
  assert.equal(a.offsetAmount, 0n);
  assert.equal(a.netPaymentAmount, 1000000000n);
  assert.equal(a.netPayer, 'partyA');
  const b = modelBilateralNetting({ partyAOwes: '0', partyBOwes: '250', decimals: 6 });
  assert.equal(b.noOffset, true);
  assert.equal(b.netPaymentAmount, 250000000n);
  assert.equal(b.netPayer, 'partyB');
});

test('where neither side owes anything there is nothing to net and no payment moves', () => {
  const r = modelBilateralNetting({ partyAOwes: '0', partyBOwes: '0', decimals: 6 });
  assert.equal(r.hasObligations, false);
  assert.equal(r.fullyOffset, false);
  assert.equal(r.noOffset, true);
  assert.equal(r.netPaymentAmount, 0n);
  assert.equal(r.netPayer, 'none');
  assert.equal(r.grossObligationsAmount, 0n);
});

test('an obligation of zero on one side is stated, not refused, and a missing amount states zero', () => {
  const r = modelBilateralNetting({ partyAOwes: '1000', decimals: 6 });
  assert.equal(r.partyBOwesAmount, 0n);
  assert.equal(r.netPaymentAmount, 1000000000n);
});

test('fractional amounts state exactly in BigInt: 100.25 against 40.1 offsets 40.1 and nets 60.15', () => {
  const r = modelBilateralNetting({ partyAOwes: '100.25', partyBOwes: '40.1', decimals: 6 });
  assert.equal(r.offsetAmount, 40100000n);
  assert.equal(r.partyARemainingAmount, 60150000n);
  assert.equal(r.netPaymentAmount, 60150000n);
  assert.equal(r.grossObligationsAmount, 140350000n);
  assert.equal(r.totalDischargedAmount, 80200000n);
});

test('the offset never exceeds either obligation and the net never exceeds the larger obligation, across stated cases', () => {
  for (const [partyAOwes, partyBOwes, decimals] of CASES) {
    const r = modelBilateralNetting({ partyAOwes, partyBOwes, decimals });
    assert.ok(r.offsetAmount <= r.partyAOwesAmount);
    assert.ok(r.offsetAmount <= r.partyBOwesAmount);
    const larger = r.partyAOwesAmount > r.partyBOwesAmount ? r.partyAOwesAmount : r.partyBOwesAmount;
    assert.ok(r.netPaymentAmount <= larger);
  }
});

test('settling gross would have moved the gross total: the offset discharges twice the offset without any payment moving', () => {
  const r = modelBilateralNetting(DEFAULT);
  assert.equal(r.grossObligationsAmount, 1650000000n);
  assert.equal(r.totalDischargedAmount, 1300000000n);
  assert.equal(r.offsetIsPayment, false);
});

test('the offset is not forgiveness: the smaller obligation is discharged by the other, not written off', () => {
  const r = modelBilateralNetting(DEFAULT);
  assert.equal(r.offsetIsForgiveness, false);
  // The party who owed less receives exactly the difference, not the whole larger obligation.
  assert.equal(r.netPaymentAmount + r.offsetAmount, r.partyAOwesAmount);
});

test('the net payment is not a fee: it is the parties own obligations settled by difference', () => {
  const r = modelBilateralNetting(DEFAULT);
  assert.equal(r.netPaymentIsFee, false);
});

test('what is not priced stays unpriced: interest, enforceability, currency conversion, fees, and taxes', () => {
  const r = modelBilateralNetting(DEFAULT);
  assert.equal(r.interestPriced, false);
  assert.equal(r.enforceabilityPriced, false);
  assert.equal(r.currencyConversionPriced, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.taxesPriced, false);
});

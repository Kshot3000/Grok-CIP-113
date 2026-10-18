import test from 'node:test';
import assert from 'node:assert/strict';
import { modelInterestRateSwapSettlement } from '../src/domain.js';

const DEFAULT = { notionalAmount: '1000000', fixedRateBps: 500, floatingRateBps: 350, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, floatingRateBps: 500 },
  { ...DEFAULT, floatingRateBps: 0 },
  { ...DEFAULT, fixedRateBps: 0 },
  { ...DEFAULT, fixedRateBps: 0, floatingRateBps: 0 },
  { ...DEFAULT, fixedRateBps: 200, floatingRateBps: 450 },
  { notionalAmount: '0.001', fixedRateBps: 1, floatingRateBps: 2, decimals: 6 },
  { notionalAmount: '333333.333333', fixedRateBps: 333, floatingRateBps: 111, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { notionalAmount: '1', fixedRateBps: 10000, floatingRateBps: 9999, decimals: 6 },
];

test('preload: a fixed leg of 50000 and a floating leg of 35000 on a 1000000 notional state a net of 15000 paid by the fixed-rate payer', () => {
  const r = modelInterestRateSwapSettlement(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.notionalAmount, 1000000000000n);
  assert.equal(r.fixedRateBps, 500);
  assert.equal(r.floatingRateBps, 350);
  assert.equal(r.fixedLegAmount, 50000000000n);
  assert.equal(r.floatingLegAmount, 35000000000n);
  assert.equal(r.netAmount, 15000000000n);
  assert.equal(r.netPayer, 'fixed');
  assert.equal(r.fixedPayerNetAmount, -15000000000n);
  assert.equal(r.floatingPayerNetAmount, 15000000000n);
  assert.equal(r.legsEqual, false);
});

test('the net is the difference between the two legs, never a gross leg: paying both legs would move the smaller leg twice over', () => {
  const r = modelInterestRateSwapSettlement(DEFAULT);
  assert.equal(r.legsPaidGross, false);
  assert.notEqual(r.netAmount, r.fixedLegAmount);
  assert.notEqual(r.netAmount, r.floatingLegAmount);
  assert.equal(r.netAmount + r.floatingLegAmount, r.fixedLegAmount);
});

test('the notional never moves: it is the base the legs are measured on, not an amount either party pays', () => {
  const r = modelInterestRateSwapSettlement(DEFAULT);
  assert.equal(r.notionalExchanged, false);
  assert.ok(r.netAmount < r.notionalAmount);
  for (const input of CASES) {
    const c = modelInterestRateSwapSettlement(input);
    assert.equal(c.notionalExchanged, false);
    assert.ok(c.netAmount <= c.notionalAmount);
  }
});

test('the settlement is zero-sum exactly on every stated case, and the net plus the smaller leg is the larger leg', () => {
  for (const input of CASES) {
    const r = modelInterestRateSwapSettlement(input);
    assert.equal(r.fixedPayerNetAmount + r.floatingPayerNetAmount, 0n);
    const smaller = r.fixedLegAmount < r.floatingLegAmount ? r.fixedLegAmount : r.floatingLegAmount;
    const larger = r.fixedLegAmount > r.floatingLegAmount ? r.fixedLegAmount : r.floatingLegAmount;
    assert.equal(r.netAmount + smaller, larger);
    assert.equal(r.netAmount, larger - smaller);
  }
});

test('where the floating leg is the larger, the floating-rate payer pays the net', () => {
  const r = modelInterestRateSwapSettlement({ ...DEFAULT, fixedRateBps: 200, floatingRateBps: 450 });
  assert.equal(r.fixedLegAmount, 20000000000n);
  assert.equal(r.floatingLegAmount, 45000000000n);
  assert.equal(r.netAmount, 25000000000n);
  assert.equal(r.netPayer, 'floating');
  assert.equal(r.fixedPayerNetAmount, 25000000000n);
  assert.equal(r.floatingPayerNetAmount, -25000000000n);
});

test('equal legs settle with no payment: equality is a settlement, not a missing payment', () => {
  const r = modelInterestRateSwapSettlement({ ...DEFAULT, floatingRateBps: 500 });
  assert.equal(r.fixedLegAmount, r.floatingLegAmount);
  assert.equal(r.netAmount, 0n);
  assert.equal(r.netPayer, 'none');
  assert.equal(r.legsEqual, true);
  assert.equal(r.fixedPayerNetAmount, 0n);
});

test('a rate of zero is stated, not refused: that leg is zero and the other leg stands whole as the one net payment', () => {
  const r = modelInterestRateSwapSettlement({ ...DEFAULT, floatingRateBps: 0 });
  assert.equal(r.floatingLegAmount, 0n);
  assert.equal(r.netAmount, r.fixedLegAmount);
  assert.equal(r.netPayer, 'fixed');
  const both = modelInterestRateSwapSettlement({ ...DEFAULT, fixedRateBps: 0, floatingRateBps: 0 });
  assert.equal(both.netAmount, 0n);
  assert.equal(both.netPayer, 'none');
});

test('each leg is floored independently: on a tiny notional, differing stated rates can both floor to zero and state no payment', () => {
  const r = modelInterestRateSwapSettlement({ notionalAmount: '0.001', fixedRateBps: 1, floatingRateBps: 2, decimals: 6 });
  assert.equal(r.fixedLegAmount, 0n);
  assert.equal(r.floatingLegAmount, 0n);
  assert.equal(r.netAmount, 0n);
  assert.equal(r.netPayer, 'none');
});

test('flooring is exact on a fractional notional: the legs floor and the net is their floored difference', () => {
  const r = modelInterestRateSwapSettlement({ notionalAmount: '333333.333333', fixedRateBps: 333, floatingRateBps: 111, decimals: 6 });
  assert.equal(r.fixedLegAmount, 11099999999n);
  assert.equal(r.floatingLegAmount, 3699999999n);
  assert.equal(r.netAmount, 7400000000n);
  assert.equal(r.netPayer, 'fixed');
});

test('neither leg is a fee and the net is not a fee', () => {
  const r = modelInterestRateSwapSettlement(DEFAULT);
  assert.equal(r.fixedLegIsFee, false);
  assert.equal(r.floatingLegIsFee, false);
  assert.equal(r.netIsFee, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('both rates are per period as stated: the floating rate is never observed from a benchmark, and no day-count conversion enters', () => {
  const r = modelInterestRateSwapSettlement(DEFAULT);
  assert.equal(r.ratesPerPeriod, true);
  assert.equal(r.benchmarkPriced, false);
  assert.equal(r.dayCountPriced, false);
  assert.equal(r.laterPeriodsPriced, false);
});

test('notional change, collateral, default, and early termination are not priced', () => {
  const r = modelInterestRateSwapSettlement(DEFAULT);
  assert.equal(r.notionalChangePriced, false);
  assert.equal(r.collateralPriced, false);
  assert.equal(r.defaultPriced, false);
  assert.equal(r.earlyTerminationPriced, false);
});

test('a notional of zero is refused', () => {
  assert.throws(() => modelInterestRateSwapSettlement({ ...DEFAULT, notionalAmount: '0' }), /Notional amount must be greater than zero/);
});

test('a fixed rate above 10000 basis points is refused', () => {
  assert.throws(() => modelInterestRateSwapSettlement({ ...DEFAULT, fixedRateBps: 10001 }), /Fixed rate must be a whole number of basis points/);
});

test('a floating rate that is not a whole number of basis points is refused', () => {
  assert.throws(() => modelInterestRateSwapSettlement({ ...DEFAULT, floatingRateBps: 350.5 }), /Floating rate must be a whole number of basis points/);
});

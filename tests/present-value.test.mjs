import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPresentValue } from '../src/domain.js';

const DEFAULT = { futureAmount: '1000000', discountRateBps: 500, periods: 10, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, discountRateBps: 0 },
  { ...DEFAULT, periods: 0 },
  { futureAmount: '0.001', discountRateBps: 500, periods: 2, decimals: 6 },
  { futureAmount: '123456.789', discountRateBps: 250, periods: 4, decimals: 6 },
  { futureAmount: '1000000', discountRateBps: 1000, periods: 3, decimals: 0 },
  { futureAmount: '1000000', discountRateBps: 10000, periods: 1, decimals: 6 },
  { futureAmount: '7', discountRateBps: 300, periods: 5, decimals: 6 },
  { futureAmount: '0.5', discountRateBps: 500, periods: 10, decimals: 6 },
  { futureAmount: '1000000', discountRateBps: 500, periods: 20, decimals: 6 },
];

test('preload: an amount of 1000000 arriving in 10 periods at 500 bps per period is worth 613913253540 today, with a discount of 386086746460', () => {
  const r = modelPresentValue(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.futureAmount, 1000000000000n);
  assert.equal(r.discountRateBps, 500);
  assert.equal(r.periods, 10);
  assert.equal(r.presentValue, 613913253540n);
  assert.equal(r.discountAmount, 386086746460n);
  assert.equal(r.presentValueIfDiscountedOnce, 952380952380n);
});

test('the rate compounds every period: discounting once would state 952380952380, overstating the present value by 338467698840', () => {
  const r = modelPresentValue(DEFAULT);
  assert.equal(r.discountCompoundsEveryPeriod, true);
  assert.notEqual(r.presentValue, r.presentValueIfDiscountedOnce);
  assert.equal(r.presentValueIfDiscountedOnce - r.presentValue, 338467698840n);
});

test('present value plus discount is the future amount exactly, and the present value never exceeds it, on every stated case', () => {
  for (const input of CASES) {
    const r = modelPresentValue(input);
    assert.equal(r.presentValue + r.discountAmount, r.futureAmount);
    assert.ok(r.presentValue <= r.futureAmount);
    if (input.periods >= 1) assert.ok(r.presentValue <= r.presentValueIfDiscountedOnce);
    assert.ok(r.discountAmount >= 0n);
  }
});

test('the discount is not a fee and not a payment, and a series of amounts, rate changes, separate inflation, and taxes are not priced', () => {
  const r = modelPresentValue(DEFAULT);
  assert.equal(r.presentValueRoundedDown, true);
  assert.equal(r.presentValueNeverExceedsFutureAmount, true);
  assert.equal(r.rateTakenAsStatedPerPeriod, true);
  assert.equal(r.discountIsFee, false);
  assert.equal(r.discountIsPayment, false);
  assert.equal(r.seriesOfAmountsPriced, false);
  assert.equal(r.rateChangesPriced, false);
  assert.equal(r.inflationSeparatelyPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a discount rate of zero is stated, not refused: the present value is the future amount and the discount is zero, over any periods', () => {
  const r = modelPresentValue({ ...DEFAULT, discountRateBps: 0, periods: 50 });
  assert.equal(r.presentValue, 1000000000000n);
  assert.equal(r.discountAmount, 0n);
  assert.equal(r.presentValueIfDiscountedOnce, 1000000000000n);
});

test('zero periods state the future amount itself: nothing stands between the amount and today, whatever the rate', () => {
  const r = modelPresentValue({ ...DEFAULT, discountRateBps: 5000, periods: 0 });
  assert.equal(r.presentValue, 1000000000000n);
  assert.equal(r.discountAmount, 0n);
});

test('over exactly one period the compounded value is the once-discounted value: 952380952380 at 500 bps', () => {
  const r = modelPresentValue({ ...DEFAULT, periods: 1 });
  assert.equal(r.presentValue, 952380952380n);
  assert.equal(r.presentValue, r.presentValueIfDiscountedOnce);
  assert.equal(r.discountAmount, 47619047620n);
});

test('at a rate of 10000 bps over one period the present value is exactly half the future amount', () => {
  const r = modelPresentValue({ futureAmount: '1000000', discountRateBps: 10000, periods: 1, decimals: 6 });
  assert.equal(r.presentValue, 500000000000n);
  assert.equal(r.discountAmount, 500000000000n);
});

test('on tiny amounts of 0.001 at 500 bps over 2 periods, the present value is 907 and the discount is 93', () => {
  const r = modelPresentValue({ futureAmount: '0.001', discountRateBps: 500, periods: 2, decimals: 6 });
  assert.equal(r.presentValue, 907n);
  assert.equal(r.discountAmount, 93n);
  assert.equal(r.presentValueIfDiscountedOnce, 952n);
});

test('fractional amounts are exact: 123456.789 at 250 bps over 4 periods is worth 111845757599, a discount of 11611031401', () => {
  const r = modelPresentValue({ futureAmount: '123456.789', discountRateBps: 250, periods: 4, decimals: 6 });
  assert.equal(r.presentValue, 111845757599n);
  assert.equal(r.discountAmount, 11611031401n);
  assert.equal(r.presentValueIfDiscountedOnce, 120445647804n);
});

test('more periods at the same rate always state a lower present value on the same amount', () => {
  const one = modelPresentValue({ ...DEFAULT, periods: 1 });
  const ten = modelPresentValue(DEFAULT);
  const twenty = modelPresentValue({ ...DEFAULT, periods: 20 });
  assert.equal(one.presentValue, 952380952380n);
  assert.equal(ten.presentValue, 613913253540n);
  assert.equal(twenty.presentValue, 376889482873n);
  assert.ok(twenty.presentValue < ten.presentValue && ten.presentValue < one.presentValue);
});

test('a future amount of zero is refused', () => {
  assert.throws(() => modelPresentValue({ ...DEFAULT, futureAmount: '0' }), /Future amount must be greater than zero/);
});

test('a discount rate above 100000 basis points is refused', () => {
  assert.throws(() => modelPresentValue({ ...DEFAULT, discountRateBps: 100001 }), /Discount rate must be a whole number of basis points/);
});

test('a fractional discount rate is refused', () => {
  assert.throws(() => modelPresentValue({ ...DEFAULT, discountRateBps: 2.5 }), /Discount rate must be a whole number of basis points/);
});

test('a period count beyond 100, or a negative one, is refused', () => {
  assert.throws(() => modelPresentValue({ ...DEFAULT, periods: 101 }), /Periods must be a whole number/);
  assert.throws(() => modelPresentValue({ ...DEFAULT, periods: -1 }), /Periods must be a whole number/);
});

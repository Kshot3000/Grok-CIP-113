import test from 'node:test';
import assert from 'node:assert/strict';
import { modelBondCurrentYield } from '../src/domain.js';

const DEFAULT = { faceAmount: '1000000', couponRateBps: 500, purchasePrice: '800000', holdingPeriods: 10, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, purchasePrice: '1250000' },
  { ...DEFAULT, purchasePrice: '1000000' },
  { ...DEFAULT, couponRateBps: 0 },
  { ...DEFAULT, holdingPeriods: 0 },
  { faceAmount: '0.001', couponRateBps: 500, purchasePrice: '0.0008', holdingPeriods: 2, decimals: 6 },
  { faceAmount: '123456.789', couponRateBps: 250, purchasePrice: '100000', holdingPeriods: 4, decimals: 6 },
  { faceAmount: '1000000', couponRateBps: 1000, purchasePrice: '900000', holdingPeriods: 3, decimals: 0 },
  { faceAmount: '7', couponRateBps: 300, purchasePrice: '5', holdingPeriods: 5, decimals: 6 },
  { faceAmount: '0.5', couponRateBps: 500, purchasePrice: '0.4', holdingPeriods: 10, decimals: 6 },
];

test('preload: a face of 1000000 at 500 bps bought for 800000 pays a coupon of 50000000000 and carries a current yield of 625 bps', () => {
  const r = modelBondCurrentYield(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.faceAmount, 1000000000000n);
  assert.equal(r.couponRateBps, 500);
  assert.equal(r.purchasePrice, 800000000000n);
  assert.equal(r.holdingPeriods, 10);
  assert.equal(r.couponPerPeriod, 50000000000n);
  assert.equal(r.currentYieldBps, 625n);
});

test('the yield is measured on the price paid: stating the coupon rate as the yield would imply a coupon of 40000000000, not the 50000000000 the bond pays', () => {
  const r = modelBondCurrentYield(DEFAULT);
  assert.equal(r.yieldMeasuredOnPricePaid, true);
  assert.equal(r.couponMeasuredOnFace, true);
  assert.equal(r.couponImpliedByCouponRateOnPrice, 40000000000n);
  assert.notEqual(r.couponImpliedByCouponRateOnPrice, r.couponPerPeriod);
  assert.equal(r.yieldLessCouponRateBps, 125n);
});

test('the yield is the exact floor of the coupon over the price, on every stated case', () => {
  for (const input of CASES) {
    const r = modelBondCurrentYield(input);
    assert.ok(r.currentYieldBps * r.purchasePrice <= r.couponPerPeriod * 10000n);
    assert.ok((r.currentYieldBps + 1n) * r.purchasePrice > r.couponPerPeriod * 10000n || r.couponPerPeriod === 0n);
    assert.equal(r.couponIncomeOverHolding, r.couponPerPeriod * BigInt(r.holdingPeriods));
    assert.ok(r.premiumAmount === 0n || r.discountAmount === 0n);
  }
});

test('the yield is income only, not a fee, and yield to maturity, default, price change, redemption, and taxes are not priced', () => {
  const r = modelBondCurrentYield(DEFAULT);
  assert.equal(r.yieldRoundedDown, true);
  assert.equal(r.yieldIsIncomeOnly, true);
  assert.equal(r.priceChangeInYield, false);
  assert.equal(r.redemptionInYield, false);
  assert.equal(r.yieldToMaturityPriced, false);
  assert.equal(r.defaultPriced, false);
  assert.equal(r.taxesPriced, false);
  assert.equal(r.couponIsFee, false);
});

test('a coupon rate of zero is stated, not refused: the yield, the difference, and the income are all zero', () => {
  const r = modelBondCurrentYield({ ...DEFAULT, couponRateBps: 0 });
  assert.equal(r.couponPerPeriod, 0n);
  assert.equal(r.currentYieldBps, 0n);
  assert.equal(r.yieldLessCouponRateBps, 0n);
  assert.equal(r.couponIncomeOverHolding, 0n);
  assert.equal(r.discountAmount, 200000000000n);
});

test('at a price equal to the face the current yield is the coupon rate exactly, with no premium or discount', () => {
  const r = modelBondCurrentYield({ ...DEFAULT, purchasePrice: '1000000' });
  assert.equal(r.currentYieldBps, 500n);
  assert.equal(r.yieldLessCouponRateBps, 0n);
  assert.equal(r.couponImpliedByCouponRateOnPrice, r.couponPerPeriod);
  assert.equal(r.premiumAmount, 0n);
  assert.equal(r.discountAmount, 0n);
});

test('above the face the yield is lower: a price of 1250000 states a yield of 400 bps, 100 below the coupon rate, and a premium of 250000000000', () => {
  const r = modelBondCurrentYield({ ...DEFAULT, purchasePrice: '1250000' });
  assert.equal(r.currentYieldBps, 400n);
  assert.equal(r.yieldLessCouponRateBps, -100n);
  assert.equal(r.premiumAmount, 250000000000n);
  assert.equal(r.discountAmount, 0n);
  assert.equal(r.couponImpliedByCouponRateOnPrice, 62500000000n);
});

test('below the face the discount is stated exactly: the preload price stands 200000000000 under the face with no premium', () => {
  const r = modelBondCurrentYield(DEFAULT);
  assert.equal(r.discountAmount, 200000000000n);
  assert.equal(r.premiumAmount, 0n);
  assert.equal(r.discountAmount + r.purchasePrice, r.faceAmount);
});

test('zero holding periods state no income, and the yield is unchanged', () => {
  const r = modelBondCurrentYield({ ...DEFAULT, holdingPeriods: 0 });
  assert.equal(r.couponIncomeOverHolding, 0n);
  assert.equal(r.currentYieldBps, 625n);
  assert.equal(r.couponPerPeriod, 50000000000n);
});

test('the coupon income over the stated holding is the coupon times the count exactly: 500000000000 over 10 periods', () => {
  const r = modelBondCurrentYield(DEFAULT);
  assert.equal(r.couponIncomeOverHolding, 500000000000n);
  const three = modelBondCurrentYield({ ...DEFAULT, holdingPeriods: 3 });
  assert.equal(three.couponIncomeOverHolding, 150000000000n);
});

test('tiny amounts are exact: a face of 0.001 at 500 bps bought for 0.0008 pays 50 and yields 625 bps', () => {
  const r = modelBondCurrentYield({ faceAmount: '0.001', couponRateBps: 500, purchasePrice: '0.0008', holdingPeriods: 2, decimals: 6 });
  assert.equal(r.couponPerPeriod, 50n);
  assert.equal(r.currentYieldBps, 625n);
  assert.equal(r.couponImpliedByCouponRateOnPrice, 40n);
  assert.equal(r.couponIncomeOverHolding, 100n);
});

test('fractional amounts are exact: 123456.789 at 250 bps bought for 100000 pays 3086419725 and yields 308 bps', () => {
  const r = modelBondCurrentYield({ faceAmount: '123456.789', couponRateBps: 250, purchasePrice: '100000', holdingPeriods: 4, decimals: 6 });
  assert.equal(r.couponPerPeriod, 3086419725n);
  assert.equal(r.currentYieldBps, 308n);
  assert.equal(r.yieldLessCouponRateBps, 58n);
  assert.equal(r.couponIncomeOverHolding, 12345678900n);
});

test('a face amount of zero is refused', () => {
  assert.throws(() => modelBondCurrentYield({ ...DEFAULT, faceAmount: '0' }), /Bond face amount must be greater than zero/);
});

test('a purchase price of zero is refused', () => {
  assert.throws(() => modelBondCurrentYield({ ...DEFAULT, purchasePrice: '0' }), /Bond purchase price must be greater than zero/);
});

test('a coupon rate above 10000 basis points, a fractional rate, and a holding count beyond 120 are refused', () => {
  assert.throws(() => modelBondCurrentYield({ ...DEFAULT, couponRateBps: 10001 }), /Coupon rate must be a whole number of basis points/);
  assert.throws(() => modelBondCurrentYield({ ...DEFAULT, couponRateBps: 2.5 }), /Coupon rate must be a whole number of basis points/);
  assert.throws(() => modelBondCurrentYield({ ...DEFAULT, holdingPeriods: 121 }), /Holding periods must be a whole number/);
  assert.throws(() => modelBondCurrentYield({ ...DEFAULT, holdingPeriods: -1 }), /Holding periods must be a whole number/);
});

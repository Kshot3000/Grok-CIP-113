import test from 'node:test';
import assert from 'node:assert/strict';
import { modelZeroCouponDiscount } from '../src/domain.js';

const DEFAULT = { faceAmount: '1000000', discountRateBps: 500, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, discountRateBps: 0 },
  { ...DEFAULT, discountRateBps: 10000 },
  { faceAmount: '333333.333333', discountRateBps: 3333, decimals: 6 },
  { faceAmount: '1', discountRateBps: 1, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { faceAmount: '2', discountRateBps: 5000, decimals: 6 },
  { faceAmount: '0.001', discountRateBps: 9999, decimals: 6 },
  { ...DEFAULT, discountRateBps: 1 },
  { ...DEFAULT, discountRateBps: 100000 },
];

test('preload: a face of 1000000 at a discount rate of 500 basis points states a purchase price of 952380952380 and a discount of 47619047620', () => {
  const r = modelZeroCouponDiscount(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.faceAmount, 1000000000000n);
  assert.equal(r.discountRateBps, 500);
  assert.equal(r.purchasePrice, 952380952380n);
  assert.equal(r.discountAmount, 47619047620n);
});

test('the face is discounted at the stated rate, never sliced by it: the price is the face divided by one plus the rate', () => {
  const r = modelZeroCouponDiscount(DEFAULT);
  assert.equal(r.discountedNotSliced, true);
  assert.equal(r.purchasePrice, r.faceAmount * 10000n / (10000n + 500n));
  assert.notEqual(r.purchasePrice, r.faceAmount * 9500n / 10000n);
  assert.notEqual(r.purchasePrice, 950000000000n);
});

test('the pricing is conserved on every stated case: the purchase price plus the discount is the face exactly', () => {
  for (const input of CASES) {
    const r = modelZeroCouponDiscount(input);
    assert.equal(r.priceConserved, true);
    assert.equal(r.purchasePrice + r.discountAmount, r.faceAmount);
    assert.ok(r.purchasePrice <= r.faceAmount);
    assert.ok(r.discountAmount >= 0n);
  }
});

test('the discount is not a fee and not a coupon, and the term, day count, issuer default, secondary sale, and taxes are not priced', () => {
  const r = modelZeroCouponDiscount(DEFAULT);
  assert.equal(r.discountIsFee, false);
  assert.equal(r.discountIsCoupon, false);
  assert.equal(r.couponsPriced, false);
  assert.equal(r.termPriced, false);
  assert.equal(r.dayCountPriced, false);
  assert.equal(r.issuerDefaultPriced, false);
  assert.equal(r.secondarySalePriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a discount rate of zero is stated, not refused: the price is the face and the discount is zero', () => {
  const r = modelZeroCouponDiscount({ ...DEFAULT, discountRateBps: 0 });
  assert.equal(r.purchasePrice, 1000000000000n);
  assert.equal(r.discountAmount, 0n);
});

test('a discount rate of 10000 basis points states a price of exactly half the face', () => {
  const r = modelZeroCouponDiscount({ ...DEFAULT, discountRateBps: 10000 });
  assert.equal(r.purchasePrice, 500000000000n);
  assert.equal(r.discountAmount, 500000000000n);
});

test('flooring is exact on fractional amounts: the price floors and the discount is the exact remainder, so the conservation stays exact', () => {
  const r = modelZeroCouponDiscount({ faceAmount: '333333.333333', discountRateBps: 3333, decimals: 6 });
  assert.equal(r.purchasePrice, 250006250156n);
  assert.equal(r.discountAmount, 83327083177n);
  assert.equal(r.purchasePrice + r.discountAmount, 333333333333n);
});

test('on a face of 1 at 1 basis point the discount is exactly 100 base units', () => {
  const r = modelZeroCouponDiscount({ faceAmount: '1', discountRateBps: 1, decimals: 6 });
  assert.equal(r.purchasePrice, 999900n);
  assert.equal(r.discountAmount, 100n);
});

test('on a face of 2 at 5000 basis points the price is 1333333 and the discount is 666667 base units', () => {
  const r = modelZeroCouponDiscount({ faceAmount: '2', discountRateBps: 5000, decimals: 6 });
  assert.equal(r.purchasePrice, 1333333n);
  assert.equal(r.discountAmount, 666667n);
});

test('on a tiny face at 9999 basis points the price and the discount are 500 base units each and are stated, not hidden', () => {
  const r = modelZeroCouponDiscount({ faceAmount: '0.001', discountRateBps: 9999, decimals: 6 });
  assert.equal(r.purchasePrice, 500n);
  assert.equal(r.discountAmount, 500n);
});

test('at the highest stated rate of 100000 basis points the price is still positive and the conservation holds', () => {
  const r = modelZeroCouponDiscount({ ...DEFAULT, discountRateBps: 100000 });
  assert.equal(r.purchasePrice, 90909090909n);
  assert.equal(r.purchasePrice + r.discountAmount, r.faceAmount);
  assert.ok(r.purchasePrice > 0n);
});

test('a deeper stated rate always states a lower price and a larger discount on the same face', () => {
  const shallow = modelZeroCouponDiscount({ ...DEFAULT, discountRateBps: 100 });
  const deep = modelZeroCouponDiscount({ ...DEFAULT, discountRateBps: 900 });
  assert.ok(deep.purchasePrice < shallow.purchasePrice);
  assert.ok(deep.discountAmount > shallow.discountAmount);
});

test('a face amount of zero is refused', () => {
  assert.throws(() => modelZeroCouponDiscount({ ...DEFAULT, faceAmount: '0' }), /Face amount must be greater than zero/);
});

test('a discount rate above 100000 basis points is refused', () => {
  assert.throws(() => modelZeroCouponDiscount({ ...DEFAULT, discountRateBps: 100001 }), /Discount rate must be a whole number of basis points/);
});

test('a discount rate that is negative or not a whole number is refused', () => {
  assert.throws(() => modelZeroCouponDiscount({ ...DEFAULT, discountRateBps: -1 }), /Discount rate must be a whole number of basis points/);
  assert.throws(() => modelZeroCouponDiscount({ ...DEFAULT, discountRateBps: 12.5 }), /Discount rate must be a whole number of basis points/);
});

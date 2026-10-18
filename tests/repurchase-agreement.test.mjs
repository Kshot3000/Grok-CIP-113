import test from 'node:test';
import assert from 'node:assert/strict';
import { modelRepurchaseAgreement } from '../src/domain.js';

const DEFAULT = { collateralValue: '800000', haircutBps: 2000, repoRateBps: 300, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, haircutBps: 0 },
  { ...DEFAULT, repoRateBps: 0 },
  { ...DEFAULT, haircutBps: 0, repoRateBps: 0 },
  { ...DEFAULT, haircutBps: 500, repoRateBps: 1000 },
  { ...DEFAULT, haircutBps: 9999, repoRateBps: 300 },
  { collateralValue: '0.001', haircutBps: 0, repoRateBps: 1, decimals: 6 },
  { collateralValue: '333333.333333', haircutBps: 333, repoRateBps: 111, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { collateralValue: '1', haircutBps: 1000, repoRateBps: 10000, decimals: 6 },
];

test('preload: collateral of 800000 at a 2000 bps haircut advances 640000, and at a 300 bps repo rate for the term the repurchase price is 659200', () => {
  const r = modelRepurchaseAgreement(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.collateralValue, 800000000000n);
  assert.equal(r.haircutBps, 2000);
  assert.equal(r.repoRateBps, 300);
  assert.equal(r.purchasePriceAmount, 640000000000n);
  assert.equal(r.haircutAmount, 160000000000n);
  assert.equal(r.repurchaseInterestAmount, 19200000000n);
  assert.equal(r.repurchasePriceAmount, 659200000000n);
  assert.equal(r.sellerCostAmount, 19200000000n);
});

test('the interest is measured on the purchase price actually advanced, never on the whole collateral value', () => {
  const r = modelRepurchaseAgreement(DEFAULT);
  assert.equal(r.interestOnPurchasePrice, true);
  assert.notEqual(r.repurchaseInterestAmount, 24000000000n);
  assert.equal(r.repurchaseInterestAmount, r.purchasePriceAmount * 300n / 10000n);
});

test('the purchase price plus the haircut amount is the collateral value exactly, on every stated case', () => {
  for (const input of CASES) {
    const r = modelRepurchaseAgreement(input);
    assert.equal(r.purchasePriceAmount + r.haircutAmount, r.collateralValue);
    assert.equal(r.purchasePlusHaircutConserved, true);
  }
});

test('the purchase price plus the interest is the repurchase price exactly, on every stated case', () => {
  for (const input of CASES) {
    const r = modelRepurchaseAgreement(input);
    assert.equal(r.purchasePriceAmount + r.repurchaseInterestAmount, r.repurchasePriceAmount);
    assert.equal(r.repurchaseConserved, true);
    assert.equal(r.sellerCostAmount, r.repurchaseInterestAmount);
  }
});

test('the collateral is sold, not pledged: ownership moves, which separates this agreement from a collateralised loan', () => {
  const r = modelRepurchaseAgreement(DEFAULT);
  assert.equal(r.collateralSoldNotPledged, true);
});

test('the haircut is not a fee, not interest, and not a cost where the seller repurchases', () => {
  const r = modelRepurchaseAgreement(DEFAULT);
  assert.equal(r.haircutIsFee, false);
  assert.equal(r.haircutIsInterest, false);
  assert.equal(r.haircutIsCostOnRepurchase, false);
  assert.equal(r.interestIsFee, false);
});

test('a haircut of zero is stated, not refused: the purchase price is the whole collateral value', () => {
  const r = modelRepurchaseAgreement({ ...DEFAULT, haircutBps: 0 });
  assert.equal(r.purchasePriceAmount, 800000000000n);
  assert.equal(r.haircutAmount, 0n);
  assert.equal(r.repurchaseInterestAmount, 24000000000n);
  assert.equal(r.repurchasePriceAmount, 824000000000n);
});

test('a repo rate of zero is stated, not refused: the repurchase price is the purchase price and the term costs nothing', () => {
  const r = modelRepurchaseAgreement({ ...DEFAULT, repoRateBps: 0 });
  assert.equal(r.repurchaseInterestAmount, 0n);
  assert.equal(r.repurchasePriceAmount, r.purchasePriceAmount);
  assert.equal(r.sellerCostAmount, 0n);
});

test('flooring is exact on a fractional collateral value: the purchase price and the interest each floor', () => {
  const r = modelRepurchaseAgreement({ collateralValue: '333333.333333', haircutBps: 333, repoRateBps: 111, decimals: 6 });
  assert.equal(r.purchasePriceAmount, 322233333333n);
  assert.equal(r.haircutAmount, 11100000000n);
  assert.equal(r.repurchaseInterestAmount, 3576789999n);
  assert.equal(r.repurchasePriceAmount, 325810123332n);
});

test('on a tiny purchase price a stated repo rate can floor the interest to zero, and that is stated, not hidden', () => {
  const r = modelRepurchaseAgreement({ collateralValue: '0.001', haircutBps: 0, repoRateBps: 1, decimals: 6 });
  assert.equal(r.purchasePriceAmount, 1000n);
  assert.equal(r.repurchaseInterestAmount, 0n);
  assert.equal(r.repurchasePriceAmount, 1000n);
});

test('the repo rate is per term as stated: no day-count conversion and no term length enters', () => {
  const r = modelRepurchaseAgreement(DEFAULT);
  assert.equal(r.ratePerTerm, true);
  assert.equal(r.termLengthPriced, false);
});

test('default, collateral price change, margin calls, and rollover are not priced', () => {
  const r = modelRepurchaseAgreement(DEFAULT);
  assert.equal(r.defaultPriced, false);
  assert.equal(r.collateralPriceChangePriced, false);
  assert.equal(r.marginCallPriced, false);
  assert.equal(r.rolloverPriced, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a collateral value of zero is refused', () => {
  assert.throws(() => modelRepurchaseAgreement({ ...DEFAULT, collateralValue: '0' }), /Collateral value must be greater than zero/);
});

test('a haircut of 10000 basis points is refused: it would advance no cash at all', () => {
  assert.throws(() => modelRepurchaseAgreement({ ...DEFAULT, haircutBps: 10000 }), /Haircut must be a whole number of basis points/);
});

test('a repo rate above 10000 basis points is refused, and a haircut that is not a whole number is refused', () => {
  assert.throws(() => modelRepurchaseAgreement({ ...DEFAULT, repoRateBps: 10001 }), /Repo rate must be a whole number of basis points/);
  assert.throws(() => modelRepurchaseAgreement({ ...DEFAULT, haircutBps: 2000.5 }), /Haircut must be a whole number of basis points/);
});

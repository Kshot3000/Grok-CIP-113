import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSecuritiesLending } from '../src/domain.js';

const DEFAULT = { loanValue: '1000000', collateralAmount: '1050000', lendingFeeBps: 250, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, lendingFeeBps: 0 },
  { ...DEFAULT, collateralAmount: '1000000' },
  { ...DEFAULT, collateralAmount: '1000000', lendingFeeBps: 0 },
  { ...DEFAULT, collateralAmount: '1200000', lendingFeeBps: 1000 },
  { loanValue: '333333.333333', collateralAmount: '350000', lendingFeeBps: 111, decimals: 6 },
  { loanValue: '0.001', collateralAmount: '0.001', lendingFeeBps: 1, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { loanValue: '1', collateralAmount: '2', lendingFeeBps: 10000, decimals: 6 },
  { ...DEFAULT, lendingFeeBps: 9999 },
];

test('preload: securities valued at 1000000 lent against collateral of 1050000 at a 250 bps fee state a fee of 25000 and an excess cushion of 50000', () => {
  const r = modelSecuritiesLending(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.loanValue, 1000000000000n);
  assert.equal(r.collateralAmount, 1050000000000n);
  assert.equal(r.lendingFeeBps, 250);
  assert.equal(r.excessCollateralAmount, 50000000000n);
  assert.equal(r.lendingFeeAmount, 25000000000n);
  assert.equal(r.collateralReturnedAmount, 1050000000000n);
  assert.equal(r.borrowerCostAmount, 25000000000n);
});

test('the fee is measured on the loan value actually stated, never on the collateral amount', () => {
  const r = modelSecuritiesLending(DEFAULT);
  assert.equal(r.feeOnLoanValue, true);
  assert.notEqual(r.lendingFeeAmount, 26250000000n);
  assert.equal(r.lendingFeeAmount, r.loanValue * 250n / 10000n);
});

test('the loan value plus the excess collateral is the collateral amount exactly, on every stated case', () => {
  for (const input of CASES) {
    const r = modelSecuritiesLending(input);
    assert.equal(r.loanValue + r.excessCollateralAmount, r.collateralAmount);
    assert.equal(r.loanPlusExcessConserved, true);
  }
});

test('the collateral is returned in full where the securities are returned, and the borrower cost is the fee alone, on every stated case', () => {
  for (const input of CASES) {
    const r = modelSecuritiesLending(input);
    assert.equal(r.collateralReturnedAmount, r.collateralAmount);
    assert.equal(r.collateralReturnedInFull, true);
    assert.equal(r.borrowerCostAmount, r.lendingFeeAmount);
  }
});

test('the securities are loaned, not sold: the same securities are to be returned, which separates this loan from a repurchase agreement', () => {
  const r = modelSecuritiesLending(DEFAULT);
  assert.equal(r.securitiesLoanedNotSold, true);
});

test('the excess collateral is not a fee and not a cost on return, and the lending fee is not interest on a cash loan', () => {
  const r = modelSecuritiesLending(DEFAULT);
  assert.equal(r.excessIsFee, false);
  assert.equal(r.excessIsCostOnReturn, false);
  assert.equal(r.feeIsInterest, false);
});

test('collateral equal to the loan value is stated, not refused: the excess is zero and the fee still stands on the loan value', () => {
  const r = modelSecuritiesLending({ ...DEFAULT, collateralAmount: '1000000' });
  assert.equal(r.excessCollateralAmount, 0n);
  assert.equal(r.lendingFeeAmount, 25000000000n);
  assert.equal(r.collateralReturnedAmount, 1000000000000n);
});

test('a lending fee of zero is stated, not refused: the term costs nothing and the collateral is returned whole', () => {
  const r = modelSecuritiesLending({ ...DEFAULT, lendingFeeBps: 0 });
  assert.equal(r.lendingFeeAmount, 0n);
  assert.equal(r.borrowerCostAmount, 0n);
  assert.equal(r.collateralReturnedAmount, r.collateralAmount);
});

test('flooring is exact on a fractional loan value: the fee floors and the excess is exact', () => {
  const r = modelSecuritiesLending({ loanValue: '333333.333333', collateralAmount: '350000', lendingFeeBps: 111, decimals: 6 });
  assert.equal(r.loanValue, 333333333333n);
  assert.equal(r.excessCollateralAmount, 16666666667n);
  assert.equal(r.lendingFeeAmount, 3699999999n);
});

test('on a tiny loan value a stated fee rate can floor the fee to zero, and that is stated, not hidden', () => {
  const r = modelSecuritiesLending({ loanValue: '0.001', collateralAmount: '0.001', lendingFeeBps: 1, decimals: 6 });
  assert.equal(r.lendingFeeAmount, 0n);
  assert.equal(r.excessCollateralAmount, 0n);
  assert.equal(r.collateralReturnedAmount, 1000n);
});

test('the lending fee rate is per term as stated: no day-count conversion and no term length enters', () => {
  const r = modelSecuritiesLending(DEFAULT);
  assert.equal(r.ratePerTerm, true);
  assert.equal(r.termLengthPriced, false);
});

test('default, price change, margin calls, and early recall are not priced', () => {
  const r = modelSecuritiesLending(DEFAULT);
  assert.equal(r.defaultPriced, false);
  assert.equal(r.priceChangePriced, false);
  assert.equal(r.marginCallPriced, false);
  assert.equal(r.recallPriced, false);
  assert.equal(r.arrangementFeesPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a loan value of zero is refused', () => {
  assert.throws(() => modelSecuritiesLending({ ...DEFAULT, loanValue: '0' }), /Loan value must be greater than zero/);
});

test('collateral below the loan value is refused: the cushion cannot be negative', () => {
  assert.throws(() => modelSecuritiesLending({ ...DEFAULT, collateralAmount: '999999' }), /Collateral must be at least the loan value/);
});

test('a lending fee above 10000 basis points is refused, and a fee that is not a whole number is refused', () => {
  assert.throws(() => modelSecuritiesLending({ ...DEFAULT, lendingFeeBps: 10001 }), /Lending fee must be a whole number of basis points/);
  assert.throws(() => modelSecuritiesLending({ ...DEFAULT, lendingFeeBps: 250.5 }), /Lending fee must be a whole number of basis points/);
});

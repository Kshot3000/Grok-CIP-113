import test from 'node:test';
import assert from 'node:assert/strict';
import { modelGuarantorRecovery, modelLoanGuarantee } from '../src/domain.js';

const DEFAULT = { obligation: '2000', borrowerPaid: '1200', guaranteeCap: '600', borrowerRepaid: '450', decimals: 6 };
const CASES = [['2000', '1200', '600', '450', 6], ['2000', '1200', '600', '600', 6], ['2000', '1200', '600', '0', 6], ['1000', '1000', '500', '0', 6], ['100.25', '40.1', '50', '20.5', 6], ['7', '1', '999', '3', 0]];

test('preload: a guarantor who paid 600 toward a 2000 obligation the borrower paid 1200 of, under a 600 cap, recovers 450 and is still owed 150', () => {
  const r = modelGuarantorRecovery(DEFAULT);
  assert.equal(r.obligationAmount, 2000000000n);
  assert.equal(r.borrowerPaidAmount, 1200000000n);
  assert.equal(r.guaranteeCapAmount, 600000000n);
  assert.equal(r.shortfallAmount, 800000000n);
  assert.equal(r.guarantorPaymentAmount, 600000000n);
  assert.equal(r.lenderReceivedAmount, 1800000000n);
  assert.equal(r.lenderShortfallRemainingAmount, 200000000n);
  assert.equal(r.borrowerOwesGuarantorAmount, 600000000n);
  assert.equal(r.borrowerRepaidAmount, 450000000n);
  assert.equal(r.guarantorRecoveredAmount, 450000000n);
  assert.equal(r.guarantorUnrecoveredAmount, 150000000n);
  assert.equal(r.guarantorNetPaidAmount, 150000000n);
  assert.equal(r.borrowerStillOwesGuarantorAmount, 150000000n);
  assert.equal(r.borrowerStillOwesLenderAmount, 200000000n);
  assert.equal(r.borrowerTotalStillOwedAmount, 350000000n);
  assert.equal(r.guaranteeCalled, true);
  assert.equal(r.recoveryStarted, true);
  assert.equal(r.guarantorFullyRecovered, false);
});

test('the recovery composes the guarantee call unchanged: every call amount is exactly what modelLoanGuarantee states, on every stated case', () => {
  for (const [obligation, borrowerPaid, guaranteeCap, borrowerRepaid, decimals] of CASES) {
    const r = modelGuarantorRecovery({ obligation, borrowerPaid, guaranteeCap, borrowerRepaid, decimals });
    const c = modelLoanGuarantee({ obligation, borrowerPaid, guaranteeCap, decimals });
    assert.equal(r.obligationAmount, c.obligationAmount);
    assert.equal(r.shortfallAmount, c.shortfallAmount);
    assert.equal(r.guarantorPaymentAmount, c.guarantorPaymentAmount);
    assert.equal(r.lenderReceivedAmount, c.lenderReceivedAmount);
    assert.equal(r.lenderShortfallRemainingAmount, c.lenderShortfallRemainingAmount);
    assert.equal(r.borrowerOwesGuarantorAmount, c.borrowerOwesGuarantorAmount);
    assert.equal(r.guaranteeCalled, c.guaranteeCalled);
  }
});

test('the recovery is conserved: the repayment plus what is still owed to the guarantor equals the amount the call stated as owed, on every stated case', () => {
  for (const [obligation, borrowerPaid, guaranteeCap, borrowerRepaid, decimals] of CASES) {
    const r = modelGuarantorRecovery({ obligation, borrowerPaid, guaranteeCap, borrowerRepaid, decimals });
    assert.equal(r.recoveryConserved, true);
    assert.equal(r.borrowerRepaidAmount + r.borrowerStillOwesGuarantorAmount, r.borrowerOwesGuarantorAmount);
    assert.equal(r.guarantorRecoveredAmount, r.borrowerRepaidAmount);
    assert.equal(r.guarantorUnrecoveredAmount, r.borrowerStillOwesGuarantorAmount);
    assert.equal(r.guarantorNetPaidAmount, r.guarantorUnrecoveredAmount);
  }
});

test('the shortfall is still accounted: the repayment plus everything still owed, to the guarantor and the lender together, equals the shortfall, on every stated case', () => {
  for (const [obligation, borrowerPaid, guaranteeCap, borrowerRepaid, decimals] of CASES) {
    const r = modelGuarantorRecovery({ obligation, borrowerPaid, guaranteeCap, borrowerRepaid, decimals });
    assert.equal(r.shortfallStillAccounted, true);
    assert.equal(r.borrowerRepaidAmount + r.borrowerTotalStillOwedAmount, r.shortfallAmount);
    assert.equal(r.borrowerStillOwesGuarantorAmount + r.borrowerStillOwesLenderAmount, r.borrowerTotalStillOwedAmount);
  }
});

test('the repayment is measured on the amount owed to the guarantor, never on the whole obligation or the whole shortfall', () => {
  const r = modelGuarantorRecovery(DEFAULT);
  assert.equal(r.recoveryMeasuredOnAmountOwed, true);
  // The base is the 600 owed to the guarantor: not the 2000 obligation and not the 800 shortfall.
  assert.equal(r.borrowerOwesGuarantorAmount, 600000000n);
  assert.notEqual(r.borrowerOwesGuarantorAmount, r.obligationAmount);
  assert.notEqual(r.borrowerOwesGuarantorAmount, r.shortfallAmount);
  // A repayment of the whole shortfall (800) is refused even though it is below the obligation: only 600 of it is owed to the guarantor.
  assert.throws(() => modelGuarantorRecovery({ ...DEFAULT, borrowerRepaid: '800' }), /cannot exceed the amount owed to the guarantor/);
});

test('repaying the guarantor does not reduce what the borrower still owes the lender, at any repayment amount', () => {
  for (const borrowerRepaid of ['0', '1', '450', '599', '600']) {
    const r = modelGuarantorRecovery({ ...DEFAULT, borrowerRepaid });
    assert.equal(r.repaymentReducesLenderDebt, false);
    assert.equal(r.borrowerStillOwesLenderAmount, 200000000n);
    assert.equal(r.lenderReceivedAmount, 1800000000n);
  }
});

test('a full repayment recovers the guarantor whole: nothing is still owed to the guarantor, and the lender remainder still stands', () => {
  const r = modelGuarantorRecovery({ ...DEFAULT, borrowerRepaid: '600' });
  assert.equal(r.guarantorFullyRecovered, true);
  assert.equal(r.guarantorUnrecoveredAmount, 0n);
  assert.equal(r.guarantorNetPaidAmount, 0n);
  assert.equal(r.borrowerStillOwesGuarantorAmount, 0n);
  assert.equal(r.borrowerStillOwesLenderAmount, 200000000n);
  assert.equal(r.borrowerTotalStillOwedAmount, 200000000n);
});

test('where the cap reached the whole shortfall, a full repayment leaves the borrower owing nothing to anyone', () => {
  const r = modelGuarantorRecovery({ obligation: '1000', borrowerPaid: '600', guaranteeCap: '500', borrowerRepaid: '400', decimals: 6 });
  assert.equal(r.borrowerOwesGuarantorAmount, 400000000n);
  assert.equal(r.guarantorFullyRecovered, true);
  assert.equal(r.borrowerStillOwesLenderAmount, 0n);
  assert.equal(r.borrowerTotalStillOwedAmount, 0n);
});

test('a repayment of zero is stated, not refused: the guarantor has recovered nothing and the whole amount owed stands', () => {
  const r = modelGuarantorRecovery({ ...DEFAULT, borrowerRepaid: '0' });
  assert.equal(r.recoveryStarted, false);
  assert.equal(r.guarantorRecoveredAmount, 0n);
  assert.equal(r.guarantorUnrecoveredAmount, 600000000n);
  assert.equal(r.guarantorNetPaidAmount, 600000000n);
  assert.equal(r.borrowerTotalStillOwedAmount, 800000000n);
  assert.equal(r.guarantorFullyRecovered, false);
});

test('where the guarantee was never called there is nothing owed to the guarantor and nothing to recover', () => {
  const r = modelGuarantorRecovery({ obligation: '1000', borrowerPaid: '1000', guaranteeCap: '500', borrowerRepaid: '0', decimals: 6 });
  assert.equal(r.guaranteeCalled, false);
  assert.equal(r.borrowerOwesGuarantorAmount, 0n);
  assert.equal(r.guarantorRecoveredAmount, 0n);
  assert.equal(r.guarantorUnrecoveredAmount, 0n);
  assert.equal(r.borrowerTotalStillOwedAmount, 0n);
  assert.equal(r.recoveryStarted, false);
  // And any repayment at all is refused: there is no debt to the guarantor to repay.
  assert.throws(() => modelGuarantorRecovery({ obligation: '1000', borrowerPaid: '1000', guaranteeCap: '500', borrowerRepaid: '1', decimals: 6 }), /cannot exceed the amount owed to the guarantor/);
});

test('a repayment above the amount owed to the guarantor is refused: a borrower cannot repay more of a debt than the debt itself', () => {
  assert.throws(() => modelGuarantorRecovery({ ...DEFAULT, borrowerRepaid: '600.01' }), /Borrower repaid to the guarantor cannot exceed the amount owed to the guarantor/);
  assert.throws(() => modelGuarantorRecovery({ ...DEFAULT, borrowerRepaid: '2000' }), /Borrower repaid to the guarantor cannot exceed the amount owed to the guarantor/);
});

test('the call refusals carry through the composition: an obligation of zero, a cap of zero, and a payment above the obligation are all refused', () => {
  assert.throws(() => modelGuarantorRecovery({ obligation: '0', borrowerPaid: '0', guaranteeCap: '500', borrowerRepaid: '0', decimals: 6 }), /Obligation must be greater than zero/);
  assert.throws(() => modelGuarantorRecovery({ obligation: '1000', borrowerPaid: '600', guaranteeCap: '0', borrowerRepaid: '0', decimals: 6 }), /Guarantee cap must be greater than zero/);
  assert.throws(() => modelGuarantorRecovery({ obligation: '1000', borrowerPaid: '1000.01', guaranteeCap: '500', borrowerRepaid: '0', decimals: 6 }), /Borrower paid cannot exceed the stated obligation/);
});

test('fractional amounts state exactly in BigInt: a 50 payment under a 50 cap on a 100.25 obligation paid 40.1, repaid 20.5, leaves 29.5 unrecovered', () => {
  const r = modelGuarantorRecovery({ obligation: '100.25', borrowerPaid: '40.1', guaranteeCap: '50', borrowerRepaid: '20.5', decimals: 6 });
  assert.equal(r.borrowerOwesGuarantorAmount, 50000000n);
  assert.equal(r.guarantorUnrecoveredAmount, 29500000n);
  assert.equal(r.borrowerStillOwesLenderAmount, 10150000n);
  assert.equal(r.borrowerTotalStillOwedAmount, 39650000n);
});

test('the unrecovered amount never exceeds the guarantor payment and the recovered amount never exceeds the amount owed, across stated cases', () => {
  for (const [obligation, borrowerPaid, guaranteeCap, borrowerRepaid, decimals] of CASES) {
    const r = modelGuarantorRecovery({ obligation, borrowerPaid, guaranteeCap, borrowerRepaid, decimals });
    assert.ok(r.guarantorUnrecoveredAmount <= r.guarantorPaymentAmount);
    assert.ok(r.guarantorRecoveredAmount <= r.borrowerOwesGuarantorAmount);
    assert.ok(r.borrowerTotalStillOwedAmount <= r.shortfallAmount);
  }
});

test('the repayment is not a fee: it is the borrower repaying their own moved debt', () => {
  const r = modelGuarantorRecovery(DEFAULT);
  assert.equal(r.repaymentIsFee, false);
});

test('what is not priced stays unpriced: interest on the amount owed, collection, forgiveness, collateral recovery, fees, and taxes', () => {
  const r = modelGuarantorRecovery(DEFAULT);
  assert.equal(r.interestPriced, false);
  assert.equal(r.collectionPriced, false);
  assert.equal(r.forgivenessPriced, false);
  assert.equal(r.collateralRecoveryPriced, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.taxesPriced, false);
});

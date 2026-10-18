import test from 'node:test';
import assert from 'node:assert/strict';
import { modelLoanGuarantee } from '../src/domain.js';

const DEFAULT = { obligation: '1000', borrowerPaid: '600', guaranteeCap: '500', decimals: 6 };

test('preload: an obligation of 1000 on which the borrower paid 600, under a guarantee cap of 500, states a 400 shortfall the guarantor pays whole', () => {
  const r = modelLoanGuarantee(DEFAULT);
  assert.equal(r.obligationAmount, 1000000000n);
  assert.equal(r.borrowerPaidAmount, 600000000n);
  assert.equal(r.guaranteeCapAmount, 500000000n);
  assert.equal(r.shortfallAmount, 400000000n);
  assert.equal(r.guarantorPaymentAmount, 400000000n);
  assert.equal(r.lenderReceivedAmount, 1000000000n);
  assert.equal(r.lenderShortfallRemainingAmount, 0n);
  assert.equal(r.borrowerOwesGuarantorAmount, 400000000n);
  assert.equal(r.borrowerOwedTotalAfterAmount, 400000000n);
  assert.equal(r.guaranteeCalled, true);
  assert.equal(r.capBinds, false);
  assert.equal(r.lenderMadeWhole, true);
});

test('the shortfall identity: paid plus shortfall is the obligation, and the lender receives the paid part plus the guarantor payment', () => {
  for (const [obligation, borrowerPaid, guaranteeCap, decimals] of [['1000', '600', '500', 6], ['1000', '600', '300', 6], ['1000', '0', '500', 6], ['1000', '1000', '500', 6], ['100.25', '40.1', '50', 6], ['7', '1', '999', 0]]) {
    const r = modelLoanGuarantee({ obligation, borrowerPaid, guaranteeCap, decimals });
    assert.equal(r.borrowerPaidAmount + r.shortfallAmount, r.obligationAmount);
    assert.equal(r.lenderReceivedAmount, r.borrowerPaidAmount + r.guarantorPaymentAmount);
    assert.equal(r.lenderReceivedAmount + r.lenderShortfallRemainingAmount, r.obligationAmount);
  }
});

test('the payment is measured on the shortfall, never on the whole obligation: the preload pays 400, not the 500 cap the whole obligation would suggest', () => {
  const r = modelLoanGuarantee(DEFAULT);
  assert.equal(r.paymentMeasuredOnShortfall, true);
  assert.equal(r.guarantorPaymentAmount, 400000000n);
  assert.notEqual(r.guarantorPaymentAmount, r.guaranteeCapAmount);
  // With nothing paid, the shortfall IS the whole obligation and the payment is the cap alone.
  const unpaid = modelLoanGuarantee({ obligation: '1000', borrowerPaid: '0', guaranteeCap: '500', decimals: 6 });
  assert.equal(unpaid.shortfallAmount, unpaid.obligationAmount);
  assert.equal(unpaid.guarantorPaymentAmount, 500000000n);
});

test('the shortfall is conserved: what the borrower owes the guarantor plus what the borrower still owes the lender equals the shortfall, on every stated case', () => {
  for (const [obligation, borrowerPaid, guaranteeCap, decimals] of [['1000', '600', '500', 6], ['1000', '600', '300', 6], ['1000', '0', '500', 6], ['1000', '1000', '500', 6], ['100.25', '40.1', '50', 6], ['7', '1', '999', 0]]) {
    const r = modelLoanGuarantee({ obligation, borrowerPaid, guaranteeCap, decimals });
    assert.equal(r.shortfallConserved, true);
    assert.equal(r.borrowerOwesGuarantorAmount + r.lenderShortfallRemainingAmount, r.shortfallAmount);
    assert.equal(r.borrowerOwedTotalAfterAmount, r.shortfallAmount);
  }
});

test('the guarantor payment does not extinguish the debt: the borrower owes the guarantor exactly what the guarantor paid', () => {
  const r = modelLoanGuarantee(DEFAULT);
  assert.equal(r.debtExtinguished, false);
  assert.equal(r.debtMovesToGuarantor, true);
  assert.equal(r.borrowerOwesGuarantorAmount, r.guarantorPaymentAmount);
  // Even where the lender is made whole, the borrower's whole remaining debt stands — now against the guarantor.
  assert.equal(r.lenderMadeWhole, true);
  assert.equal(r.borrowerOwedTotalAfterAmount, 400000000n);
});

test('where the cap binds, the guarantor pays the cap, the lender is left short, and the borrower owes both sides', () => {
  const r = modelLoanGuarantee({ obligation: '1000', borrowerPaid: '600', guaranteeCap: '300', decimals: 6 });
  assert.equal(r.guarantorPaymentAmount, 300000000n);
  assert.equal(r.capBinds, true);
  assert.equal(r.capFullyUsed, true);
  assert.equal(r.lenderReceivedAmount, 900000000n);
  assert.equal(r.lenderShortfallRemainingAmount, 100000000n);
  assert.equal(r.lenderMadeWhole, false);
  assert.equal(r.borrowerOwesGuarantorAmount, 300000000n);
  assert.equal(r.borrowerOwedTotalAfterAmount, 400000000n);
});

test('the lender is made whole exactly when the cap reaches the shortfall', () => {
  for (const cap of ['400', '500', '10000']) {
    const r = modelLoanGuarantee({ obligation: '1000', borrowerPaid: '600', guaranteeCap: cap, decimals: 6 });
    assert.equal(r.lenderMadeWhole, true);
    assert.equal(r.guarantorPaymentAmount, 400000000n);
    assert.equal(r.capBinds, false);
  }
  const exact = modelLoanGuarantee({ obligation: '1000', borrowerPaid: '600', guaranteeCap: '400', decimals: 6 });
  assert.equal(exact.capFullyUsed, true);
  const under = modelLoanGuarantee({ obligation: '1000', borrowerPaid: '600', guaranteeCap: '399', decimals: 6 });
  assert.equal(under.lenderMadeWhole, false);
  assert.equal(under.lenderShortfallRemainingAmount, 1000000n);
});

test('the payment never exceeds the cap and never exceeds the shortfall, across stated cases', () => {
  for (const [obligation, borrowerPaid, guaranteeCap] of [['1000', '600', '500'], ['1000', '600', '300'], ['1000', '0', '1'], ['1000', '999', '999'], ['50', '49', '2'], ['1000', '1000', '500']]) {
    const r = modelLoanGuarantee({ obligation, borrowerPaid, guaranteeCap, decimals: 6 });
    assert.ok(r.guarantorPaymentAmount <= r.guaranteeCapAmount);
    assert.ok(r.guarantorPaymentAmount <= r.shortfallAmount);
  }
});

test('a borrower who paid the whole obligation states no shortfall: the guarantee is not called and the guarantor pays nothing', () => {
  const r = modelLoanGuarantee({ obligation: '1000', borrowerPaid: '1000', guaranteeCap: '500', decimals: 6 });
  assert.equal(r.shortfallAmount, 0n);
  assert.equal(r.guaranteeCalled, false);
  assert.equal(r.guarantorPaymentAmount, 0n);
  assert.equal(r.borrowerOwesGuarantorAmount, 0n);
  assert.equal(r.debtMovesToGuarantor, false);
  assert.equal(r.lenderReceivedAmount, r.obligationAmount);
  assert.equal(r.lenderMadeWhole, true);
});

test('a borrower payment of zero is stated, not refused: the shortfall is the whole obligation and the guarantor pays the smaller of it and the cap', () => {
  const r = modelLoanGuarantee({ obligation: '1000', borrowerPaid: '0', guaranteeCap: '500', decimals: 6 });
  assert.equal(r.guaranteeCalled, true);
  assert.equal(r.shortfallAmount, 1000000000n);
  assert.equal(r.guarantorPaymentAmount, 500000000n);
  assert.equal(r.lenderReceivedAmount, 500000000n);
  assert.equal(r.lenderShortfallRemainingAmount, 500000000n);
  assert.equal(r.borrowerOwesGuarantorAmount, 500000000n);
});

test('fractional amounts state exactly in BigInt: a 100.25 obligation paid 40.1 under a 50 cap leaves a 60.15 shortfall, of which the guarantor pays 50', () => {
  const r = modelLoanGuarantee({ obligation: '100.25', borrowerPaid: '40.1', guaranteeCap: '50', decimals: 6 });
  assert.equal(r.shortfallAmount, 60150000n);
  assert.equal(r.guarantorPaymentAmount, 50000000n);
  assert.equal(r.lenderReceivedAmount, 90100000n);
  assert.equal(r.lenderShortfallRemainingAmount, 10150000n);
  assert.equal(r.borrowerOwesGuarantorAmount, 50000000n);
  assert.equal(r.capBinds, true);
});

test('a payment above the obligation is refused: an amount paid toward an obligation cannot exceed the obligation it was paid toward', () => {
  assert.throws(() => modelLoanGuarantee({ obligation: '1000', borrowerPaid: '1000.01', guaranteeCap: '500', decimals: 6 }), /Borrower paid cannot exceed the stated obligation/);
  assert.throws(() => modelLoanGuarantee({ obligation: '1000', borrowerPaid: '2000', guaranteeCap: '500', decimals: 6 }), /Borrower paid cannot exceed the stated obligation/);
});

test('an obligation of zero and a guarantee cap of zero are refused: a guarantee of nothing owed, or with no promise, is no guarantee', () => {
  assert.throws(() => modelLoanGuarantee({ obligation: '0', borrowerPaid: '0', guaranteeCap: '500', decimals: 6 }), /Obligation must be greater than zero/);
  assert.throws(() => modelLoanGuarantee({ obligation: '1000', borrowerPaid: '600', guaranteeCap: '0', decimals: 6 }), /Guarantee cap must be greater than zero/);
});

test('the guarantor payment is not a fee, and any fee for standing behind the obligation is not priced', () => {
  const r = modelLoanGuarantee(DEFAULT);
  assert.equal(r.paymentIsFee, false);
  assert.equal(r.guaranteeFeePriced, false);
});

test('what is not priced stays unpriced: interest separation, default determination, guarantor solvency, collateral, reimbursement collection, fees, and taxes', () => {
  const r = modelLoanGuarantee(DEFAULT);
  assert.equal(r.interestPriced, false);
  assert.equal(r.defaultDeterminationPriced, false);
  assert.equal(r.guarantorSolvencyPriced, false);
  assert.equal(r.collateralPriced, false);
  assert.equal(r.reimbursementCollectedPriced, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.taxesPriced, false);
});

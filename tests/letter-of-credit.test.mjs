import test from 'node:test';
import assert from 'node:assert/strict';
import { modelLetterOfCreditDrawing } from '../src/domain.js';

const DEFAULT = { creditAmount: '500000', drawingAmount: '300000', feeBps: 100, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, feeBps: 0 },
  { ...DEFAULT, drawingAmount: '500000' },
  { ...DEFAULT, drawingAmount: '500000', feeBps: 0 },
  { ...DEFAULT, drawingAmount: '100000', feeBps: 1000 },
  { creditAmount: '500000', drawingAmount: '333333.333333', feeBps: 111, decimals: 6 },
  { creditAmount: '1', drawingAmount: '0.001', feeBps: 1, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { creditAmount: '2', drawingAmount: '1', feeBps: 10000, decimals: 6 },
  { ...DEFAULT, feeBps: 9999 },
];

test('preload: a drawing of 300000 under a credit of 500000 at a 100 bps fee states a fee of 3000, 303000 owed by the applicant, and 200000 remaining', () => {
  const r = modelLetterOfCreditDrawing(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.creditAmount, 500000000000n);
  assert.equal(r.drawingAmount, 300000000000n);
  assert.equal(r.feeBps, 100);
  assert.equal(r.bankFeeAmount, 3000000000n);
  assert.equal(r.beneficiaryReceiptAmount, 300000000000n);
  assert.equal(r.applicantOwesAmount, 303000000000n);
  assert.equal(r.remainingCreditAmount, 200000000000n);
});

test('the fee is measured on the drawing actually stated, never on the whole credit amount', () => {
  const r = modelLetterOfCreditDrawing(DEFAULT);
  assert.equal(r.feeOnDrawing, true);
  assert.notEqual(r.bankFeeAmount, 5000000000n);
  assert.equal(r.bankFeeAmount, r.drawingAmount * 100n / 10000n);
});

test('the drawing plus the remaining credit is the credit amount exactly, on every stated case', () => {
  for (const input of CASES) {
    const r = modelLetterOfCreditDrawing(input);
    assert.equal(r.drawingAmount + r.remainingCreditAmount, r.creditAmount);
    assert.equal(r.drawingPlusRemainingConserved, true);
  }
});

test('the drawing plus the fee is what the applicant owes exactly, and the beneficiary receives the whole drawing, on every stated case', () => {
  for (const input of CASES) {
    const r = modelLetterOfCreditDrawing(input);
    assert.equal(r.drawingAmount + r.bankFeeAmount, r.applicantOwesAmount);
    assert.equal(r.applicantOwesConserved, true);
    assert.equal(r.beneficiaryReceiptAmount, r.drawingAmount);
    assert.equal(r.feeNotDeductedFromDrawing, true);
  }
});

test('the bank pays the beneficiary, not the applicant: the applicant receives none of the drawing', () => {
  const r = modelLetterOfCreditDrawing(DEFAULT);
  assert.equal(r.paidToBeneficiaryNotApplicant, true);
});

test('the fee is not part of the drawing, the payment is not on a default, no receivable is sold, and nothing is held in escrow', () => {
  const r = modelLetterOfCreditDrawing(DEFAULT);
  assert.equal(r.feeIsDrawing, false);
  assert.equal(r.paymentOnDefault, false);
  assert.equal(r.receivableSold, false);
  assert.equal(r.fundsHeldInEscrow, false);
  assert.equal(r.partialDrawingAboveCredit, false);
});

test('a drawing equal to the whole credit amount is stated, not refused: nothing remains and the fee still stands on the drawing', () => {
  const r = modelLetterOfCreditDrawing({ ...DEFAULT, drawingAmount: '500000' });
  assert.equal(r.remainingCreditAmount, 0n);
  assert.equal(r.bankFeeAmount, 5000000000n);
  assert.equal(r.beneficiaryReceiptAmount, 500000000000n);
});

test('a fee of zero is stated, not refused: the applicant owes the drawing alone and the beneficiary still receives it whole', () => {
  const r = modelLetterOfCreditDrawing({ ...DEFAULT, feeBps: 0 });
  assert.equal(r.bankFeeAmount, 0n);
  assert.equal(r.applicantOwesAmount, 300000000000n);
  assert.equal(r.beneficiaryReceiptAmount, 300000000000n);
});

test('flooring is exact on a fractional drawing: the fee floors and the remaining credit is exact', () => {
  const r = modelLetterOfCreditDrawing({ creditAmount: '500000', drawingAmount: '333333.333333', feeBps: 111, decimals: 6 });
  assert.equal(r.drawingAmount, 333333333333n);
  assert.equal(r.bankFeeAmount, 3699999999n);
  assert.equal(r.applicantOwesAmount, 337033333332n);
  assert.equal(r.remainingCreditAmount, 166666666667n);
});

test('on a tiny drawing a stated fee rate can floor the fee to zero, and that is stated, not hidden', () => {
  const r = modelLetterOfCreditDrawing({ creditAmount: '1', drawingAmount: '0.001', feeBps: 1, decimals: 6 });
  assert.equal(r.bankFeeAmount, 0n);
  assert.equal(r.beneficiaryReceiptAmount, 1000n);
  assert.equal(r.remainingCreditAmount, 999000n);
});

test('a fee of 10000 basis points is stated: the fee equals the drawing and the applicant owes twice the drawing', () => {
  const r = modelLetterOfCreditDrawing({ creditAmount: '2', drawingAmount: '1', feeBps: 10000, decimals: 6 });
  assert.equal(r.bankFeeAmount, 1000000n);
  assert.equal(r.applicantOwesAmount, 2000000n);
  assert.equal(r.beneficiaryReceiptAmount, 1000000n);
});

test('compliance of the presentation, expiry, later drawings, interest, and reimbursement timing are not priced', () => {
  const r = modelLetterOfCreditDrawing(DEFAULT);
  assert.equal(r.documentsPriced, false);
  assert.equal(r.expiryPriced, false);
  assert.equal(r.laterDrawingsPriced, false);
  assert.equal(r.interestPriced, false);
  assert.equal(r.reimbursementTimingPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a credit amount of zero is refused', () => {
  assert.throws(() => modelLetterOfCreditDrawing({ ...DEFAULT, creditAmount: '0' }), /Credit amount must be greater than zero/);
});

test('a drawing of zero is refused: there is no payment to state', () => {
  assert.throws(() => modelLetterOfCreditDrawing({ ...DEFAULT, drawingAmount: '0' }), /Drawing amount must be greater than zero/);
});

test('a drawing above the credit amount is refused whole, and a fee above 10000 basis points or not a whole number is refused', () => {
  assert.throws(() => modelLetterOfCreditDrawing({ ...DEFAULT, drawingAmount: '500001' }), /Drawing must not exceed the credit amount/);
  assert.throws(() => modelLetterOfCreditDrawing({ ...DEFAULT, feeBps: 10001 }), /Fee must be a whole number of basis points/);
  assert.throws(() => modelLetterOfCreditDrawing({ ...DEFAULT, feeBps: 100.5 }), /Fee must be a whole number of basis points/);
});

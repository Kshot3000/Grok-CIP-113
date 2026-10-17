import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelInstallmentPurchase, modelInstallmentProgress } from '../src/domain.js';

// Installment plan progress model (v1.247): the installment
// axis's second moment — the purchase model states a plan at
// its start; this model composes it UNCHANGED and states the
// position after a stated number of installments have been
// paid. Paid-so-far is counted at the plan's own amounts
// (regular installments, the final at its own amount), the
// remaining balance is the payoff amount exactly — no
// early-payoff discount, penalty, or fee refund invented —
// and a fully paid plan is complete, a distinct outcome.
const DEFAULT = { purchasePrice: '1000', downPayment: '100', decimals: 6, installments: 7, serviceFeeBps: 250, installmentsPaid: 3 };

test('the preloaded position: 3 of 7 installments paid on the 1000 plan — 395.357142 paid in installments, 495.357142 in all, 527.142858 remains', () => {
  const r = modelInstallmentProgress(DEFAULT);
  assert.equal(r.installmentsPaidAmount, 395357142n);
  assert.equal(r.totalPaidSoFar, 495357142n);
  assert.equal(r.remainingBalance, 527142858n);
  assert.equal(r.installmentsRemaining, 4);
  assert.equal(r.nextInstallment, 131785714n);
});

test('identities hold across positions: paid plus remaining is the installment total, down plus paid plus remaining is the total cost, and the counts sum to the plan', () => {
  const cases = [
    DEFAULT,
    { ...DEFAULT, installmentsPaid: 0 },
    { ...DEFAULT, installmentsPaid: 6 },
    { ...DEFAULT, installmentsPaid: 7 },
    { purchasePrice: '777', downPayment: '77', decimals: 0, installments: 7, serviceFeeBps: 333, installmentsPaid: 2 },
    { purchasePrice: '9007199254740993', downPayment: '1', decimals: 0, installments: 2, serviceFeeBps: 0, installmentsPaid: 1 },
  ];
  for (const c of cases) {
    const r = modelInstallmentProgress(c);
    assert.equal(r.installmentsPaidAmount + r.remainingBalance, r.installmentTotal);
    assert.equal(r.downPayment + r.installmentsPaidAmount + r.remainingBalance, r.totalCost);
    assert.equal(r.installmentsPaid + r.installmentsRemaining, r.installments);
    assert.equal(r.totalPaidSoFar, r.downPayment + r.installmentsPaidAmount);
  }
});

test('the plan terms are the base model unchanged: progress on a plan states the same financed amount, fee, split, and total cost as the purchase model', () => {
  const { installmentsPaid, ...plan } = DEFAULT;
  const b = modelInstallmentPurchase(plan);
  const r = modelInstallmentProgress(DEFAULT);
  assert.equal(r.financedAmount, b.financedAmount);
  assert.equal(r.serviceFee, b.serviceFee);
  assert.equal(r.regularInstallment, b.regularInstallment);
  assert.equal(r.finalInstallment, b.finalInstallment);
  assert.equal(r.totalCost, b.totalCost);
});

test('paid installments are counted at the regular amount: 3 paid on the preload is 3 times 131.785714, and the remaining balance still contains the final installment whole', () => {
  const r = modelInstallmentProgress(DEFAULT);
  assert.equal(r.installmentsPaidAmount, 3n * r.regularInstallment);
  assert.equal(r.remainingBalance - r.finalInstallment, 3n * r.regularInstallment);
});

test('paying off now costs exactly the remaining balance on every position — no early-payoff discount, penalty, or fee refund is priced', () => {
  for (const paid of [0, 1, 3, 6, 7]) {
    const r = modelInstallmentProgress({ ...DEFAULT, installmentsPaid: paid });
    assert.equal(r.payoffAmount, r.remainingBalance);
    assert.equal(r.payoffIsRemainingBalance, true);
  }
});

test('with no installment paid, the whole installment total remains and only the down payment has been paid', () => {
  const r = modelInstallmentProgress({ ...DEFAULT, installmentsPaid: 0 });
  assert.equal(r.nonePaid, true);
  assert.equal(r.installmentsPaidAmount, 0n);
  assert.equal(r.totalPaidSoFar, r.downPayment);
  assert.equal(r.remainingBalance, r.installmentTotal);
  assert.equal(r.nextInstallment, r.regularInstallment);
});

test('when only the final installment remains, the next payment is the final amount with its remainder — 131.785716 on the preload after 6 paid', () => {
  const r = modelInstallmentProgress({ ...DEFAULT, installmentsPaid: 6 });
  assert.equal(r.finalInstallmentNext, true);
  assert.equal(r.installmentsRemaining, 1);
  assert.equal(r.nextInstallment, 131785716n);
  assert.equal(r.remainingBalance, 131785716n);
  assert.equal(r.installmentsPaidAmount, 790714284n);
});

test('a fully paid plan is complete: the paid amount is the whole installment total including the remainder — not 7 regular installments, which would fall 2 base units short', () => {
  const r = modelInstallmentProgress({ ...DEFAULT, installmentsPaid: 7 });
  assert.equal(r.planComplete, true);
  assert.equal(r.installmentsPaidAmount, 922500000n);
  assert.notEqual(r.installmentsPaidAmount, 7n * r.regularInstallment);
  assert.equal(r.totalPaidSoFar, r.totalCost);
});

test('a complete plan owes nothing: remaining balance, payoff, and next installment are all zero — zero because nothing is left, not because a discount was given', () => {
  const r = modelInstallmentProgress({ ...DEFAULT, installmentsPaid: 7 });
  assert.equal(r.remainingBalance, 0n);
  assert.equal(r.payoffAmount, 0n);
  assert.equal(r.nextInstallment, 0n);
  assert.equal(r.installmentsRemaining, 0);
});

test('shares are derived from the amounts against the total cost: on the preload after 3 paid, paid is a 4844.56 share and remaining a 5155.43 share of the 1022.5 total', () => {
  const r = modelInstallmentProgress(DEFAULT);
  assert.equal(r.paidShareBpsText, '4844.56');
  assert.equal(r.remainingShareBpsText, '5155.43');
});

test('on the no-decimals 777 case at 333 basis points, 2 paid counts 206 in installments, 283 in all, and 517 remains, with shares 3537.50 and 6462.50 of the 800 total', () => {
  const r = modelInstallmentProgress({ purchasePrice: '777', downPayment: '77', decimals: 0, installments: 7, serviceFeeBps: 333, installmentsPaid: 2 });
  assert.equal(r.installmentsPaidAmount, 206n);
  assert.equal(r.totalPaidSoFar, 283n);
  assert.equal(r.remainingBalance, 517n);
  assert.equal(r.nextInstallment, 103n);
  assert.equal(r.paidShareBpsText, '3537.50');
  assert.equal(r.remainingShareBpsText, '6462.50');
});

test('amounts beyond float precision stay exact: on the 2^53+1 plan, 1 of 2 paid leaves exactly half — 4503599627370496 — and the final installment is next', () => {
  const r = modelInstallmentProgress({ purchasePrice: '9007199254740993', downPayment: '1', decimals: 0, installments: 2, serviceFeeBps: 0, installmentsPaid: 1 });
  assert.equal(r.installmentsPaidAmount, 4503599627370496n);
  assert.equal(r.remainingBalance, 4503599627370496n);
  assert.equal(r.nextInstallment, 4503599627370496n);
  assert.equal(r.finalInstallmentNext, true);
});

test('a single-installment plan is complete after its one payment and unpaid before it', () => {
  const before = modelInstallmentProgress({ ...DEFAULT, installments: 1, installmentsPaid: 0 });
  assert.equal(before.finalInstallmentNext, true);
  assert.equal(before.nextInstallment, before.installmentTotal);
  const after = modelInstallmentProgress({ ...DEFAULT, installments: 1, installmentsPaid: 1 });
  assert.equal(after.planComplete, true);
  assert.equal(after.remainingBalance, 0n);
});

test('paying more installments than the plan has is refused — a position beyond the end of the plan does not exist', () => {
  assert.throws(() => modelInstallmentProgress({ ...DEFAULT, installmentsPaid: 8 }), /between zero and the number of installments/);
});

test('a negative or fractional paid count is refused — installments are paid whole or not at all', () => {
  assert.throws(() => modelInstallmentProgress({ ...DEFAULT, installmentsPaid: -1 }), /between zero and the number of installments/);
  assert.throws(() => modelInstallmentProgress({ ...DEFAULT, installmentsPaid: 2.5 }), /between zero and the number of installments/);
});

test('the base plan refusals still govern: a down payment covering the whole price is refused through the progress model', () => {
  assert.throws(() => modelInstallmentProgress({ ...DEFAULT, downPayment: '1000' }), /leaves nothing to pay in installments/);
});

test('the default position is 3 installments paid when none is stated', () => {
  const { installmentsPaid, ...rest } = DEFAULT;
  const r = modelInstallmentProgress(rest);
  assert.equal(r.installmentsPaid, 3);
  assert.equal(r.installmentsPaidAmount, 395357142n);
});

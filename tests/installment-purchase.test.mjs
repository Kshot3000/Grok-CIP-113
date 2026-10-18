import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelInstallmentPurchase } from '../src/domain.js';

// Installment purchase model (v1.271): a NEW axis — a purchase
// paid partly now and the rest in stated installments. The fee
// is floored on the FINANCED amount (its stated base, never the
// whole price), the split is floored on the regular installment
// with the final installment absorbing the remainder so the
// installments sum exactly, and the total cost is the price
// plus the fee exactly — no interest is invented. Shares are
// derived from the amounts against the price.
const DEFAULT = { purchasePrice: '1000', downPayment: '100', decimals: 6, installments: 7, serviceFeeBps: 250 };

test('the preloaded plan: 100 down on a 1000 purchase finances 900, the 250 basis-point fee on the financed amount is 22.5, and 922.5 splits over 7 installments', () => {
  const r = modelInstallmentPurchase(DEFAULT);
  assert.equal(r.financedAmount, 900000000n);
  assert.equal(r.serviceFee, 22500000n);
  assert.equal(r.installmentTotal, 922500000n);
  assert.equal(r.totalCost, 1022500000n);
});

test('identities hold across plans: down plus financed is the price, financed plus fee is the installment total, the split sums exactly, and the total cost is the price plus the fee', () => {
  const cases = [
    DEFAULT,
    { ...DEFAULT, installments: 1 },
    { ...DEFAULT, downPayment: '0', serviceFeeBps: 0 },
    { purchasePrice: '777', downPayment: '77', decimals: 0, installments: 7, serviceFeeBps: 333 },
    { purchasePrice: '5', downPayment: '0', decimals: 0, installments: 7, serviceFeeBps: 0 },
    { purchasePrice: '9007199254740993', downPayment: '1', decimals: 0, installments: 2, serviceFeeBps: 0 },
  ];
  for (const c of cases) {
    const r = modelInstallmentPurchase(c);
    assert.equal(r.downPayment + r.financedAmount, r.purchasePrice);
    assert.equal(r.financedAmount + r.serviceFee, r.installmentTotal);
    assert.equal(r.regularInstallment * BigInt(r.installments - 1) + r.finalInstallment, r.installmentTotal);
    assert.equal(r.downPayment + r.installmentTotal, r.totalCost);
    assert.equal(r.totalCost - r.purchasePrice, r.serviceFee);
    assert.equal(r.extraCostOverPrice, r.serviceFee);
  }
});

test('the fee is charged on the financed amount, never the whole price: on the preload the fee is 22.5 — 250 basis points of the 900 financed — not 25, which is what charging on the 1000 price would take', () => {
  const r = modelInstallmentPurchase(DEFAULT);
  assert.equal(r.serviceFee, 22500000n);
  assert.notEqual(r.serviceFee, 25000000n);
  assert.equal(r.feeOnFinancedShareBpsText, '250.00');
});

test('the split floors the regular installment and the final installment absorbs the remainder: the preload pays 131.785714 six times and 131.785716 last, summing to 922.5 exactly', () => {
  const r = modelInstallmentPurchase(DEFAULT);
  assert.equal(r.regularInstallment, 131785714n);
  assert.equal(r.finalInstallment, 131785716n);
  assert.equal(r.finalAbsorbsRemainder, true);
  assert.equal(r.equalInstallments, false);
});

test('a total that divides exactly pays equal installments: 1000 over 4 with no fee and no down payment pays 250 four times', () => {
  const r = modelInstallmentPurchase({ purchasePrice: '1000', downPayment: '0', decimals: 6, installments: 4, serviceFeeBps: 0 });
  assert.equal(r.regularInstallment, 250000000n);
  assert.equal(r.finalInstallment, 250000000n);
  assert.equal(r.equalInstallments, true);
  assert.equal(r.noDownPayment, true);
  assert.equal(r.noServiceFee, true);
  assert.equal(r.totalCost, 1000000000n);
});

test('a single installment is a single later payment of the whole installment total — the regular and final installments are the same amount', () => {
  const r = modelInstallmentPurchase({ ...DEFAULT, installments: 1 });
  assert.equal(r.singleInstallment, true);
  assert.equal(r.regularInstallment, 922500000n);
  assert.equal(r.finalInstallment, 922500000n);
});

test('with no fee stated the plan costs exactly the price split: the extra cost over paying in full now is zero', () => {
  const r = modelInstallmentPurchase({ purchasePrice: '777', downPayment: '77', decimals: 0, installments: 7, serviceFeeBps: 0 });
  assert.equal(r.serviceFee, 0n);
  assert.equal(r.extraCostOverPrice, 0n);
  assert.equal(r.totalCost, 777n);
  assert.equal(r.installmentTotal, 700n);
});

test('shares are derived from the amounts: on the no-decimals 777 case at 333 basis points, the down payment is a 990.99 share of the price and the fee a 296.01 share', () => {
  const r = modelInstallmentPurchase({ purchasePrice: '777', downPayment: '77', decimals: 0, installments: 7, serviceFeeBps: 333 });
  assert.equal(r.downShareBpsText, '990.99');
  assert.equal(r.financedShareBpsText, '9009.00');
  assert.equal(r.serviceFeeShareBpsText, '296.01');
});

test('the fee floors on the financed amount: on the 777 case the fee is 23, a 328.57 share of the 700 financed against the stated 333 — flooring never rounds the fee up', () => {
  const r = modelInstallmentPurchase({ purchasePrice: '777', downPayment: '77', decimals: 0, installments: 7, serviceFeeBps: 333 });
  assert.equal(r.serviceFee, 23n);
  assert.equal(r.feeOnFinancedShareBpsText, '328.57');
  assert.equal(r.feeFloors, true);
  assert.equal(r.regularInstallment, 103n);
  assert.equal(r.finalInstallment, 105n);
  assert.equal(r.totalCost, 800n);
});

test('a stated fee that floors to zero charges nothing: a 1-unit financed amount at 1 basis point states feeFloorsToZero and the plan costs the price', () => {
  const r = modelInstallmentPurchase({ purchasePrice: '1', downPayment: '0', decimals: 0, installments: 2, serviceFeeBps: 1 });
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.noServiceFee, false);
  assert.equal(r.serviceFee, 0n);
  assert.equal(r.totalCost, 1n);
});

test('a financed total below one base unit per installment states regularInstallmentZero: a 5-unit plan over 7 installments pays nothing six times and 5 in the final installment', () => {
  const r = modelInstallmentPurchase({ purchasePrice: '5', downPayment: '0', decimals: 0, installments: 7, serviceFeeBps: 0 });
  assert.equal(r.regularInstallmentZero, true);
  assert.equal(r.regularInstallment, 0n);
  assert.equal(r.finalInstallment, 5n);
  assert.equal(r.installmentTotal, 5n);
});

test('amounts beyond float precision stay exact: a 2^53+1 price with 1 down and no fee splits 9007199254740992 into two equal installments of 4503599627370496', () => {
  const r = modelInstallmentPurchase({ purchasePrice: '9007199254740993', downPayment: '1', decimals: 0, installments: 2, serviceFeeBps: 0 });
  assert.equal(r.financedAmount, 9007199254740992n);
  assert.equal(r.regularInstallment, 4503599627370496n);
  assert.equal(r.finalInstallment, 4503599627370496n);
  assert.equal(r.totalCost, 9007199254740993n);
  assert.equal(r.financedShareBpsText, '9999.99');
});

test('a down payment covering the whole price is refused — there would be nothing to pay in installments', () => {
  assert.throws(() => modelInstallmentPurchase({ ...DEFAULT, downPayment: '1000' }), /leaves nothing to pay in installments/);
  assert.throws(() => modelInstallmentPurchase({ ...DEFAULT, downPayment: '1001' }), /leaves nothing to pay in installments/);
});

test('a fee taking the whole financed amount is refused: at 10000 basis points the installments would pay twice the financed amount', () => {
  assert.throws(() => modelInstallmentPurchase({ ...DEFAULT, serviceFeeBps: 10000 }), /must not take the whole financed amount/);
});

test('a zero or fractional installment count is refused — a plan pays in a whole number of installments', () => {
  assert.throws(() => modelInstallmentPurchase({ ...DEFAULT, installments: 0 }), /whole number, one or more/);
  assert.throws(() => modelInstallmentPurchase({ ...DEFAULT, installments: 2.5 }), /whole number, one or more/);
});

test('a fee outside 0 to 10000 basis points is refused', () => {
  assert.throws(() => modelInstallmentPurchase({ ...DEFAULT, serviceFeeBps: 10001 }), /between 0 and 10,000/);
  assert.throws(() => modelInstallmentPurchase({ ...DEFAULT, serviceFeeBps: -1 }), /between 0 and 10,000/);
});

test('a purchase price of zero is refused — there is nothing to buy', () => {
  assert.throws(() => modelInstallmentPurchase({ ...DEFAULT, purchasePrice: '0' }), /greater than zero/);
});

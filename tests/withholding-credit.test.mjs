import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelWithholdingCredit } from '../src/domain.js';

// Withholding credit model (v1.235): the withholding
// axis's second moment — a stated credit for amounts
// already withheld, applied against a later payment's
// withholding due. The due is measured on the full gross
// payment first (composing the withholding model,
// v1.217, unchanged); applied is the smaller of the
// credit and the due; cash withheld + applied === due
// and cash withheld + paid over === gross, exactly. The
// credit is never netted off the gross first, is not a
// cash payment, and is not a refund: credit beyond the
// due is never paid out and remains a credit balance.
// No credit origin, validity, expiry, or remaining-
// credit fate priced.
const DEFAULT = { amount: '1000', withholdingRateBps: 2000, creditAmount: '50', decimals: 6 };

test('the preloaded withholding credit: a stated 50 credit against the 200 due on a 1,000 payment at 20% leaves 150 withheld in cash and 850 paid over', () => {
  const r = modelWithholdingCredit(DEFAULT);
  assert.equal(r.amount, 1000000000n);
  assert.equal(r.withholdingRateBps, 2000);
  assert.equal(r.withheldAmount, 200000000n);
  assert.equal(r.netBeforeCreditAmount, 800000000n);
  assert.equal(r.creditAmount, 50000000n);
  assert.equal(r.creditAppliedAmount, 50000000n);
  assert.equal(r.cashWithheldAmount, 150000000n);
  assert.equal(r.netAmount, 850000000n);
  assert.equal(r.creditRemainingAmount, 0n);
  assert.equal(r.creditAppliedShareBpsText, '2500.00');
  assert.equal(r.cashWithheldShareBpsText, '1500.00');
  assert.equal(r.netShareBpsText, '8500.00');
  assert.equal(r.creditPartiallyApplied, true);
  assert.equal(r.creditCoversWithholding, false);
});

test('identities hold across payments: applied plus remaining is the credit, applied plus cash withheld is the due, cash withheld plus paid over is the gross', () => {
  const cases = [
    DEFAULT,
    { amount: '777', withholdingRateBps: 2000, creditAmount: '100', decimals: 0 },
    { amount: '100', withholdingRateBps: 10000, creditAmount: '50', decimals: 6 },
    { amount: '100', withholdingRateBps: 2000, creditAmount: '250', decimals: 6 },
    { amount: '100', withholdingRateBps: 0, creditAmount: '50', decimals: 6 },
    { amount: '0.000001', withholdingRateBps: 2000, creditAmount: '0.000001', decimals: 6 },
    { amount: '9007199254740993', withholdingRateBps: 2000, creditAmount: '1000000000000000', decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelWithholdingCredit(c);
    assert.equal(r.creditAppliedAmount + r.creditRemainingAmount, r.creditAmount);
    assert.equal(r.creditAppliedAmount + r.cashWithheldAmount, r.withheldAmount);
    assert.equal(r.cashWithheldAmount + r.netAmount, r.amount);
    assert.ok(r.creditAppliedAmount <= r.withheldAmount);
    assert.ok(r.netAmount <= r.amount);
  }
});

test('netting the credit off the gross payment before withholding would understate the due: the due belongs on the full payment', () => {
  const r = modelWithholdingCredit(DEFAULT);
  const dueOnReducedPayment = (r.amount - r.creditAmount) * BigInt(r.withholdingRateBps) / 10000n;
  assert.equal(dueOnReducedPayment, 190000000n);
  assert.equal(r.withheldAmount, 200000000n);
  assert.equal(r.withheldAmount - dueOnReducedPayment, 10000000n);
});

test('a credit of zero states no credit: the withholding stands exactly as the withholding model states it', () => {
  const r = modelWithholdingCredit({ ...DEFAULT, creditAmount: '0' });
  assert.equal(r.creditAppliedAmount, 0n);
  assert.equal(r.cashWithheldAmount, 200000000n);
  assert.equal(r.netAmount, 800000000n);
  assert.equal(r.creditRemainingAmount, 0n);
  assert.equal(r.noCreditStated, true);
  assert.equal(r.creditAppliedShareBpsText, '0.00');
});

test('a credit equal to the due covers the withholding whole: nothing is withheld in cash and the payment is paid over whole', () => {
  const r = modelWithholdingCredit({ ...DEFAULT, creditAmount: '200' });
  assert.equal(r.creditAppliedAmount, 200000000n);
  assert.equal(r.cashWithheldAmount, 0n);
  assert.equal(r.netAmount, 1000000000n);
  assert.equal(r.creditRemainingAmount, 0n);
  assert.equal(r.creditCoversWithholding, true);
  assert.equal(r.creditExceedsWithholding, false);
  assert.equal(r.creditAppliedShareBpsText, '10000.00');
  assert.equal(r.netShareBpsText, '10000.00');
});

test('a credit beyond the due is never paid out: the excess remains a credit balance and what is paid over never exceeds the gross payment', () => {
  const r = modelWithholdingCredit({ ...DEFAULT, creditAmount: '250' });
  assert.equal(r.creditAppliedAmount, 200000000n);
  assert.equal(r.cashWithheldAmount, 0n);
  assert.equal(r.netAmount, 1000000000n);
  assert.equal(r.creditRemainingAmount, 50000000n);
  assert.equal(r.creditExceedsWithholding, true);
  assert.equal(r.creditRemains, true);
  assert.equal(r.creditCoversWithholding, true);
});

test('where no withholding rate is stated there is no due for a credit to apply against: the whole credit remains and the payment is paid over whole', () => {
  const r = modelWithholdingCredit({ ...DEFAULT, withholdingRateBps: 0 });
  assert.equal(r.withheldAmount, 0n);
  assert.equal(r.creditAppliedAmount, 0n);
  assert.equal(r.cashWithheldAmount, 0n);
  assert.equal(r.netAmount, 1000000000n);
  assert.equal(r.creditRemainingAmount, 50000000n);
  assert.equal(r.noWithholdingDue, true);
  assert.equal(r.noWithholdingStated, true);
});

test('a stated rate flooring to zero on a one-base-unit payment leaves no due: a one-base-unit credit remains whole', () => {
  const r = modelWithholdingCredit({ amount: '0.000001', withholdingRateBps: 2000, creditAmount: '0.000001', decimals: 6 });
  assert.equal(r.amount, 1n);
  assert.equal(r.withheldAmount, 0n);
  assert.equal(r.creditAppliedAmount, 0n);
  assert.equal(r.netAmount, 1n);
  assert.equal(r.creditRemainingAmount, 1n);
  assert.equal(r.noWithholdingDue, true);
  assert.equal(r.withholdingFloorsToZero, true);
});

test('a withholding rate of the whole states a due of the whole payment before credit: a 50 credit leaves 950 withheld in cash and 50 paid over', () => {
  const r = modelWithholdingCredit({ ...DEFAULT, withholdingRateBps: 10000 });
  assert.equal(r.withheldAmount, 1000000000n);
  assert.equal(r.withholdingTakesWhole, true);
  assert.equal(r.creditAppliedAmount, 50000000n);
  assert.equal(r.cashWithheldAmount, 950000000n);
  assert.equal(r.netAmount, 50000000n);
  assert.equal(r.creditAppliedShareBpsText, '500.00');
});

test('the 777 case at no decimals: a due of 155 with a stated 100 credit leaves 55 withheld in cash and 722 paid over', () => {
  const r = modelWithholdingCredit({ amount: '777', withholdingRateBps: 2000, creditAmount: '100', decimals: 0 });
  assert.equal(r.withheldAmount, 155n);
  assert.equal(r.creditAppliedAmount, 100n);
  assert.equal(r.cashWithheldAmount, 55n);
  assert.equal(r.netAmount, 722n);
  assert.equal(r.creditAppliedShareBpsText, '6451.61');
  assert.equal(r.cashWithheldShareBpsText, '707.85');
  assert.equal(r.netShareBpsText, '9292.14');
});

test('amounts beyond float precision stay exact: a 2^53+1 payment at 20% with a stated 10^15 credit applies the credit whole against the due', () => {
  const r = modelWithholdingCredit({ amount: '9007199254740993', withholdingRateBps: 2000, creditAmount: '1000000000000000', decimals: 0 });
  assert.equal(r.withheldAmount, 1801439850948198n);
  assert.equal(r.creditAppliedAmount, 1000000000000000n);
  assert.equal(r.cashWithheldAmount, 801439850948198n);
  assert.equal(r.netAmount, 8205759403792795n);
});

test('decimals are respected: 2500 at two decimals and 20% with a stated 125.00 credit leaves 375.00 withheld in cash and 2125.00 paid over', () => {
  const r = modelWithholdingCredit({ amount: '2500', withholdingRateBps: 2000, creditAmount: '125', decimals: 2 });
  assert.equal(r.amount, 250000n);
  assert.equal(r.withheldAmount, 50000n);
  assert.equal(r.creditAppliedAmount, 12500n);
  assert.equal(r.cashWithheldAmount, 37500n);
  assert.equal(r.netAmount, 212500n);
});

test('a withholding rate beyond the whole is refused, exactly as in the withholding model', () => {
  assert.throws(() => modelWithholdingCredit({ ...DEFAULT, withholdingRateBps: 10001 }), /Withholding rate must be/);
});

test('a negative credit is refused: a credit is a stated amount, not a charge', () => {
  assert.throws(() => modelWithholdingCredit({ ...DEFAULT, creditAmount: '-5' }), /positive decimal amount/);
});

test('a zero payment amount is refused, exactly as in the withholding model', () => {
  assert.throws(() => modelWithholdingCredit({ ...DEFAULT, amount: '0' }), /Amount must be greater than zero/);
});

test('what is not priced is stated: the credit is not a cash payment or a refund, the cash withheld is not a fee, and credit origin, validity, expiry, and remaining-credit fate are flagged unpriced', () => {
  const r = modelWithholdingCredit(DEFAULT);
  assert.equal(r.withholdingIsFee, false);
  assert.equal(r.creditIsCashPayment, false);
  assert.equal(r.creditIsRefund, false);
  assert.equal(r.creditOriginPriced, false);
  assert.equal(r.creditValidityPriced, false);
  assert.equal(r.creditExpiryPriced, false);
  assert.equal(r.remainingCreditFatePriced, false);
});

test('wiring: the app imports the model, renders a withholding credit panel, and the README names the model', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(app.includes('modelWithholdingCredit'));
  assert.ok(app.includes('data-withcred'));
  assert.ok(app.includes('withcred-output'));
  assert.match(app, /v1\.235/);
  assert.ok(readme.includes('Withholding credit model'));
});

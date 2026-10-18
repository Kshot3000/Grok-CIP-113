import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelEarlyPaymentDiscount } from '../src/domain.js';

// Early payment discount model (v1.256): a NEW axis — the
// insurance axis closed with its two moments (v1.183), and PRISM
// priced no trade-credit terms. A supplier offers a stated
// discount off the face for paying inside a window, with the
// whole face due at the net day. The discount is floored on the
// face; the cost of waiting is exactly the discount forgone,
// stated as its own amount; the annualised figure is a simple
// annualisation on the early amount over the extra days of
// credit, by a stated method, never compounded. Shares are
// derived from the amounts against the face.
const DEFAULT = { invoiceAmount: '10000', decimals: 6, discountBps: 200, discountDays: 10, netDays: 30 };

test('the preloaded terms: 10000 invoiced at 200 basis points for paying within 10 days, net 30 — the discount is 200, paying early costs 9800, and waiting costs exactly the 200 forgone', () => {
  const r = modelEarlyPaymentDiscount(DEFAULT);
  assert.equal(r.discountAmount, 200000000n);
  assert.equal(r.amountDueEarly, 9800000000n);
  assert.equal(r.amountDueAtNet, 10000000000n);
  assert.equal(r.extraCostOfWaiting, 200000000n);
  assert.equal(r.extraDaysCredit, 20);
});

test('identities hold across terms: discount plus early amount is the face, the amount at net is the face unchanged, and the extra cost of waiting is the discount exactly', () => {
  const cases = [
    DEFAULT,
    { invoiceAmount: '777', decimals: 6, discountBps: 333, discountDays: 10, netDays: 30 },
    { invoiceAmount: '777', decimals: 0, discountBps: 333, discountDays: 10, netDays: 30 },
    { invoiceAmount: '5000', decimals: 6, discountBps: 0, discountDays: 10, netDays: 30 },
    { invoiceAmount: '10000', decimals: 6, discountBps: 200, discountDays: 0, netDays: 30 },
  ];
  for (const c of cases) {
    const r = modelEarlyPaymentDiscount(c);
    assert.equal(r.discountAmount + r.amountDueEarly, r.invoiceAmount);
    assert.equal(r.amountDueAtNet, r.invoiceAmount);
    assert.equal(r.extraCostOfWaiting, r.discountAmount);
    assert.equal(r.discountDays + r.extraDaysCredit, r.netDays);
  }
});

test('the cost of waiting is never merged into the face: the amount due at the net day is the invoice amount itself, not the face plus the discount', () => {
  const r = modelEarlyPaymentDiscount(DEFAULT);
  assert.equal(r.amountDueAtNet, 10000000000n);
  assert.notEqual(r.amountDueAtNet, 10200000000n);
});

test('the discount is floored on the face, never rounded up: on a 777 invoice at 333 basis points with no decimals the discount is 25, not 26 — rounding up would give the buyer more than the stated share', () => {
  const r = modelEarlyPaymentDiscount({ invoiceAmount: '777', decimals: 0, discountBps: 333, discountDays: 10, netDays: 30 });
  assert.equal(r.discountAmount, 25n);
  assert.equal(r.amountDueEarly, 752n);
  assert.equal(r.discountFloors, true);
});

test('shares are derived from the amounts, so a floored discount states a smaller share than the stated basis points: 321.75 against the stated 333 on the no-decimals 777 case', () => {
  const r = modelEarlyPaymentDiscount({ invoiceAmount: '777', decimals: 0, discountBps: 333, discountDays: 10, netDays: 30 });
  assert.equal(r.discountShareBpsText, '321.75');
  assert.equal(r.earlyShareBpsText, '9678.24');
});

test('where the discount divides exactly the derived share equals the stated basis points: 200.00 stated and derived on the preload, with the early amount at 9800.00', () => {
  const r = modelEarlyPaymentDiscount(DEFAULT);
  assert.equal(r.discountShareBpsText, '200.00');
  assert.equal(r.earlyShareBpsText, '9800.00');
  assert.equal(r.discountFloors, false);
});

test('the annualised cost is a simple annualisation on the early amount over the extra days of credit: 3724.48 basis points on the preload (200 against 9800 for 20 extra days, scaled to 365 days, floored, not compounded)', () => {
  const r = modelEarlyPaymentDiscount(DEFAULT);
  assert.equal(r.annualisedCostBpsText, '3724.48');
});

test('the annualised cost is measured against the early amount, not the face: on the 777 case at 333 basis points it is 6286.59, derived from 25.8741 against 751.1259 — measuring against the face would state 6077.25 and understate what waiting costs', () => {
  const r = modelEarlyPaymentDiscount({ invoiceAmount: '777', decimals: 6, discountBps: 333, discountDays: 10, netDays: 30 });
  assert.equal(r.discountAmount, 25874100n);
  assert.equal(r.annualisedCostBpsText, '6286.59');
  assert.notEqual(r.annualisedCostBpsText, '6077.25');
});

test('a longer wait for the same discount annualises lower: the same 200 discount with a window closing on the invoice day buys 30 extra days and annualises to 2482.99', () => {
  const r = modelEarlyPaymentDiscount({ invoiceAmount: '10000', decimals: 6, discountBps: 200, discountDays: 0, netDays: 30 });
  assert.equal(r.immediateWindow, true);
  assert.equal(r.extraDaysCredit, 30);
  assert.equal(r.annualisedCostBpsText, '2482.99');
});

test('with no discount stated the same amount is due on every day and waiting costs nothing', () => {
  const r = modelEarlyPaymentDiscount({ invoiceAmount: '5000', decimals: 6, discountBps: 0, discountDays: 10, netDays: 30 });
  assert.equal(r.noDiscount, true);
  assert.equal(r.discountAmount, 0n);
  assert.equal(r.amountDueEarly, 5000000000n);
  assert.equal(r.amountDueAtNet, 5000000000n);
  assert.equal(r.annualisedCostBpsText, '0.00');
});

test('a stated discount that floors to zero on a small invoice saves nothing and is stated as such, never presented as a saving: 1 basis point on a 1-unit invoice', () => {
  const r = modelEarlyPaymentDiscount({ invoiceAmount: '1', decimals: 0, discountBps: 1, discountDays: 10, netDays: 30 });
  assert.equal(r.discountFloorsToZero, true);
  assert.equal(r.discountAmount, 0n);
  assert.equal(r.amountDueEarly, 1n);
  assert.equal(r.extraCostOfWaiting, 0n);
});

test('amounts beyond float precision stay exact: a 2^53+1 invoice at 200 basis points discounts 180143985094819 and the early amount is 8827055269646174', () => {
  const r = modelEarlyPaymentDiscount({ invoiceAmount: '9007199254740993', decimals: 0, discountBps: 200, discountDays: 10, netDays: 30 });
  assert.equal(r.discountAmount, 180143985094819n);
  assert.equal(r.amountDueEarly, 8827055269646174n);
  assert.equal(r.discountShareBpsText, '199.99');
});

test('a discount taking the whole invoice is refused — there would be nothing left to pay early', () => {
  assert.throws(() => modelEarlyPaymentDiscount({ ...DEFAULT, discountBps: 10000 }), /must not take the whole invoice amount/);
});

test('an invoice of zero is refused — there are no terms to price on nothing owed', () => {
  assert.throws(() => modelEarlyPaymentDiscount({ ...DEFAULT, invoiceAmount: '0' }), /Invoice amount must be greater than zero/);
});

test('a net day at or before the discount window ends is refused — waiting would buy no extra days of credit', () => {
  assert.throws(() => modelEarlyPaymentDiscount({ ...DEFAULT, netDays: 10 }), /after the discount window ends/);
  assert.throws(() => modelEarlyPaymentDiscount({ ...DEFAULT, netDays: 5 }), /after the discount window ends/);
});

test('malformed terms are refused: fractional basis points, fractional days, and comma amounts', () => {
  assert.throws(() => modelEarlyPaymentDiscount({ ...DEFAULT, discountBps: 2.5 }), /whole number of basis points/);
  assert.throws(() => modelEarlyPaymentDiscount({ ...DEFAULT, discountDays: 10.5 }), /whole number of days/);
  assert.throws(() => modelEarlyPaymentDiscount({ ...DEFAULT, invoiceAmount: '10,000' }), /without commas or exponents/);
});

test('the early amount never exceeds the face and the discount never exceeds the face, across discounts from zero to just under the whole invoice', () => {
  for (const bps of [0, 1, 200, 5000, 9999]) {
    const r = modelEarlyPaymentDiscount({ invoiceAmount: '12345', decimals: 0, discountBps: bps, discountDays: 10, netDays: 30 });
    assert.ok(r.amountDueEarly <= 12345n);
    assert.ok(r.discountAmount < 12345n);
    assert.ok(r.amountDueEarly > 0n);
  }
});

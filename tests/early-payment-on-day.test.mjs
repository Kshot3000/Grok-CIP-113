import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelEarlyPaymentDiscount, modelEarlyPaymentOnDay } from '../src/domain.js';

// Early payment on a stated day model (v1.221): the trade-credit
// axis's second moment (v1.184) — the terms model states what
// paying inside the window and at the net day each cost, but a
// buyer pays on ONE stated day. This model composes the terms
// model unchanged: the window boundary is inclusive, missing the
// window costs exactly the discount forgone and nothing else,
// and overdue is stated but NOT priced — no late fee is
// invented. Shares are derived from the amounts against the face.
const DEFAULT = { invoiceAmount: '10000', decimals: 6, discountBps: 200, discountDays: 10, netDays: 30, paymentDay: 25 };

test('the preloaded day: paying on day 25 misses the 10-day window but is not overdue — the whole 10000 is due, the 200 discount is forgone, and day 25 is 5 days before the net day', () => {
  const r = modelEarlyPaymentOnDay(DEFAULT);
  assert.equal(r.amountDue, 10000000000n);
  assert.equal(r.discountTaken, 0n);
  assert.equal(r.discountForgone, 200000000n);
  assert.equal(r.windowMissed, true);
  assert.equal(r.overdue, false);
  assert.equal(r.daysBeforeNet, 5);
  assert.equal(r.daysOverdue, 0);
});

test('identities hold across days: taken plus forgone is the base discount exactly, and the amount due plus the discount taken is the face', () => {
  const cases = [
    DEFAULT,
    { ...DEFAULT, paymentDay: 0 },
    { ...DEFAULT, paymentDay: 10 },
    { ...DEFAULT, paymentDay: 30 },
    { ...DEFAULT, paymentDay: 45 },
    { invoiceAmount: '777', decimals: 0, discountBps: 333, discountDays: 10, netDays: 30, paymentDay: 7 },
    { invoiceAmount: '777', decimals: 0, discountBps: 333, discountDays: 10, netDays: 30, paymentDay: 20 },
  ];
  for (const c of cases) {
    const r = modelEarlyPaymentOnDay(c);
    const b = modelEarlyPaymentDiscount(c);
    assert.equal(r.discountTaken + r.discountForgone, b.discountAmount);
    assert.equal(r.amountDue + r.discountTaken, r.invoiceAmount);
    assert.equal(r.discountAmount, b.discountAmount);
    assert.equal(r.amountDueEarly, b.amountDueEarly);
  }
});

test('the window boundary is inclusive: paying on the window\u2019s last day (day 10) takes the discount exactly — 9800 settles the invoice', () => {
  const r = modelEarlyPaymentOnDay({ ...DEFAULT, paymentDay: 10 });
  assert.equal(r.withinWindow, true);
  assert.equal(r.takesDiscount, true);
  assert.equal(r.amountDue, 9800000000n);
  assert.equal(r.discountTaken, 200000000n);
  assert.equal(r.discountForgone, 0n);
});

test('one day past the window the discount is gone in full: paying on day 11 pays the whole face — a missed window is not a partial discount', () => {
  const r = modelEarlyPaymentOnDay({ ...DEFAULT, paymentDay: 11 });
  assert.equal(r.withinWindow, false);
  assert.equal(r.windowMissed, true);
  assert.equal(r.amountDue, 10000000000n);
  assert.equal(r.discountForgone, 200000000n);
  assert.equal(r.daysBeforeNet, 19);
});

test('the net day itself is its own outcome: paying on day 30 pays the face alone — neither discounted nor overdue', () => {
  const r = modelEarlyPaymentOnDay({ ...DEFAULT, paymentDay: 30 });
  assert.equal(r.onNetDay, true);
  assert.equal(r.windowMissed, true);
  assert.equal(r.overdue, false);
  assert.equal(r.amountDue, 10000000000n);
  assert.equal(r.daysBeforeNet, 0);
  assert.equal(r.daysOverdue, 0);
});

test('overdue is stated, never priced: paying on day 45 is 15 days overdue and the amount due is still the face unchanged — no late fee is invented', () => {
  const r = modelEarlyPaymentOnDay({ ...DEFAULT, paymentDay: 45 });
  assert.equal(r.overdue, true);
  assert.equal(r.daysOverdue, 15);
  assert.equal(r.amountDue, 10000000000n);
  assert.equal(r.lateFeePriced, false);
  assert.notEqual(r.amountDue, 10200000000n);
});

test('paying on the invoice day itself takes the discount: day 0 is inside any window, immediate or not', () => {
  const r = modelEarlyPaymentOnDay({ ...DEFAULT, paymentDay: 0 });
  assert.equal(r.paidOnInvoiceDay, true);
  assert.equal(r.withinWindow, true);
  assert.equal(r.amountDue, 9800000000n);
  assert.equal(r.daysBeforeNet, 30);
});

test('exactly one of the three outcomes holds on every day: inside the window, window missed (net day included), or overdue', () => {
  for (let d = 0; d <= 60; d++) {
    const r = modelEarlyPaymentOnDay({ ...DEFAULT, paymentDay: d });
    const outcomes = [r.withinWindow, r.windowMissed, r.overdue].filter(Boolean);
    assert.equal(outcomes.length, 1);
    assert.equal(r.onNetDay, d === 30);
  }
});

test('shares are derived from the amounts: on the no-decimals 777 case at 333 basis points, a day-7 payment takes a 321.75 share and pays a 9678.24 share of the face', () => {
  const r = modelEarlyPaymentOnDay({ invoiceAmount: '777', decimals: 0, discountBps: 333, discountDays: 10, netDays: 30, paymentDay: 7 });
  assert.equal(r.amountDue, 752n);
  assert.equal(r.discountTaken, 25n);
  assert.equal(r.discountTakenShareBpsText, '321.75');
  assert.equal(r.amountDueShareBpsText, '9678.24');
});

test('a missed window on the 777 case forgoes the whole floored discount: a day-20 payment pays 777 and forgoes 25', () => {
  const r = modelEarlyPaymentOnDay({ invoiceAmount: '777', decimals: 0, discountBps: 333, discountDays: 10, netDays: 30, paymentDay: 20 });
  assert.equal(r.amountDue, 777n);
  assert.equal(r.discountTaken, 0n);
  assert.equal(r.discountForgone, 25n);
  assert.equal(r.amountDueShareBpsText, '10000.00');
});

test('with no discount stated every day costs the face, even an overdue day: nothing is saved, nothing is forgone, and no late fee appears', () => {
  const r = modelEarlyPaymentOnDay({ invoiceAmount: '5000', decimals: 6, discountBps: 0, discountDays: 10, netDays: 30, paymentDay: 45 });
  assert.equal(r.noDiscount, true);
  assert.equal(r.overdue, true);
  assert.equal(r.amountDue, 5000000000n);
  assert.equal(r.discountTaken, 0n);
  assert.equal(r.discountForgone, 0n);
});

test('a stated discount that floors to zero saves nothing on any day: a window payment on a 1-unit invoice at 1 basis point takes no discount', () => {
  const r = modelEarlyPaymentOnDay({ invoiceAmount: '1', decimals: 0, discountBps: 1, discountDays: 10, netDays: 30, paymentDay: 5 });
  assert.equal(r.discountFloorsToZero, true);
  assert.equal(r.withinWindow, true);
  assert.equal(r.takesDiscount, false);
  assert.equal(r.amountDue, 1n);
});

test('amounts beyond float precision stay exact: a 2^53+1 invoice paid on the window\u2019s last day takes 180143985094819 and pays 8827055269646174', () => {
  const r = modelEarlyPaymentOnDay({ invoiceAmount: '9007199254740993', decimals: 0, discountBps: 200, discountDays: 10, netDays: 30, paymentDay: 10 });
  assert.equal(r.discountTaken, 180143985094819n);
  assert.equal(r.amountDue, 8827055269646174n);
  assert.equal(r.discountTakenShareBpsText, '199.99');
});

test('the same 2^53+1 invoice paid one day past the net day forgoes the whole discount and pays the face exactly, one day overdue', () => {
  const r = modelEarlyPaymentOnDay({ invoiceAmount: '9007199254740993', decimals: 0, discountBps: 200, discountDays: 10, netDays: 30, paymentDay: 31 });
  assert.equal(r.overdue, true);
  assert.equal(r.daysOverdue, 1);
  assert.equal(r.amountDue, 9007199254740993n);
  assert.equal(r.discountForgone, 180143985094819n);
});

test('the composed terms are the base model\u2019s exactly: the on-day result carries the base discount, early amount, and terms unchanged', () => {
  const b = modelEarlyPaymentDiscount(DEFAULT);
  const r = modelEarlyPaymentOnDay(DEFAULT);
  assert.equal(r.discountAmount, b.discountAmount);
  assert.equal(r.amountDueEarly, b.amountDueEarly);
  assert.equal(r.discountBps, b.discountBps);
  assert.equal(r.discountDays, b.discountDays);
  assert.equal(r.netDays, b.netDays);
});

test('a negative or fractional payment day is refused — a payment falls on a whole day of the terms', () => {
  assert.throws(() => modelEarlyPaymentOnDay({ ...DEFAULT, paymentDay: -1 }), /whole number of days, zero or more/);
  assert.throws(() => modelEarlyPaymentOnDay({ ...DEFAULT, paymentDay: 2.5 }), /whole number of days, zero or more/);
});

test('invalid terms are refused through the base model: a discount taking the whole invoice, and a net day at the window end', () => {
  assert.throws(() => modelEarlyPaymentOnDay({ ...DEFAULT, discountBps: 10000 }), /must not take the whole invoice amount/);
  assert.throws(() => modelEarlyPaymentOnDay({ ...DEFAULT, netDays: 10 }), /after the discount window ends/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCashRounding, modelCashRoundingChange } from '../src/domain.js';

// Cash rounding change model (v1.261): the cash-rounding axis's
// second moment — the rounding model states what is due at
// payment, but a payer tenders an amount and the excess over
// the ROUNDED amount due is handed back as change, stated
// exactly in BigInt. The change is measured against the rounded
// amount due, never the stated amount, and underpayment is
// refused rather than stated as negative change.
const DEFAULT = { amount: '103', increment: '5', tendered: '110', decimals: 6 };

test('the preloaded payment: 103 rounded to the nearest 5 states 105 due, and tendering 110 hands 5 back as change', () => {
  const r = modelCashRoundingChange(DEFAULT);
  assert.equal(r.amount, 103000000n);
  assert.equal(r.roundedAmount, 105000000n);
  assert.equal(r.adjustment, 2000000n);
  assert.equal(r.tendered, 110000000n);
  assert.equal(r.change, 5000000n);
  assert.equal(r.changeDue, true);
  assert.equal(r.exactTender, false);
  assert.equal(r.dueShareBpsText, '9545.45');
  assert.equal(r.changeShareBpsText, '454.54');
});

test('identity holds across payments: the rounded amount due plus the change is what was tendered, exactly', () => {
  const cases = [
    DEFAULT,
    { amount: '102', increment: '5', tendered: '103', decimals: 6 },
    { amount: '105', increment: '5', tendered: '105', decimals: 6 },
    { amount: '2', increment: '5', tendered: '5', decimals: 6 },
    { amount: '777', increment: '25', tendered: '800', decimals: 0 },
    { amount: '9007199254740993', increment: '1000', tendered: '9007199254742000', decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelCashRoundingChange(c);
    assert.equal(r.roundedAmount + r.change, r.tendered);
    assert.equal(r.roundedAmount % r.increment, 0n);
  }
});

test('the payment composes the rounding model unchanged: due, adjustment, and direction are the base model\u2019s own', () => {
  const cases = [DEFAULT, { amount: '102', increment: '5', tendered: '200', decimals: 6 }, { amount: '102.5', increment: '5', tendered: '200', decimals: 6 }];
  for (const c of cases) {
    const r = modelCashRoundingChange(c);
    const b = modelCashRounding({ amount: c.amount, increment: c.increment, decimals: c.decimals });
    assert.equal(r.roundedAmount, b.roundedAmount);
    assert.equal(r.adjustment, b.adjustment);
    assert.equal(r.roundsUp, b.roundsUp);
    assert.equal(r.roundsDown, b.roundsDown);
    assert.equal(r.tie, b.tie);
  }
});

test('change is measured against the ROUNDED amount due, never the stated amount: on a round-up, measuring against the stated amount hands the adjustment back a second time', () => {
  const r = modelCashRoundingChange(DEFAULT);
  const againstStated = r.tendered - r.amount; // Computed test-side: the position measuring against the stated amount would state.
  assert.equal(againstStated, 7000000n);
  assert.equal(r.change, 5000000n);
  assert.equal(againstStated - r.change, r.adjustment);
});

test('change is measured against the ROUNDED amount due on a round-down too: 102 rounds to 100 due, and tendering 103 hands 3 back, not 1', () => {
  const r = modelCashRoundingChange({ amount: '102', increment: '5', tendered: '103', decimals: 6 });
  assert.equal(r.roundedAmount, 100000000n);
  assert.equal(r.change, 3000000n);
  assert.equal(r.dueShareBpsText, '9708.73');
  assert.equal(r.changeShareBpsText, '291.26');
});

test('an exact tender hands nothing back: tendering the rounded 105 on the preloaded rounding states no change', () => {
  const r = modelCashRoundingChange({ amount: '103', increment: '5', tendered: '105', decimals: 6 });
  assert.equal(r.change, 0n);
  assert.equal(r.exactTender, true);
  assert.equal(r.changeDue, false);
  assert.equal(r.dueShareBpsText, '10000.00');
  assert.equal(r.changeShareBpsText, '0.00');
});

test('a tie tendered exactly states no change: 102.5 rounds up to 105 due and tendering 105 is exact', () => {
  const r = modelCashRoundingChange({ amount: '102.5', increment: '5', tendered: '105', decimals: 6 });
  assert.equal(r.tie, true);
  assert.equal(r.roundedAmount, 105000000n);
  assert.equal(r.change, 0n);
  assert.equal(r.exactTender, true);
});

test('an amount rounding to zero states nothing due: everything tendered is change, stated as such', () => {
  const r = modelCashRoundingChange({ amount: '2', increment: '5', tendered: '5', decimals: 6 });
  assert.equal(r.roundedAmount, 0n);
  assert.equal(r.dueIsZero, true);
  assert.equal(r.roundsToZero, true);
  assert.equal(r.change, 5000000n);
  assert.equal(r.dueShareBpsText, '0.00');
  assert.equal(r.changeShareBpsText, '10000.00');
});

test('underpayment is refused, never stated as negative change: tendering 104 against 105 due throws', () => {
  assert.throws(() => modelCashRoundingChange({ amount: '103', increment: '5', tendered: '104', decimals: 6 }), /cover the rounded amount due/);
  assert.throws(() => modelCashRoundingChange({ amount: '103', increment: '5', tendered: '103', decimals: 6 }), /cover the rounded amount due/);
});

test('tendering nothing is refused: a tendered amount of zero throws', () => {
  assert.throws(() => modelCashRoundingChange({ amount: '103', increment: '5', tendered: '0', decimals: 6 }), /greater than zero/);
});

test('the base validation is inherited: a stated amount of zero or an increment of zero throws from the rounding model', () => {
  assert.throws(() => modelCashRoundingChange({ amount: '0', increment: '5', tendered: '5', decimals: 6 }), /greater than zero/);
  assert.throws(() => modelCashRoundingChange({ amount: '103', increment: '0', tendered: '110', decimals: 6 }), /greater than zero/);
});

test('no-decimals case: 777 to the nearest 25 rounds down to 775 due, and tendering 800 hands 25 back', () => {
  const r = modelCashRoundingChange({ amount: '777', increment: '25', tendered: '800', decimals: 0 });
  assert.equal(r.roundedAmount, 775n);
  assert.equal(r.change, 25n);
  assert.equal(r.roundsDown, true);
  assert.equal(r.dueShareBpsText, '9687.50');
  assert.equal(r.changeShareBpsText, '312.50');
});

test('amounts beyond float precision stay exact: a 2^53+1 amount rounds up by 7 to the amount due and tendering 1000 above it hands exactly 1000 back', () => {
  const r = modelCashRoundingChange({ amount: '9007199254740993', increment: '1000', tendered: '9007199254742000', decimals: 0 });
  assert.equal(r.roundedAmount, 9007199254741000n);
  assert.equal(r.adjustment, 7n);
  assert.equal(r.change, 1000n);
  assert.equal(r.dueShareBpsText, '9999.99');
  assert.equal(r.changeShareBpsText, '0.00');
});

test('what is not priced is stated: denominations and shortfall treatment are flagged unpriced', () => {
  const r = modelCashRoundingChange(DEFAULT);
  assert.equal(r.denominationsPriced, false);
  assert.equal(r.shortfallTreatmentPriced, false);
});

test('wiring: the app imports the model, renders a cash-payment panel, and the README names the model', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(app.includes('modelCashRoundingChange'));
  assert.ok(app.includes('data-cashpay'));
  assert.ok(app.includes('cashpay-output'));
  assert.ok(readme.includes('Cash rounding change model'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelTaxExclusiveTotal, modelTaxInclusiveSplit } from '../src/domain.js';

// Tax-exclusive price total model (v1.235): the tax axis's
// second moment — a price quoted BEFORE tax, with a stated
// tax added on top of it. The tax is charged on top —
// floor(net x rate / 10,000) — never extracted from inside
// a price, the total due is the exact sum, and the shares
// are derived from the amounts against the total, floored.
const DEFAULT = { netAmount: '1000', taxRateBps: 2000, decimals: 6 };

test('the preloaded total: a 1000 amount before tax at a stated 2000 bps rate adds 200 of tax and the total due is 1200, shares 1666.66 and 8333.33', () => {
  const r = modelTaxExclusiveTotal(DEFAULT);
  assert.equal(r.netAmount, 1000000000n);
  assert.equal(r.taxAmount, 200000000n);
  assert.equal(r.grossAmount, 1200000000n);
  assert.equal(r.taxShareBpsText, '1666.66');
  assert.equal(r.netShareBpsText, '8333.33');
});

test('the default rate is none stated when none is given: the total due is the amount before tax whole', () => {
  const r = modelTaxExclusiveTotal({ netAmount: '1000', decimals: 6 });
  assert.equal(r.taxRateBps, 0);
  assert.equal(r.taxAmount, 0n);
  assert.equal(r.grossAmount, r.netAmount);
  assert.equal(r.noTaxStated, true);
});

test('identities hold across prices: the amount before tax plus the tax added is the total due, exactly', () => {
  const cases = [
    DEFAULT,
    { netAmount: '1000', taxRateBps: 0, decimals: 6 },
    { netAmount: '1000', taxRateBps: 10000, decimals: 6 },
    { netAmount: '777', taxRateBps: 2000, decimals: 0 },
    { netAmount: '9007199254740993', taxRateBps: 2000, decimals: 0 },
    { netAmount: '0.000001', taxRateBps: 100, decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelTaxExclusiveTotal(c);
    assert.equal(r.netAmount + r.taxAmount, r.grossAmount);
  }
});

test('the tax is charged on top, never extracted from inside: on the no-decimals 777 amount at 2000 bps the tax added is 155, not the 129 the extraction method states', () => {
  const r = modelTaxExclusiveTotal({ netAmount: '777', taxRateBps: 2000, decimals: 0 });
  assert.equal(r.taxAmount, 155n);
  assert.equal(r.grossAmount, 932n);
  assert.notEqual(r.taxAmount, 777n * 2000n / 12000n);
});

test('the extraction understatement is exactly the tax on the tax: on the preload the extraction method states 166.666666 where the tax added is 200', () => {
  const r = modelTaxExclusiveTotal(DEFAULT);
  assert.equal(1200000000n * 2000n / 12000n, 200000000n);
  assert.equal(r.taxAmount, 200000000n);
  const split = modelTaxInclusiveSplit({ grossAmount: '1000', taxRateBps: 2000, decimals: 6 });
  assert.equal(split.taxAmount, 166666666n);
  assert.ok(split.taxAmount < r.taxAmount);
});

test('the two directions are exact inverses on the preload: splitting the 1200 total back at the same stated rate returns 200 of tax and 1000 before tax', () => {
  const r = modelTaxExclusiveTotal(DEFAULT);
  const back = modelTaxInclusiveSplit({ grossAmount: '1200', taxRateBps: 2000, decimals: 6 });
  assert.equal(back.taxAmount, r.taxAmount);
  assert.equal(back.netAmount, r.netAmount);
  assert.equal(back.grossAmount, r.grossAmount);
});

test('the tax is never extracted from inside a price: net plus tax is the total due and nothing more', () => {
  const r = modelTaxExclusiveTotal(DEFAULT);
  assert.equal(r.taxExtractedFromInside, false);
  assert.equal(r.netAmount + r.taxAmount, r.grossAmount);
});

test('liability is not priced: the model states the total the stated rate describes, never whether the tax is owed, to whom, or remitted', () => {
  const r = modelTaxExclusiveTotal(DEFAULT);
  assert.equal(r.liabilityPriced, false);
});

test('a rate of zero states no tax: the total due is the amount before tax whole, with shares 0.00 and 10000.00', () => {
  const r = modelTaxExclusiveTotal({ netAmount: '1000', taxRateBps: 0, decimals: 6 });
  assert.equal(r.noTaxStated, true);
  assert.equal(r.taxFloorsToZero, false);
  assert.equal(r.taxAmount, 0n);
  assert.equal(r.grossAmount, 1000000000n);
  assert.equal(r.taxShareBpsText, '0.00');
  assert.equal(r.netShareBpsText, '10000.00');
});

test('a stated rate that floors to zero adds nothing at that size, stated as such: 1 base unit at 100 bps carries no whole base unit of tax, and the rate still stands', () => {
  const r = modelTaxExclusiveTotal({ netAmount: '0.000001', taxRateBps: 100, decimals: 6 });
  assert.equal(r.noTaxStated, false);
  assert.equal(r.taxFloorsToZero, true);
  assert.equal(r.taxAmount, 0n);
  assert.equal(r.grossAmount, 1n);
  assert.equal(r.taxShareBpsText, '0.00');
  assert.equal(r.netShareBpsText, '10000.00');
});

test('a 10000 bps rate doubles the amount: 1000 at the full rate adds 1000 of tax and the total due is 2000', () => {
  const r = modelTaxExclusiveTotal({ netAmount: '1000', taxRateBps: 10000, decimals: 0 });
  assert.equal(r.taxAmount, 1000n);
  assert.equal(r.grossAmount, 2000n);
  assert.equal(r.taxShareBpsText, '5000.00');
  assert.equal(r.netShareBpsText, '5000.00');
});

test('shares are derived from the amounts against the total due: on the no-decimals 777 amount, 155 of tax on a 932 total states shares 1663.09 and 8336.90', () => {
  const r = modelTaxExclusiveTotal({ netAmount: '777', taxRateBps: 2000, decimals: 0 });
  assert.equal(r.taxShareBpsText, '1663.09');
  assert.equal(r.netShareBpsText, '8336.90');
});

test('the tax share is floored, never rounded up: 1 of tax on a total of 3 states 3333.33, not the 3333.34 rounding would state', () => {
  const r = modelTaxExclusiveTotal({ netAmount: '2', taxRateBps: 5000, decimals: 0 });
  assert.equal(r.taxAmount, 1n);
  assert.equal(r.grossAmount, 3n);
  assert.equal(r.taxShareBpsText, '3333.33');
  assert.equal(r.netShareBpsText, '6666.66');
});

test('amounts beyond float precision stay exact: a 2^53+1 amount at 2000 bps adds 1801439850948198 of tax and the total due is 10808639105689191', () => {
  const r = modelTaxExclusiveTotal({ netAmount: '9007199254740993', taxRateBps: 2000, decimals: 0 });
  assert.equal(r.taxAmount, 1801439850948198n);
  assert.equal(r.grossAmount, 10808639105689191n);
  assert.equal(r.taxShareBpsText, '1666.66');
  assert.equal(r.netShareBpsText, '8333.33');
});

test('the addition floors on an odd amount: 999 at 3333 bps adds 332 of tax, never 333 taken by rounding up', () => {
  const r = modelTaxExclusiveTotal({ netAmount: '999', taxRateBps: 3333, decimals: 0 });
  assert.equal(r.taxAmount, 332n);
  assert.equal(r.grossAmount, 1331n);
  assert.equal(r.netAmount + r.taxAmount, r.grossAmount);
});

test('a zero tax-exclusive amount is refused: an amount of nothing carries no total', () => {
  assert.throws(() => modelTaxExclusiveTotal({ netAmount: '0', taxRateBps: 2000, decimals: 6 }), /Tax-exclusive amount must be greater than zero/);
  assert.throws(() => modelTaxExclusiveTotal({ taxRateBps: 2000, decimals: 6 }), /Tax-exclusive amount must be greater than zero/);
});

test('a rate beyond the whole or fractional is refused: the stated rate is a whole share of the amount before tax', () => {
  assert.throws(() => modelTaxExclusiveTotal({ netAmount: '1000', taxRateBps: 10001, decimals: 6 }), /Tax rate must be a whole number of basis points/);
  assert.throws(() => modelTaxExclusiveTotal({ netAmount: '1000', taxRateBps: 12.5, decimals: 6 }), /Tax rate must be a whole number of basis points/);
  assert.throws(() => modelTaxExclusiveTotal({ netAmount: '1000', taxRateBps: -1, decimals: 6 }), /Tax rate must be a whole number of basis points/);
});

test('a negative amount is refused at parsing, before the model ever sees it', () => {
  assert.throws(() => modelTaxExclusiveTotal({ netAmount: '-1', taxRateBps: 2000, decimals: 6 }), /Enter a positive decimal amount/);
});

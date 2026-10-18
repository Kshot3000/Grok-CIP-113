import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelTaxInclusiveSplit } from '../src/domain.js';

// Tax-inclusive price split model (v1.270): a NEW axis —
// a price that already contains a stated tax inside it.
// The tax is extracted from inside the gross, floored —
// floor(gross x rate / (10,000 + rate)) — never charged
// on top of the gross, the amount before tax is what
// remains, and the shares are derived from the amounts
// against the gross, floored.
const DEFAULT = { grossAmount: '1000', taxRateBps: 2000, decimals: 6 };

test('the preloaded split: a 1000 price carrying a stated 2000 bps rate contains 166.666666 of tax and 833.333334 before tax, shares 1666.66 and 8333.33', () => {
  const r = modelTaxInclusiveSplit(DEFAULT);
  assert.equal(r.grossAmount, 1000000000n);
  assert.equal(r.taxAmount, 166666666n);
  assert.equal(r.netAmount, 833333334n);
  assert.equal(r.taxShareBpsText, '1666.66');
  assert.equal(r.netShareBpsText, '8333.33');
});

test('the default rate is none stated when none is given: the whole price is the amount before tax', () => {
  const r = modelTaxInclusiveSplit({ grossAmount: '1000', decimals: 6 });
  assert.equal(r.taxRateBps, 0);
  assert.equal(r.taxAmount, 0n);
  assert.equal(r.netAmount, r.grossAmount);
  assert.equal(r.noTaxStated, true);
});

test('identities hold across prices: the tax inside plus the amount before tax is the gross, exactly', () => {
  const cases = [
    DEFAULT,
    { grossAmount: '1000', taxRateBps: 0, decimals: 6 },
    { grossAmount: '1000', taxRateBps: 10000, decimals: 6 },
    { grossAmount: '777', taxRateBps: 2000, decimals: 0 },
    { grossAmount: '9007199254740993', taxRateBps: 2000, decimals: 0 },
    { grossAmount: '0.000001', taxRateBps: 100, decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelTaxInclusiveSplit(c);
    assert.equal(r.taxAmount + r.netAmount, r.grossAmount);
  }
});

test('the tax is extracted from inside the price, never charged on top: on the no-decimals 777 price at 2000 bps the price contains 129 of tax, not the 155 the on-top method states', () => {
  const r = modelTaxInclusiveSplit({ grossAmount: '777', taxRateBps: 2000, decimals: 0 });
  assert.equal(r.taxAmount, 129n);
  assert.equal(r.netAmount, 648n);
  assert.notEqual(r.taxAmount, 777n * 2000n / 10000n);
});

test('the on-top overstatement is exactly the tax on the tax: on the preload the on-top method states 200 where the price contains 166.666666', () => {
  const r = modelTaxInclusiveSplit(DEFAULT);
  assert.equal(1000000000n * 2000n / 10000n, 200000000n);
  assert.equal(r.taxAmount, 166666666n);
  assert.ok(r.taxAmount < 200000000n);
});

test('the tax is never added on top of what was paid: tax plus net is the gross and nothing more', () => {
  const r = modelTaxInclusiveSplit(DEFAULT);
  assert.equal(r.taxAddedOnTop, false);
  assert.equal(r.taxAmount + r.netAmount, r.grossAmount);
});

test('liability is not priced: the model states the split the stated rate describes, never whether the tax is owed, to whom, or remitted', () => {
  const r = modelTaxInclusiveSplit(DEFAULT);
  assert.equal(r.liabilityPriced, false);
});

test('a rate of zero states no tax: the whole price is the amount before tax, with shares 0.00 and 10000.00', () => {
  const r = modelTaxInclusiveSplit({ grossAmount: '1000', taxRateBps: 0, decimals: 6 });
  assert.equal(r.noTaxStated, true);
  assert.equal(r.taxFloorsToZero, false);
  assert.equal(r.taxAmount, 0n);
  assert.equal(r.taxShareBpsText, '0.00');
  assert.equal(r.netShareBpsText, '10000.00');
});

test('a stated rate that floors to zero takes nothing at that size, stated as such: 1 base unit at 100 bps contains no whole base unit of tax, and the rate still stands', () => {
  const r = modelTaxInclusiveSplit({ grossAmount: '0.000001', taxRateBps: 100, decimals: 6 });
  assert.equal(r.noTaxStated, false);
  assert.equal(r.taxFloorsToZero, true);
  assert.equal(r.taxAmount, 0n);
  assert.equal(r.netAmount, 1n);
  assert.equal(r.taxShareBpsText, '0.00');
  assert.equal(r.netShareBpsText, '10000.00');
});

test('a 10000 bps rate splits the price in half: 1000 at the full rate contains 500 of tax and 500 before tax', () => {
  const r = modelTaxInclusiveSplit({ grossAmount: '1000', taxRateBps: 10000, decimals: 0 });
  assert.equal(r.taxAmount, 500n);
  assert.equal(r.netAmount, 500n);
  assert.equal(r.taxShareBpsText, '5000.00');
  assert.equal(r.netShareBpsText, '5000.00');
});

test('shares are derived from the amounts against the gross: on the no-decimals 777 price, 129 of tax and 648 before tax state shares 1660.23 and 8339.76', () => {
  const r = modelTaxInclusiveSplit({ grossAmount: '777', taxRateBps: 2000, decimals: 0 });
  assert.equal(r.taxShareBpsText, '1660.23');
  assert.equal(r.netShareBpsText, '8339.76');
});

test('the tax share is floored, never rounded up: 1 of tax inside a price of 3 states 3333.33, not the 3333.34 rounding would state', () => {
  const r = modelTaxInclusiveSplit({ grossAmount: '3', taxRateBps: 10000, decimals: 0 });
  assert.equal(r.taxAmount, 1n);
  assert.equal(r.netAmount, 2n);
  assert.equal(r.taxShareBpsText, '3333.33');
  assert.equal(r.netShareBpsText, '6666.66');
});

test('amounts beyond float precision stay exact: a 2^53+1 price at 2000 bps contains 1501199875790165 of tax and 7505999378950828 before tax', () => {
  const r = modelTaxInclusiveSplit({ grossAmount: '9007199254740993', taxRateBps: 2000, decimals: 0 });
  assert.equal(r.taxAmount, 1501199875790165n);
  assert.equal(r.netAmount, 7505999378950828n);
  assert.equal(r.taxShareBpsText, '1666.66');
  assert.equal(r.netShareBpsText, '8333.33');
});

test('the extraction floors on an odd price: 999 at 10000 bps contains 499 of tax and 500 before tax, never 500 of tax taken by rounding up', () => {
  const r = modelTaxInclusiveSplit({ grossAmount: '999', taxRateBps: 10000, decimals: 0 });
  assert.equal(r.taxAmount, 499n);
  assert.equal(r.netAmount, 500n);
  assert.equal(r.taxAmount + r.netAmount, 999n);
});

test('a zero tax-inclusive amount is refused: a price of nothing contains no split', () => {
  assert.throws(() => modelTaxInclusiveSplit({ grossAmount: '0', taxRateBps: 2000, decimals: 6 }), /Tax-inclusive amount must be greater than zero/);
  assert.throws(() => modelTaxInclusiveSplit({ taxRateBps: 2000, decimals: 6 }), /Tax-inclusive amount must be greater than zero/);
});

test('a rate beyond the whole or fractional is refused: the stated rate is a whole share of the amount before tax', () => {
  assert.throws(() => modelTaxInclusiveSplit({ grossAmount: '1000', taxRateBps: 10001, decimals: 6 }), /Tax rate must be a whole number of basis points/);
  assert.throws(() => modelTaxInclusiveSplit({ grossAmount: '1000', taxRateBps: 12.5, decimals: 6 }), /Tax rate must be a whole number of basis points/);
  assert.throws(() => modelTaxInclusiveSplit({ grossAmount: '1000', taxRateBps: -1, decimals: 6 }), /Tax rate must be a whole number of basis points/);
});

test('a negative amount is refused at parsing, before the model ever sees it', () => {
  assert.throws(() => modelTaxInclusiveSplit({ grossAmount: '-1', taxRateBps: 2000, decimals: 6 }), /Enter a positive decimal amount/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelTip, modelTaxExclusiveTotal } from '../src/domain.js';

// Tip model (v1.281): a NEW axis — money given extra,
// voluntarily, on top of an amount due. The tip is
// measured against the BILL (never a tax-inclusive
// total), floored to the base unit, and bounded by
// nothing in its base; the shares are derived from the
// amounts against the total due, floored.
const DEFAULT = { billAmount: '100', tipRateBps: 2000, decimals: 6 };

test('the preloaded tip: a 100 bill at a stated 2000 bps rate tips 20 and the total due is 120, shares 1666.66 and 8333.33', () => {
  const r = modelTip(DEFAULT);
  assert.equal(r.billAmount, 100000000n);
  assert.equal(r.tipAmount, 20000000n);
  assert.equal(r.totalDue, 120000000n);
  assert.equal(r.tipShareBpsText, '1666.66');
  assert.equal(r.billShareBpsText, '8333.33');
});

test('the default rate is none stated when none is given: the total due is the bill whole', () => {
  const r = modelTip({ billAmount: '100', decimals: 6 });
  assert.equal(r.tipRateBps, 0);
  assert.equal(r.tipAmount, 0n);
  assert.equal(r.totalDue, r.billAmount);
  assert.equal(r.noTipStated, true);
});

test('identities hold across bills: the bill plus the tip is the total due, exactly', () => {
  const cases = [
    DEFAULT,
    { billAmount: '100', tipRateBps: 0, decimals: 6 },
    { billAmount: '100', tipRateBps: 10000, decimals: 6 },
    { billAmount: '100', tipRateBps: 15000, decimals: 6 },
    { billAmount: '777', tipRateBps: 2000, decimals: 0 },
    { billAmount: '9007199254740993', tipRateBps: 2000, decimals: 0 },
    { billAmount: '0.000001', tipRateBps: 100, decimals: 6 },
    { billAmount: '3', tipRateBps: 3333, decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelTip(c);
    assert.equal(r.billAmount + r.tipAmount, r.totalDue);
  }
});

test('the tip is measured against the bill, never against a tax-inclusive total: on a 1000 bill with 200 of tax added, a stated 20% rate tips 200, not the 240 the total states', () => {
  const taxed = modelTaxExclusiveTotal({ netAmount: '1000', taxRateBps: 2000, decimals: 0 });
  assert.equal(taxed.taxAmount, 200n);
  assert.equal(taxed.grossAmount, 1200n);
  const r = modelTip({ billAmount: '1000', tipRateBps: 2000, decimals: 0 });
  assert.equal(r.tipAmount, 200n);
  assert.notEqual(r.tipAmount, taxed.grossAmount * 2000n / 10000n);
  assert.equal(r.tipMeasuredOnTaxInclusiveTotal, false);
});

test('measuring against the tax-inclusive total overstates the tip by exactly the stated rate taken on the tax: 40 on the 200 of tax at a stated 20% rate', () => {
  const r = modelTip({ billAmount: '1000', tipRateBps: 2000, decimals: 0 });
  assert.equal(1200n * 2000n / 10000n, 240n);
  assert.equal(240n - r.tipAmount, 200n * 2000n / 10000n);
});

test('a rate of the whole tips an amount equal to the bill: the total due is twice the bill exactly', () => {
  const r = modelTip({ billAmount: '100', tipRateBps: 10000, decimals: 6 });
  assert.equal(r.tipAmount, r.billAmount);
  assert.equal(r.totalDue, 200000000n);
  assert.equal(r.tipEqualsBill, true);
  assert.equal(r.tipExceedsBill, false);
});

test('a rate beyond the whole is stated, never refused: at 15000 bps on a 100 bill the tip is 150, the total due 250, shares 6000.00 and 4000.00', () => {
  const r = modelTip({ billAmount: '100', tipRateBps: 15000, decimals: 6 });
  assert.equal(r.tipAmount, 150000000n);
  assert.equal(r.totalDue, 250000000n);
  assert.equal(r.tipShareBpsText, '6000.00');
  assert.equal(r.billShareBpsText, '4000.00');
  assert.equal(r.tipExceedsBill, true);
});

test('the no-decimals 777 case: a stated 2000 bps rate on 777 tips 155 and the total due is 932, shares 1663.09 and 8336.90', () => {
  const r = modelTip({ billAmount: '777', tipRateBps: 2000, decimals: 0 });
  assert.equal(r.tipAmount, 155n);
  assert.equal(r.totalDue, 932n);
  assert.equal(r.tipShareBpsText, '1663.09');
  assert.equal(r.billShareBpsText, '8336.90');
});

test('a payment beyond float precision: a 2^53+1 bill at a stated 2000 bps rate tips exactly 1801439850948198', () => {
  const r = modelTip({ billAmount: '9007199254740993', tipRateBps: 2000, decimals: 0 });
  assert.equal(r.tipAmount, 1801439850948198n);
  assert.equal(r.totalDue, 10808639105689191n);
});

test('a stated rate that floors to zero on a tiny bill adds nothing at that size, stated as such', () => {
  const r = modelTip({ billAmount: '3', tipRateBps: 3333, decimals: 0 });
  assert.equal(r.tipAmount, 0n);
  assert.equal(r.totalDue, 3n);
  assert.equal(r.tipFloorsToZero, true);
  assert.equal(r.noTipStated, false);
});

test('who receives the tip is never priced', () => {
  const r = modelTip(DEFAULT);
  assert.equal(r.recipientPriced, false);
});

test('a bill of zero or less is refused', () => {
  assert.throws(() => modelTip({ billAmount: '0', tipRateBps: 2000, decimals: 6 }), /greater than zero/);
});

test('a negative or fractional or absurd rate is refused', () => {
  assert.throws(() => modelTip({ billAmount: '100', tipRateBps: -1, decimals: 6 }), /basis points/);
  assert.throws(() => modelTip({ billAmount: '100', tipRateBps: 2000.5, decimals: 6 }), /basis points/);
  assert.throws(() => modelTip({ billAmount: '100', tipRateBps: 100001, decimals: 6 }), /basis points/);
});

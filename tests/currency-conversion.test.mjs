import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCurrencyConversion } from '../src/domain.js';

// Currency conversion model (v1.208): a NEW axis — an amount
// changing unit at a stated rate. The rate is stated as an
// exact fraction (numerator over denominator), the conversion
// is floored to the target base unit, and what the floor
// leaves below one target base unit is stated as a remainder,
// never silently kept. No fee, spread, rate source, or reverse
// conversion is priced.
const DEFAULT = { amount: '103', rateNumerator: '4', rateDenominator: '3', decimals: 6 };

test('the preloaded conversion: 103 at a stated rate of 4/3 hands over 137.333333, floored, with a remainder of 1/3 of a base unit', () => {
  const r = modelCurrencyConversion(DEFAULT);
  assert.equal(r.amount, 103000000n);
  assert.equal(r.rateNumerator, 4n);
  assert.equal(r.rateDenominator, 3n);
  assert.equal(r.exactProduct, 412000000n);
  assert.equal(r.convertedAmount, 137333333n);
  assert.equal(r.conversionRemainder, 1n);
  assert.equal(r.convertsUp, true);
  assert.equal(r.convertsDown, false);
  assert.equal(r.exactConversion, false);
  assert.equal(r.convertsToZero, false);
  assert.equal(r.remainderShareBpsText, '0.00');
});

test('identity holds across conversions: converted times denominator plus remainder is the amount times numerator, exactly', () => {
  const cases = [
    DEFAULT,
    { amount: '777', rateNumerator: '3', rateDenominator: '2', decimals: 0 },
    { amount: '100', rateNumerator: '1', rateDenominator: '2', decimals: 6 },
    { amount: '100', rateNumerator: '5', rateDenominator: '5', decimals: 6 },
    { amount: '0.000001', rateNumerator: '1', rateDenominator: '2', decimals: 6 },
    { amount: '9007199254740993', rateNumerator: '3', rateDenominator: '2', decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelCurrencyConversion(c);
    assert.equal(r.convertedAmount * r.rateDenominator + r.conversionRemainder, r.amount * r.rateNumerator);
    assert.equal(r.convertedAmount * r.rateDenominator + r.conversionRemainder, r.exactProduct);
    assert.ok(r.conversionRemainder < r.rateDenominator);
  }
});

test('rounding the conversion up instead would hand over a target unit the stated rate never priced', () => {
  const r = modelCurrencyConversion(DEFAULT);
  const roundedUp = r.convertedAmount + 1n;
  assert.ok(roundedUp * r.rateDenominator > r.exactProduct);
  assert.equal(r.convertedAmount * r.rateDenominator + r.conversionRemainder, r.exactProduct);
});

test('a one-to-one rate converts the amount whole, exactly, with no remainder', () => {
  const r = modelCurrencyConversion({ amount: '100', rateNumerator: '5', rateDenominator: '5', decimals: 6 });
  assert.equal(r.convertedAmount, 100000000n);
  assert.equal(r.conversionRemainder, 0n);
  assert.equal(r.rateIsOneToOne, true);
  assert.equal(r.exactConversion, true);
  assert.equal(r.convertsUp, false);
  assert.equal(r.convertsDown, false);
});

test('a rate below one converts down: 100 at 1/2 hands over 50 exactly', () => {
  const r = modelCurrencyConversion({ amount: '100', rateNumerator: '1', rateDenominator: '2', decimals: 6 });
  assert.equal(r.convertedAmount, 50000000n);
  assert.equal(r.convertsDown, true);
  assert.equal(r.exactConversion, true);
});

test('an amount below one target base unit at the stated rate converts to zero, stated as such', () => {
  const r = modelCurrencyConversion({ amount: '0.000001', rateNumerator: '1', rateDenominator: '2', decimals: 6 });
  assert.equal(r.convertedAmount, 0n);
  assert.equal(r.convertsToZero, true);
  assert.equal(r.conversionRemainder, 1n);
  assert.equal(r.remainderShareBpsText, '10000.00');
});

test('the 777 case at no decimals: 777 at 3/2 hands over 1165 with a remainder of 1, a 4.29 share of the exact product', () => {
  const r = modelCurrencyConversion({ amount: '777', rateNumerator: '3', rateDenominator: '2', decimals: 0 });
  assert.equal(r.convertedAmount, 1165n);
  assert.equal(r.conversionRemainder, 1n);
  assert.equal(r.remainderShareBpsText, '4.29');
});

test('amounts beyond float precision stay exact: a 2^53+1 amount at 3/2 converts to 13510798882111489 with a remainder of 1', () => {
  const r = modelCurrencyConversion({ amount: '9007199254740993', rateNumerator: '3', rateDenominator: '2', decimals: 0 });
  assert.equal(r.convertedAmount, 13510798882111489n);
  assert.equal(r.conversionRemainder, 1n);
});

test('a zero amount is refused', () => {
  assert.throws(() => modelCurrencyConversion({ ...DEFAULT, amount: '0' }), /Amount must be greater than zero/);
});

test('a zero rate numerator is refused: a rate of zero would convert every amount to nothing', () => {
  assert.throws(() => modelCurrencyConversion({ ...DEFAULT, rateNumerator: '0' }), /Rate numerator must be/);
});

test('a zero rate denominator is refused', () => {
  assert.throws(() => modelCurrencyConversion({ ...DEFAULT, rateDenominator: '0' }), /Rate denominator must be/);
});

test('a decimal rate part is refused: the rate is stated as an exact fraction, never a decimal', () => {
  assert.throws(() => modelCurrencyConversion({ ...DEFAULT, rateNumerator: '1.5' }), /exact fraction/);
  assert.throws(() => modelCurrencyConversion({ ...DEFAULT, rateDenominator: '0.5' }), /exact fraction/);
});

test('a negative rate part is refused', () => {
  assert.throws(() => modelCurrencyConversion({ ...DEFAULT, rateNumerator: '-3' }), /Rate numerator must be/);
});

test('what is not priced is stated: fee, rate source, and reverse conversion are flagged unpriced', () => {
  const r = modelCurrencyConversion(DEFAULT);
  assert.equal(r.feePriced, false);
  assert.equal(r.rateSourcePriced, false);
  assert.equal(r.reverseConversionPriced, false);
});

test('wiring: the app imports the model, renders a currency-conversion panel, and the README names the model', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(app.includes('modelCurrencyConversion'));
  assert.ok(app.includes('data-fxconv'));
  assert.ok(app.includes('fxconv-output'));
  assert.ok(readme.includes('Currency conversion model'));
});

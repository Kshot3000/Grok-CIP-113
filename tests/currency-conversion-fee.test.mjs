import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCurrencyConversion, modelCurrencyConversionFee } from '../src/domain.js';

// Currency conversion fee model (v1.237): the conversion
// axis's second moment — a stated fee taken from the
// converted amount. The fee is floor(converted x rate /
// 10,000), measured against the converted amount in target
// units, never against the source amount in its different
// unit; the net is what remains, and fee + net === converted
// exactly. No fee recipient, rate source, or reverse
// conversion is priced.
const DEFAULT = { amount: '103', rateNumerator: '4', rateDenominator: '3', feeRateBps: 250, decimals: 6 };

test('the preloaded conversion fee: 103 at 4/3 converts to 137.333333 and a stated 250-basis-point fee takes 3.433333, handing over 133.900000', () => {
  const r = modelCurrencyConversionFee(DEFAULT);
  assert.equal(r.amount, 103000000n);
  assert.equal(r.convertedAmount, 137333333n);
  assert.equal(r.conversionRemainder, 1n);
  assert.equal(r.feeRateBps, 250);
  assert.equal(r.feeAmount, 3433333n);
  assert.equal(r.netAmount, 133900000n);
  assert.equal(r.feeShareBpsText, '249.99');
  assert.equal(r.netShareBpsText, '9750.00');
  assert.equal(r.noFeeStated, false);
  assert.equal(r.feeTakesWhole, false);
});

test('identity holds across conversions with fees: fee plus net is the converted amount, exactly', () => {
  const cases = [
    DEFAULT,
    { amount: '777', rateNumerator: '3', rateDenominator: '2', feeRateBps: 250, decimals: 0 },
    { amount: '100', rateNumerator: '1', rateDenominator: '2', feeRateBps: 10000, decimals: 6 },
    { amount: '100', rateNumerator: '5', rateDenominator: '5', feeRateBps: 0, decimals: 6 },
    { amount: '0.000001', rateNumerator: '1', rateDenominator: '2', feeRateBps: 250, decimals: 6 },
    { amount: '9007199254740993', rateNumerator: '3', rateDenominator: '2', feeRateBps: 250, decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelCurrencyConversionFee(c);
    assert.equal(r.feeAmount + r.netAmount, r.convertedAmount);
    assert.ok(r.feeAmount <= r.convertedAmount);
  }
});

test('the model composes the conversion model unchanged: the converted amount is the base model\u2019s own', () => {
  const r = modelCurrencyConversionFee(DEFAULT);
  const b = modelCurrencyConversion({ amount: DEFAULT.amount, rateNumerator: DEFAULT.rateNumerator, rateDenominator: DEFAULT.rateDenominator, decimals: DEFAULT.decimals });
  assert.equal(r.convertedAmount, b.convertedAmount);
  assert.equal(r.conversionRemainder, b.conversionRemainder);
  assert.equal(r.exactProduct, b.exactProduct);
});

test('measuring the fee against the source amount instead would price it in the wrong unit', () => {
  const r = modelCurrencyConversionFee(DEFAULT);
  const feeOnSource = r.amount * BigInt(r.feeRateBps) / 10000n;
  assert.equal(feeOnSource, 2575000n);
  assert.equal(r.feeAmount, 3433333n);
  assert.ok(r.feeAmount > feeOnSource);
});

test('a fee rate of zero states no fee: the converted amount is handed over whole', () => {
  const r = modelCurrencyConversionFee({ ...DEFAULT, feeRateBps: 0 });
  assert.equal(r.feeAmount, 0n);
  assert.equal(r.netAmount, r.convertedAmount);
  assert.equal(r.noFeeStated, true);
  assert.equal(r.feeShareBpsText, '0.00');
  assert.equal(r.netShareBpsText, '10000.00');
});

test('a fee rate of the whole takes the converted amount whole: the net is zero, stated as such', () => {
  const r = modelCurrencyConversionFee({ ...DEFAULT, feeRateBps: 10000 });
  assert.equal(r.feeAmount, 137333333n);
  assert.equal(r.netAmount, 0n);
  assert.equal(r.feeTakesWhole, true);
  assert.equal(r.feeShareBpsText, '10000.00');
  assert.equal(r.netShareBpsText, '0.00');
});

test('a stated fee rate flooring to zero on a small converted amount takes nothing at that size', () => {
  const r = modelCurrencyConversionFee({ amount: '0.000010', rateNumerator: '1', rateDenominator: '1', feeRateBps: 250, decimals: 6 });
  assert.equal(r.convertedAmount, 10n);
  assert.equal(r.feeAmount, 0n);
  assert.equal(r.netAmount, 10n);
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.noFeeStated, false);
});

test('a conversion converting to zero leaves nothing for a fee to be taken from', () => {
  const r = modelCurrencyConversionFee({ amount: '0.000001', rateNumerator: '1', rateDenominator: '2', feeRateBps: 250, decimals: 6 });
  assert.equal(r.convertedAmount, 0n);
  assert.equal(r.feeAmount, 0n);
  assert.equal(r.netAmount, 0n);
  assert.equal(r.convertsToZero, true);
  assert.equal(r.feeTakesWhole, false);
});

test('the 777 case at no decimals: 777 at 3/2 converts to 1165 and a 250-basis-point fee takes 29, handing over 1136', () => {
  const r = modelCurrencyConversionFee({ amount: '777', rateNumerator: '3', rateDenominator: '2', feeRateBps: 250, decimals: 0 });
  assert.equal(r.convertedAmount, 1165n);
  assert.equal(r.feeAmount, 29n);
  assert.equal(r.netAmount, 1136n);
  assert.equal(r.feeShareBpsText, '248.92');
  assert.equal(r.netShareBpsText, '9751.07');
});

test('amounts beyond float precision stay exact: a 2^53+1 amount at 3/2 with a 250-basis-point fee hands over 13173028910058702', () => {
  const r = modelCurrencyConversionFee({ amount: '9007199254740993', rateNumerator: '3', rateDenominator: '2', feeRateBps: 250, decimals: 0 });
  assert.equal(r.convertedAmount, 13510798882111489n);
  assert.equal(r.feeAmount, 337769972052787n);
  assert.equal(r.netAmount, 13173028910058702n);
});

test('a fee rate beyond the whole is refused: a fee larger than the converted amount is not a fee on the conversion', () => {
  assert.throws(() => modelCurrencyConversionFee({ ...DEFAULT, feeRateBps: 10001 }), /Conversion fee must be/);
});

test('a negative fee rate is refused', () => {
  assert.throws(() => modelCurrencyConversionFee({ ...DEFAULT, feeRateBps: -1 }), /Conversion fee must be/);
});

test('a fractional fee rate is refused', () => {
  assert.throws(() => modelCurrencyConversionFee({ ...DEFAULT, feeRateBps: 2.5 }), /Conversion fee must be/);
});

test('the composed conversion still refuses a zero rate: a confiscating rate prices no fee either', () => {
  assert.throws(() => modelCurrencyConversionFee({ ...DEFAULT, rateNumerator: '0' }), /Rate numerator must be/);
});

test('what is not priced is stated: fee recipient, rate source, and reverse conversion are flagged unpriced', () => {
  const r = modelCurrencyConversionFee(DEFAULT);
  assert.equal(r.feeRecipientPriced, false);
  assert.equal(r.rateSourcePriced, false);
  assert.equal(r.reverseConversionPriced, false);
});

test('wiring: the app imports the model, renders a currency-conversion-fee panel, and the README names the model', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(app.includes('modelCurrencyConversionFee'));
  assert.ok(app.includes('data-fxfee'));
  assert.ok(app.includes('fxfee-output'));
  assert.ok(readme.includes('Currency conversion fee model'));
});

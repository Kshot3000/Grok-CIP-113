import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelInvoiceFactoring, modelInvoiceFactoringShortfall } from '../src/domain.js';

// Invoice factoring shortfall model (v1.200): the debtor pays less
// than the face, and the shortfall is absorbed in a stated order —
// first the seller's second payment, then the factor's fee, and only
// then recovery of the advance. Non-recourse: the seller keeps the
// advance even where part of it is unrecovered.
const DEFAULT = { face: '100000', decimals: 6, advanceBps: 8000, discountFeeBps: 300, collected: '90000' };

test('the preloaded shortfall: collecting 90000 of a 100000 invoice leaves a 10000 shortfall absorbed entirely by the second payment', () => {
  const r = modelInvoiceFactoringShortfall(DEFAULT);
  assert.equal(r.collected, 90000000000n);
  assert.equal(r.shortfall, 10000000000n);
  assert.equal(r.absorbedBySecond, 10000000000n);
  assert.equal(r.absorbedByFee, 0n);
  assert.equal(r.secondPayment, 7000000000n);
  assert.equal(r.fullSecondPayment, 17000000000n);
  assert.equal(r.feeKept, 3000000000n);
  assert.equal(r.advanceRecovered, 80000000000n);
  assert.equal(r.unrecoveredAdvance, 0n);
  assert.equal(r.sellerTotal, 87000000000n);
  assert.equal(r.shortfallWithinSecond, true);
});

test('identities hold across faces, rates, fees, collections, and decimals', () => {
  const cases = [
    DEFAULT,
    { face: '5000', decimals: 6, advanceBps: 7500, discountFeeBps: 200, collected: '4999' },
    { face: '250', decimals: 2, advanceBps: 9000, discountFeeBps: 150, collected: '100' },
    { face: '777', decimals: 0, advanceBps: 5000, discountFeeBps: 99, collected: '555' },
    { face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300, collected: '0' },
    { face: '1000', decimals: 0, advanceBps: 10000, discountFeeBps: 0, collected: '400' },
  ];
  for (const c of cases) {
    const r = modelInvoiceFactoringShortfall(c);
    assert.equal(r.collected + r.shortfall, r.face);
    assert.equal(r.absorbedBySecond + r.absorbedByFee + r.unrecoveredAdvance, r.shortfall);
    assert.equal(r.secondPayment + r.feeKept + r.advanceRecovered, r.collected);
    assert.equal(r.factorKeeps, r.advanceRecovered + r.feeKept);
    assert.equal(r.sellerTotal, r.advance + r.secondPayment);
    assert.ok(r.collected <= r.face);
    assert.ok(r.feeKept <= r.discountFee);
    assert.ok(r.secondPayment <= r.fullSecondPayment);
  }
});

test('a full collection agrees with the factoring model exactly', () => {
  const base = modelInvoiceFactoring({ face: '100000', decimals: 6, advanceBps: 8000, discountFeeBps: 300 });
  const r = modelInvoiceFactoringShortfall({ face: '100000', decimals: 6, advanceBps: 8000, discountFeeBps: 300, collected: '100000' });
  assert.equal(r.fullCollection, true);
  assert.equal(r.noShortfall, true);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.secondPayment, base.secondPayment);
  assert.equal(r.feeKept, base.discountFee);
  assert.equal(r.sellerTotal, base.sellerTotal);
});

test('an unstated collected amount defaults to the face: no shortfall', () => {
  const r = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300 });
  assert.equal(r.collected, 1000n);
  assert.equal(r.fullCollection, true);
});

test('shares are derived from the amounts, not from the entered rates', () => {
  const r = modelInvoiceFactoringShortfall({ face: '777', decimals: 0, advanceBps: 5000, discountFeeBps: 99, collected: '555' });
  assert.equal(r.collectedShareBpsText, '7142.85');
  assert.equal(r.shortfallShareBpsText, '2857.14');
  assert.equal(r.secondPaymentShareBpsText, '2059.20');
  assert.equal(r.feeKeptShareBpsText, '90.09');
  assert.equal(r.sellerShareBpsText, '7052.76');
});

test('the second payment absorbs the shortfall first: the fee and the advance are untouched until it is gone', () => {
  const r = modelInvoiceFactoringShortfall({ face: '11', decimals: 6, advanceBps: 7000, discountFeeBps: 250, collected: '9' });
  assert.equal(r.shortfall, 2000000n);
  assert.equal(r.absorbedBySecond, 2000000n);
  assert.equal(r.secondPayment, 1025000n);
  assert.equal(r.feeKept, 275000n);
  assert.equal(r.advanceRecovered, 7700000n);
});

test('a shortfall exactly equal to the second payment leaves the seller no second payment but keeps the fee whole', () => {
  const r = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300, collected: '830' });
  assert.equal(r.secondPayment, 0n);
  assert.equal(r.sellerGetsNoSecond, true);
  assert.equal(r.shortfallWithinSecond, true);
  assert.equal(r.feeKept, 30n);
  assert.equal(r.unrecoveredAdvance, 0n);
});

test('past the second payment the fee absorbs next: the fee actually kept shrinks', () => {
  const r = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300, collected: '810' });
  assert.equal(r.absorbedBySecond, 170n);
  assert.equal(r.absorbedByFee, 20n);
  assert.equal(r.feeKept, 10n);
  assert.equal(r.feeReduced, true);
  assert.equal(r.feeWipedOut, false);
  assert.equal(r.advanceRecovered, 800n);
  assert.equal(r.sellerTotal, 800n);
});

test('a deeper shortfall wipes out the fee entirely before touching the advance', () => {
  const r = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300, collected: '800' });
  assert.equal(r.feeKept, 0n);
  assert.equal(r.feeWipedOut, true);
  assert.equal(r.unrecoveredAdvance, 0n);
  assert.equal(r.advanceRecovered, 800n);
});

test('only after the second payment and the fee are gone is the advance itself unrecovered', () => {
  const r = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300, collected: '700' });
  assert.equal(r.absorbedBySecond, 170n);
  assert.equal(r.absorbedByFee, 30n);
  assert.equal(r.unrecoveredAdvance, 100n);
  assert.equal(r.advanceRecovered, 700n);
  assert.equal(r.advanceUnrecovered, true);
  assert.equal(r.unrecoveredShareBpsText, '1000.00');
});

test('the model is non-recourse: the seller keeps the whole advance even where part of it is unrecovered', () => {
  const r = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300, collected: '700' });
  assert.equal(r.sellerTotal, 800n);
  assert.equal(r.sellerTotal, r.advance);
  assert.equal(r.factorKeeps, 700n);
});

test('collecting nothing pays no second payment, keeps no fee, and leaves the whole advance unrecovered', () => {
  const r = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300, collected: '0' });
  assert.equal(r.collectsNothing, true);
  assert.equal(r.secondPayment, 0n);
  assert.equal(r.feeKept, 0n);
  assert.equal(r.advanceRecovered, 0n);
  assert.equal(r.unrecoveredAdvance, 800n);
  assert.equal(r.sellerTotal, 800n);
  assert.equal(r.shortfallShareBpsText, '10000.00');
});

test('with a full advance there is no second payment and no fee, so a shortfall falls straight on advance recovery', () => {
  const r = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 10000, discountFeeBps: 0, collected: '400' });
  assert.equal(r.absorbedBySecond, 0n);
  assert.equal(r.absorbedByFee, 0n);
  assert.equal(r.unrecoveredAdvance, 600n);
  assert.equal(r.sellerTotal, 1000n);
});

test('a deeper collection never pays the seller more and never keeps the factor less, at the same terms', () => {
  const shallow = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300, collected: '700' });
  const deep = modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 300, collected: '900' });
  assert.ok(deep.secondPayment > shallow.secondPayment);
  assert.ok(deep.feeKept >= shallow.feeKept);
  assert.ok(deep.sellerTotal > shallow.sellerTotal);
  assert.equal(deep.secondPayment - shallow.secondPayment, 70n);
});

test('collecting more than the face is refused', () => {
  assert.throws(() => modelInvoiceFactoringShortfall({ ...DEFAULT, collected: '100001' }), /must not exceed the invoice face/);
});

test('the factoring model refusals propagate: a fee taking the whole reserve is still refused', () => {
  assert.throws(() => modelInvoiceFactoringShortfall({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 2000, collected: '900' }), /must not take the whole reserve/);
  assert.throws(() => modelInvoiceFactoringShortfall({ ...DEFAULT, face: '0' }), /Invoice face must be greater than zero/);
});

test('bad collected amounts are refused', () => {
  assert.throws(() => modelInvoiceFactoringShortfall({ ...DEFAULT, collected: '-1' }), /positive decimal amount/);
  assert.throws(() => modelInvoiceFactoringShortfall({ ...DEFAULT, collected: '90,000' }), /positive decimal amount/);
  assert.throws(() => modelInvoiceFactoringShortfall({ ...DEFAULT, advanceBps: 10001 }), /Advance rate must be/);
});

test('wiring: app.js imports the model, renders an invoice factoring shortfall panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelInvoiceFactoringShortfall/);
  assert.match(app, /data-factors/);
  assert.match(app, /factors-output/);
  assert.match(app, /v1\.200/);
  assert.match(readme, /Invoice factoring shortfall model/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelInvoiceFactoring } from '../src/domain.js';

// Invoice factoring model (v1.197): a seller assigns an invoice to a
// factor, who advances a floored share of the face at once, holds the
// rest as a reserve, and takes the disclosed discount fee — floored on
// the face, its stated base — from that reserve when the debtor pays
// in full.
const DEFAULT = { face: '100000', decimals: 6, advanceBps: 8000, discountFeeBps: 300 };

test('the preloaded factoring: a 100000 invoice at an 80% advance and a 300 bps fee pays 80000 at once and 17000 at collection', () => {
  const r = modelInvoiceFactoring(DEFAULT);
  assert.equal(r.advance, 80000000000n);
  assert.equal(r.reserve, 20000000000n);
  assert.equal(r.discountFee, 3000000000n);
  assert.equal(r.secondPayment, 17000000000n);
  assert.equal(r.sellerTotal, 97000000000n);
  assert.equal(r.advanceShareBpsText, '8000.00');
  assert.equal(r.reserveShareBpsText, '2000.00');
  assert.equal(r.feeShareBpsText, '300.00');
  assert.equal(r.secondPaymentShareBpsText, '1700.00');
  assert.equal(r.sellerShareBpsText, '9700.00');
});

test('identities hold across faces, advance rates, fees, and decimals', () => {
  const cases = [
    { face: '5000', decimals: 6, advanceBps: 7500, discountFeeBps: 200 },
    { face: '250', decimals: 2, advanceBps: 9000, discountFeeBps: 150 },
    { face: '777', decimals: 0, advanceBps: 5000, discountFeeBps: 99 },
    { face: '42', decimals: 6, advanceBps: 0, discountFeeBps: 500 },
    { face: '1000', decimals: 0, advanceBps: 10000, discountFeeBps: 0 },
  ];
  for (const c of cases) {
    const r = modelInvoiceFactoring(c);
    assert.equal(r.advance + r.secondPayment + r.discountFee, r.face);
    assert.equal(r.advance + r.reserve, r.face);
    assert.equal(r.sellerTotal, r.face - r.discountFee);
    assert.equal(r.sellerTotal, r.advance + r.secondPayment);
    assert.ok(r.discountFee <= r.reserve);
  }
});

test('the advance is floored on the face, never rounded up, and the flooring stays in the reserve', () => {
  const r = modelInvoiceFactoring({ face: '777', decimals: 0, advanceBps: 5000, discountFeeBps: 99 });
  assert.equal(r.advance, 388n);
  assert.equal(r.reserve, 389n);
  assert.equal(r.advanceFloors, true);
  assert.ok(r.advance * 10000n <= r.face * 5000n);
});

test('shares are derived from the amounts, not from the entered rates', () => {
  const r = modelInvoiceFactoring({ face: '777', decimals: 0, advanceBps: 5000, discountFeeBps: 99 });
  assert.equal(r.advanceShareBpsText, '4993.56');
  assert.equal(r.reserveShareBpsText, '5006.43');
  assert.equal(r.feeShareBpsText, '90.09');
  assert.equal(r.secondPaymentShareBpsText, '4916.34');
  assert.equal(r.sellerShareBpsText, '9909.90');
});

test('the discount fee is charged on the face, never on the advance or the reserve', () => {
  const r = modelInvoiceFactoring(DEFAULT);
  assert.equal(r.discountFee, r.face * 300n / 10000n);
  assert.notEqual(r.discountFee, r.advance * 300n / 10000n);
  assert.notEqual(r.discountFee, r.reserve * 300n / 10000n);
  assert.equal(r.secondPayment, r.reserve - r.discountFee);
});

test('the fee is taken from the reserve at collection, so the advance is paid in full at once', () => {
  const r = modelInvoiceFactoring({ face: '11', decimals: 6, advanceBps: 7000, discountFeeBps: 250 });
  assert.equal(r.advance, 7700000n);
  assert.equal(r.reserve, 3300000n);
  assert.equal(r.discountFee, 275000n);
  assert.equal(r.secondPayment, 3025000n);
  assert.equal(r.sellerTotal, 10725000n);
});

test('a zero advance rate pays nothing at once: everything arrives at collection, minus the fee', () => {
  const r = modelInvoiceFactoring({ face: '1000', decimals: 0, advanceBps: 0, discountFeeBps: 100 });
  assert.equal(r.advancesNothing, true);
  assert.equal(r.advance, 0n);
  assert.equal(r.reserve, 1000n);
  assert.equal(r.secondPayment, 990n);
  assert.equal(r.sellerTotal, 990n);
});

test('a full advance holds no reserve back, so no fee can be taken from one', () => {
  const r = modelInvoiceFactoring({ face: '1000', decimals: 0, advanceBps: 10000, discountFeeBps: 0 });
  assert.equal(r.fullAdvance, true);
  assert.equal(r.reserve, 0n);
  assert.equal(r.secondPayment, 0n);
  assert.equal(r.sellerTotal, 1000n);
  assert.throws(() => modelInvoiceFactoring({ face: '1000', decimals: 0, advanceBps: 10000, discountFeeBps: 100 }), /must not exceed the reserve/);
});

test('a discount fee larger than the reserve is refused', () => {
  assert.throws(() => modelInvoiceFactoring({ face: '1000', decimals: 0, advanceBps: 9000, discountFeeBps: 2000 }), /must not exceed the reserve/);
});

test('a discount fee taking the whole reserve is refused', () => {
  assert.throws(() => modelInvoiceFactoring({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 2000 }), /must not take the whole reserve/);
});

test('a stated fee that floors to zero on a small invoice is stated, not presented as taken', () => {
  const r = modelInvoiceFactoring({ face: '10', decimals: 0, advanceBps: 8000, discountFeeBps: 250 });
  assert.equal(r.discountFee, 0n);
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.secondPayment, 2n);
  assert.equal(r.sellerTotal, 10n);
});

test('with no discount fee the seller receives the whole face across the two payments', () => {
  const r = modelInvoiceFactoring({ face: '1000', decimals: 0, advanceBps: 8000, discountFeeBps: 0 });
  assert.equal(r.noFee, true);
  assert.equal(r.secondPayment, 200n);
  assert.equal(r.sellerTotal, 1000n);
  assert.equal(r.sellerShareBpsText, '10000.00');
});

test('a higher advance rate moves money earlier but never changes what the seller receives in total at the same fee', () => {
  const low = modelInvoiceFactoring({ face: '1000', decimals: 0, advanceBps: 5000, discountFeeBps: 300 });
  const high = modelInvoiceFactoring({ face: '1000', decimals: 0, advanceBps: 9000, discountFeeBps: 300 });
  assert.equal(low.sellerTotal, 970n);
  assert.equal(high.sellerTotal, 970n);
  assert.equal(high.advance - low.advance, 400n);
  assert.equal(low.secondPayment - high.secondPayment, 400n);
});

test('the seller total falls by exactly the fee, never by the reserve', () => {
  const r = modelInvoiceFactoring(DEFAULT);
  assert.equal(r.face - r.sellerTotal, r.discountFee);
  assert.ok(r.secondPayment > 0n);
});

test('a zero or negative face is refused', () => {
  assert.throws(() => modelInvoiceFactoring({ ...DEFAULT, face: '0' }), /Invoice face must be greater than zero/);
  assert.throws(() => modelInvoiceFactoring({ ...DEFAULT, face: '-1' }), /positive decimal amount/);
});

test('bad amounts, rates, and fees are refused', () => {
  assert.throws(() => modelInvoiceFactoring({ ...DEFAULT, face: '1,000' }), /positive decimal amount/);
  assert.throws(() => modelInvoiceFactoring({ ...DEFAULT, advanceBps: 10001 }), /Advance rate must be/);
  assert.throws(() => modelInvoiceFactoring({ ...DEFAULT, advanceBps: 2.5 }), /Advance rate must be/);
  assert.throws(() => modelInvoiceFactoring({ ...DEFAULT, discountFeeBps: 10001 }), /Discount fee must be/);
  assert.throws(() => modelInvoiceFactoring({ ...DEFAULT, discountFeeBps: -1 }), /Discount fee must be/);
});

test('wiring: app.js imports the model, renders an invoice factoring panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelInvoiceFactoring/);
  assert.match(app, /data-factor/);
  assert.match(app, /factor-output/);
  assert.match(app, /v1\.197/);
  assert.match(readme, /Invoice factoring model/);
});

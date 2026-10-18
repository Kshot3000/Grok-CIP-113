import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelMarketplaceSale } from '../src/domain.js';

// Marketplace sale model: a sale carries two deductions from one price —
// the platform fee and a creator royalty. The royalty is a share of the
// sale, floored on the FULL price, never on the after-fee remainder; the
// two together taking the whole price is refused, because a design whose
// deductions leave the seller nothing must be redesigned, not priced.
const DEFAULT = { amount: '1000', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', royaltyBps: 250, salesPerMonth: 20 };

test('the default sale: platform fee 10, royalty 25 on the full price, the seller receives 965', () => {
  const r = modelMarketplaceSale(DEFAULT);
  assert.equal(r.gross, 1000000000n);
  assert.equal(r.platformFee, 10000000n);
  assert.equal(r.royalty, 25000000n);
  assert.equal(r.sellerNet, 965000000n);
  assert.equal(r.net, r.sellerNet);
  assert.equal(r.combinedDeductions, 35000000n);
  assert.equal(r.platformEffectiveBpsText, '100.00');
  assert.equal(r.royaltyEffectiveBpsText, '250.00');
  assert.equal(r.combinedEffectiveBpsText, '350.00');
  assert.equal(r.capApplied, false);
});

test('accounting identity: platform fee + royalty + seller net is always the price', () => {
  const inputs = [
    DEFAULT,
    { ...DEFAULT, feeBps: 250, fixedFee: '1.5', royaltyBps: 500 },
    { ...DEFAULT, feeBps: 33, royaltyBps: 33 },
    { ...DEFAULT, amount: '7', decimals: 0, feeBps: 999, royaltyBps: 1 },
    { ...DEFAULT, amount: '123.456', feeBps: 500, maxFee: '3', royaltyBps: 777 },
  ];
  for (const input of inputs) {
    const r = modelMarketplaceSale(input);
    assert.equal(r.platformFee + r.royalty + r.sellerNet, r.gross, JSON.stringify(input));
  }
});

test('the royalty is computed on the gross price: a platform cap changes the fee and the net, never the royalty', () => {
  const uncapped = modelMarketplaceSale(DEFAULT);
  const capped = modelMarketplaceSale({ ...DEFAULT, maxFee: '5' });
  assert.equal(uncapped.platformFee, 10000000n);
  assert.equal(capped.platformFee, 5000000n);
  assert.equal(capped.capApplied, true);
  assert.equal(capped.platformUncappedFee, 10000000n);
  assert.equal(capped.royalty, uncapped.royalty);
  assert.equal(capped.royalty, 25000000n);
  assert.equal(capped.sellerNet, 970000000n);
  // On the after-fee remainder the royalty would be floor(995 × 2.5%) = 24.875 — it is 25, on the gross.
  assert.notEqual(capped.royalty, 24875000n);
});

test('a fixed platform fee is part of the platform fee only — the royalty never includes it', () => {
  const r = modelMarketplaceSale({ ...DEFAULT, fixedFee: '2.5' });
  assert.equal(r.platformFee, 12500000n);
  assert.equal(r.royalty, 25000000n);
  assert.equal(r.sellerNet, 962500000n);
});

test('floor rounding is exact: both deductions round down to the base unit', () => {
  const r = modelMarketplaceSale({ amount: '0.000003', decimals: 6, feeBps: 5000, fixedFee: '0', maxFee: '', royaltyBps: 3333, salesPerMonth: 1 });
  assert.equal(r.gross, 3n);
  assert.equal(r.platformFee, 1n); // floor(3 × 5000 ÷ 10,000) = floor(1.5)
  assert.equal(r.royalty, 0n); // floor(3 × 3333 ÷ 10,000) = floor(0.9999)
  assert.equal(r.sellerNet, 2n);
});

test('a platform fee that alone would take the whole price is refused by the split, unchanged', () => {
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, feeBps: 10000, royaltyBps: 0 }), /whole transfer/);
});

test('the two deductions together taking the whole price is refused with its own message', () => {
  // Each deduction alone is half the price — the platform fee alone passes the split.
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, feeBps: 5000, royaltyBps: 5000 }), /together would take the whole price/);
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, feeBps: 0, royaltyBps: 10000 }), /together would take the whole price/);
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, feeBps: 6000, royaltyBps: 5000 }), /together would take the whole price/);
});

test('a royalty of zero: the royalty is zero and the seller receives the price minus the platform fee', () => {
  const r = modelMarketplaceSale({ ...DEFAULT, royaltyBps: 0 });
  assert.equal(r.royalty, 0n);
  assert.equal(r.royaltyEffectiveBpsText, '0.00');
  assert.equal(r.sellerNet, 990000000n);
  assert.equal(r.combinedDeductions, r.platformFee);
});

test('royalty validation: a non-whole or out-of-range royalty is refused with a clear message', () => {
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, royaltyBps: 10001 }), /Royalty must be a whole number/);
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, royaltyBps: -1 }), /Royalty must be a whole number/);
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, royaltyBps: 2.5 }), /Royalty must be a whole number/);
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, royaltyBps: 'high' }), /Royalty must be a whole number/);
  const d = modelMarketplaceSale({ amount: '1000', decimals: 6, feeBps: 100 });
  assert.equal(d.royaltyBps, 250);
});

test('monthly sales validation: a non-whole or out-of-range count is refused, and the default is 20', () => {
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, salesPerMonth: 0 }), /Monthly sales must be a whole number/);
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, salesPerMonth: 1000001 }), /Monthly sales must be a whole number/);
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, salesPerMonth: 1.5 }), /Monthly sales must be a whole number/);
  const d = modelMarketplaceSale({ amount: '1000', decimals: 6, feeBps: 100, royaltyBps: 250 });
  assert.equal(d.salesPerMonth, 20);
});

test('the monthly projection is the per-sale figures at the entered count, computed from the totals', () => {
  const r = modelMarketplaceSale(DEFAULT);
  assert.equal(r.monthly.gross, 20000000000n);
  assert.equal(r.monthly.platformFee, 200000000n);
  assert.equal(r.monthly.royalty, 500000000n);
  assert.equal(r.monthly.sellerNet, 19300000000n);
  assert.equal(r.monthly.platformFee + r.monthly.royalty + r.monthly.sellerNet, r.monthly.gross);
});

test('royalty-level rows: seller nets at 0–1,000 bps at the same platform fee, exact', () => {
  const r = modelMarketplaceSale(DEFAULT);
  assert.deepEqual(r.rows.map(row => row.royaltyBps), [0, 250, 500, 750, 1000]);
  assert.deepEqual(r.rows.map(row => row.royalty), [0n, 25000000n, 50000000n, 75000000n, 100000000n]);
  assert.deepEqual(r.rows.map(row => row.sellerNet), [990000000n, 965000000n, 940000000n, 915000000n, 890000000n]);
  assert.ok(r.rows.every(row => row.takesAll === false));
});

test('a royalty level whose deductions would take the whole price is flagged in its row, not refused', () => {
  const r = modelMarketplaceSale({ amount: '100', decimals: 6, feeBps: 9500, fixedFee: '0', maxFee: '', royaltyBps: 0, salesPerMonth: 1 });
  assert.equal(r.platformFee, 95000000n);
  const top = r.rows.find(row => row.royaltyBps === 1000);
  assert.equal(top.royalty, 10000000n);
  assert.equal(top.takesAll, true);
  assert.equal(top.sellerNet, -5000000n); // The row states the arithmetic plainly; the flag is the verdict.
  assert.equal(r.rows.find(row => row.royaltyBps === 0).takesAll, false);
});

test('exactness beyond float range: a 9,007,199,254,740,993-unit sale at 100 bps platform and 250 bps royalty', () => {
  const r = modelMarketplaceSale({ amount: '9007199254740993', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', royaltyBps: 250, salesPerMonth: 1 });
  assert.equal(r.gross, 9007199254740993n);
  assert.equal(r.platformFee, 90071992547409n);
  assert.equal(r.royalty, 225179981368524n);
  assert.equal(r.sellerNet, 8691947280825060n);
  assert.equal(r.platformFee + r.royalty + r.sellerNet, r.gross);
});

test('decimals handling: the split follows the entered scale, and a bad scale is refused by the split', () => {
  const zero = modelMarketplaceSale({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', royaltyBps: 250, salesPerMonth: 1 });
  assert.equal(zero.gross, 1000n);
  assert.equal(zero.platformFee, 10n);
  assert.equal(zero.royalty, 25n);
  assert.equal(zero.sellerNet, 965n);
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, decimals: 7 }), /Decimals/);
  assert.throws(() => modelMarketplaceSale({ ...DEFAULT, amount: '1.0000001' }), /decimal places/);
});

test('effective rates are derived from the amounts, not the entered rates: floor rounding shows in the royalty rate', () => {
  const r = modelMarketplaceSale({ amount: '3', decimals: 0, feeBps: 0, fixedFee: '0', maxFee: '', royaltyBps: 3333, salesPerMonth: 1 });
  assert.equal(r.royalty, 0n); // floor(3 × 3333 ÷ 10,000) = 0
  assert.equal(r.royaltyEffectiveBpsText, '0.00');
  assert.equal(r.combinedEffectiveBpsText, '0.00');
  assert.equal(r.sellerNet, 3n);
});

test('app wires the marketplace model: panel, verdict outcomes, honest boundary, v1.248', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /modelMarketplaceSale/);
  assert.match(app, /Model a marketplace sale/);
  assert.match(app, /data-market="amount"/);
  assert.match(app, /data-market="royaltyBps"/);
  assert.match(app, /id="marketplace-output"/);
  assert.match(app, /PRISM runs no marketplace, lists nothing, and executes no sale/);
  assert.match(app, /v1\.248/);
});

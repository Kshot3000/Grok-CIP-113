import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelMarketplaceEscrow } from '../src/domain.js';

// Marketplace-escrow settlement model: a marketplace sale whose
// seller proceeds enter escrow until delivery, priced end to end.
// The escrow stage prices the PROCEEDS — the price minus the
// platform fee minus the royalty — never the price; on a delivery
// failure the buyer receives the whole price back and no deduction
// is retained, because the sale and its escrow are one settlement
// and a sale that never delivers never completes.
const DEFAULT = { amount: '1000', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', royaltyBps: 250, escrowFeeBps: 100, escrowFixedFee: '0', escrowMaxFee: '', releasedBps: 5000 };

test('the default chain: the sale takes its two deductions on the price, and the proceeds — not the price — enter escrow', () => {
  const r = modelMarketplaceEscrow(DEFAULT);
  assert.equal(r.gross, 1000000000n);
  assert.equal(r.price, r.gross);
  assert.equal(r.platformFee, 10000000n); // 100 bps of the 1,000 price
  assert.equal(r.royalty, 25000000n); // 250 bps of the 1,000 price
  assert.equal(r.proceeds, 965000000n); // The escrowed amount is the price minus both deductions.
  assert.equal(r.sellerProceeds, r.proceeds);
  assert.equal(r.escrowed, r.proceeds);
});

test('full release: the escrow fee is priced on the proceeds, and the three deductions are the whole cost', () => {
  const r = modelMarketplaceEscrow(DEFAULT);
  assert.equal(r.release.escrowFee, 9650000n); // 100 bps of the 965 proceeds — not of the 1,000 price (which would be 10)
  assert.notEqual(r.release.escrowFee, 10000000n);
  assert.equal(r.release.sellerFinalNet, 955350000n);
  assert.equal(r.release.totalDeductions, 44650000n);
  assert.equal(r.totalDeductionsFull, 44650000n);
  assert.equal(r.totalDeductionRateBpsText, '446.50'); // Derived from the three deductions over the price — not the 450 the entered rates suggest.
});

test('accounting identity across both stages on a full release: platform fee + royalty + escrow fee + seller final net is always the price', () => {
  const inputs = [
    DEFAULT,
    { ...DEFAULT, feeBps: 250, fixedFee: '1.5', royaltyBps: 500, escrowFeeBps: 75 },
    { ...DEFAULT, feeBps: 33, royaltyBps: 33, escrowFeeBps: 33 },
    { ...DEFAULT, amount: '7', decimals: 0, feeBps: 999, royaltyBps: 1, escrowFeeBps: 333 },
    { ...DEFAULT, amount: '123.456', feeBps: 500, maxFee: '3', royaltyBps: 777, escrowMaxFee: '1' },
  ];
  for (const input of inputs) {
    const r = modelMarketplaceEscrow(input);
    assert.equal(r.platformFee + r.royalty + r.release.escrowFee + r.release.sellerFinalNet, r.gross, JSON.stringify(input));
    assert.equal(r.platformFee + r.royalty + r.proceeds, r.gross, JSON.stringify(input));
  }
});

test('delivery failure: the buyer receives the whole price back and no deduction is retained — disclosed', () => {
  const r = modelMarketplaceEscrow(DEFAULT);
  assert.equal(r.refund.escrowFee, 0n);
  assert.equal(r.refund.platformFeeRetained, 0n); // Not kept — the sale never completed. (Launch-escrow differs: its launch had completed.)
  assert.equal(r.refund.royaltyRetained, 0n);
  assert.equal(r.refund.buyerReceives, 1000000000n);
  assert.equal(r.refund.refundedTotal, r.gross);
});

test('partial release: the escrow fee is taken only on the released share of the proceeds, and the identity holds', () => {
  const r = modelMarketplaceEscrow(DEFAULT);
  assert.equal(r.partial.releasedGross, 482500000n);
  assert.equal(r.partial.releasedFee, 4825000n);
  assert.equal(r.partial.releasedNet, 477675000n);
  assert.equal(r.partial.stillHeld, 482500000n);
  assert.equal(r.partial.totalDeductions, 39825000n);
  assert.equal(r.platformFee + r.royalty + r.partial.releasedFee + r.partial.releasedNet + r.partial.stillHeld, r.gross);
});

test('partial edges: releasedBps 0 releases nothing and holds everything; 10000 is the full release exactly', () => {
  const zero = modelMarketplaceEscrow({ ...DEFAULT, releasedBps: 0 });
  assert.equal(zero.partial.releasedGross, 0n);
  assert.equal(zero.partial.releasedFee, 0n);
  assert.equal(zero.partial.stillHeld, zero.proceeds);
  const full = modelMarketplaceEscrow({ ...DEFAULT, releasedBps: 10000 });
  assert.equal(full.partial.releasedGross, full.proceeds);
  assert.equal(full.partial.releasedFee, full.release.escrowFee);
  assert.equal(full.partial.releasedNet, full.release.sellerFinalNet);
  assert.equal(full.partial.stillHeld, 0n);
});

test('the marketplace stage refusals are judged on the price: a platform fee taking the whole price is refused before escrow', () => {
  assert.throws(() => modelMarketplaceEscrow({ ...DEFAULT, feeBps: 0, fixedFee: '1000', royaltyBps: 0 }), /whole transfer/);
});

test('the combined refusal is the marketplace stage’s own: platform fee and royalty together taking the whole price is refused', () => {
  assert.throws(() => modelMarketplaceEscrow({ ...DEFAULT, feeBps: 5000, royaltyBps: 5000 }), /together would take the whole price/);
});

test('the escrow stage refusal is judged on the proceeds: a fixed escrow fee past the proceeds but below the price is refused', () => {
  // Price 1,000, platform 10 + royalty 25 → proceeds 965; an escrow
  // fixed fee of 900 fits inside the proceeds and passes.
  const ok = modelMarketplaceEscrow({ ...DEFAULT, escrowFeeBps: 0, escrowFixedFee: '900' });
  assert.equal(ok.proceeds, 965000000n);
  assert.equal(ok.release.escrowFee, 900000000n);
  // The same model with a 990 escrow fee: 990 is below the 1,000
  // price but past the 965 proceeds — refused on the proceeds.
  assert.throws(() => modelMarketplaceEscrow({ ...DEFAULT, escrowFeeBps: 0, escrowFixedFee: '990' }), /whole transfer/);
});

test('caps at both stages bind and are reported, with the escrow cap judged on the proceeds fee', () => {
  const r = modelMarketplaceEscrow({ ...DEFAULT, maxFee: '5', escrowMaxFee: '5' });
  assert.equal(r.platformFee, 5000000n);
  assert.equal(r.capApplied, true);
  assert.equal(r.proceeds, 970000000n); // The royalty never moves: 25 on the price, cap or not.
  assert.equal(r.royalty, 25000000n);
  assert.equal(r.release.escrowFee, 5000000n); // The uncapped proceeds fee would be 9.7.
  assert.equal(r.release.escrowUncappedFee, 9700000n);
  assert.equal(r.release.escrowCapApplied, true);
  assert.equal(r.release.sellerFinalNet, 965000000n);
});

test('a partial computed fee at the whole released part is flagged takesAll, capped at the part, with the identity intact', () => {
  const r = modelMarketplaceEscrow({ amount: '100', decimals: 6, feeBps: 0, fixedFee: '0', maxFee: '', royaltyBps: 0, escrowFeeBps: 0, escrowFixedFee: '60', escrowMaxFee: '', releasedBps: 2500 });
  assert.equal(r.proceeds, 100000000n);
  assert.equal(r.partial.releasedGross, 25000000n);
  assert.equal(r.partial.computedFee, 60000000n);
  assert.equal(r.partial.takesAll, true);
  assert.equal(r.partial.releasedFee, 25000000n); // Capped at the part — the identity wins.
  assert.equal(r.partial.releasedNet, 0n);
  assert.equal(r.platformFee + r.royalty + r.partial.releasedFee + r.partial.releasedNet + r.partial.stillHeld, r.gross);
});

test('release-level rows: release shares of the proceeds at the same three rates, exact', () => {
  const r = modelMarketplaceEscrow(DEFAULT);
  assert.deepEqual(r.rows.map(row => row.levelBps), [0, 2500, 5000, 7500, 10000]);
  assert.deepEqual(r.rows.map(row => row.releasedGross), [0n, 241250000n, 482500000n, 723750000n, 965000000n]);
  assert.deepEqual(r.rows.map(row => row.escrowFee), [0n, 2412500n, 4825000n, 7237500n, 9650000n]);
  assert.deepEqual(r.rows.map(row => row.releasedNet), [0n, 238837500n, 477675000n, 716512500n, 955350000n]);
  assert.deepEqual(r.rows.map(row => row.stillHeld), [965000000n, 723750000n, 482500000n, 241250000n, 0n]);
  assert.deepEqual(r.rows.map(row => row.totalDeductions), [35000000n, 37412500n, 39825000n, 42237500n, 44650000n]);
  assert.ok(r.rows.every(row => row.takesAll === false));
});

test('a release level whose escrow fee would take its whole released part is flagged in its row, not refused', () => {
  const r = modelMarketplaceEscrow({ amount: '100', decimals: 6, feeBps: 0, fixedFee: '0', maxFee: '', royaltyBps: 0, escrowFeeBps: 0, escrowFixedFee: '60', escrowMaxFee: '', releasedBps: 5000 });
  const row = r.rows.find(x => x.levelBps === 2500);
  assert.equal(row.releasedGross, 25000000n);
  assert.equal(row.computedFee, 60000000n);
  assert.equal(row.takesAll, true);
  assert.equal(row.escrowFee, 25000000n);
  assert.equal(row.releasedNet, 0n);
});

test('validation: a bad release share, royalty, or amount is refused by the stage that owns it', () => {
  assert.throws(() => modelMarketplaceEscrow({ ...DEFAULT, releasedBps: 10001 }), /releasedBps/);
  assert.throws(() => modelMarketplaceEscrow({ ...DEFAULT, royaltyBps: -1 }), /Royalty/);
  assert.throws(() => modelMarketplaceEscrow({ ...DEFAULT, amount: '-5' }), /positive decimal amount/);
  assert.throws(() => modelMarketplaceEscrow({ ...DEFAULT, amount: '0' }), /greater than zero/);
});

test('defaults inside the model: omitted fees take the split’s own default rate at both stages', () => {
  const r = modelMarketplaceEscrow({ amount: '1000', decimals: 6 });
  assert.equal(r.feeBps, 100); // The split's own default rate.
  assert.equal(r.escrowFeeBps, 100);
  assert.equal(r.platformFee, 10000000n);
  assert.equal(r.royaltyBps, 250); // The marketplace model's own default royalty rate.
  assert.equal(r.royalty, 25000000n);
  assert.equal(r.proceeds, 965000000n);
});

test('exactness beyond float range: a 9,007,199,254,740,993-unit price at 100 / 250 / 100 bps', () => {
  const r = modelMarketplaceEscrow({ amount: '9007199254740993', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', royaltyBps: 250, escrowFeeBps: 100, escrowFixedFee: '0', escrowMaxFee: '', releasedBps: 10000 });
  assert.equal(r.platformFee, 90071992547409n);
  assert.equal(r.royalty, 225179981368524n);
  assert.equal(r.proceeds, 8691947280825060n);
  assert.equal(r.release.escrowFee, 86919472808250n);
  assert.equal(r.release.sellerFinalNet, 8605027808016810n);
  assert.equal(r.platformFee + r.royalty + r.release.escrowFee + r.release.sellerFinalNet, r.gross);
  assert.equal(r.totalDeductionRateBpsText, '446.49'); // Not 446.50: the escrow fee prices the smaller proceeds base, and the floors bite.
});

test('decimals handling: the chain follows the entered scale, and a bad scale is refused', () => {
  const zero = modelMarketplaceEscrow({ ...DEFAULT, decimals: 0 });
  assert.equal(zero.gross, 1000n);
  assert.equal(zero.platformFee, 10n);
  assert.equal(zero.royalty, 25n);
  assert.equal(zero.proceeds, 965n);
  assert.equal(zero.release.escrowFee, 9n); // floor(965 × 100 ÷ 10,000) at zero decimals.
  assert.equal(zero.release.sellerFinalNet, 956n);
  assert.throws(() => modelMarketplaceEscrow({ ...DEFAULT, decimals: 7 }), /Decimals/);
});

test('app wires the marketplace-escrow model: panel, verdict outcomes, honest boundary, v1.185', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /modelMarketplaceEscrow/);
  assert.match(app, /Model a marketplace sale with escrowed settlement/);
  assert.match(app, /data-mesc="amount"/);
  assert.match(app, /data-mesc="escrowFeeBps"/);
  assert.match(app, /data-mesc="releasedBps"/);
  assert.match(app, /id="marketplace-escrow-output"/);
  assert.match(app, /PRISM runs no marketplace, holds no escrow, and executes no sale/);
  assert.match(app, /v1\.185/);
});

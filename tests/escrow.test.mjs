import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelEscrow } from '../src/domain.js';

// Escrow release model: the fee family prices a single transfer, but an
// escrow is a lifecycle — release, refund, or partial release. The fee
// is taken at release, never at funding, and only on what is actually
// released; a refund is charged zero and returns the full amount,
// because a fee on refunded money would charge for a service never
// completed.
const DEFAULT = { amount: '1000', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', releasedBps: 5000 };

test('full release: the exact service-fee split — 100 bps of 1,000 is a fee of 10, the seller receives 990', () => {
  const r = modelEscrow(DEFAULT);
  assert.equal(r.gross, 1000000000n);
  assert.equal(r.release.fee, 10000000n);
  assert.equal(r.release.platformFee, r.release.fee);
  assert.equal(r.release.sellerNet, 990000000n);
  assert.equal(r.release.fee + r.release.sellerNet, r.gross);
  assert.equal(r.release.effectiveBpsText, '100.00');
  assert.equal(r.release.capApplied, false);
});

test('refund: the fee is zero and the funder receives the full gross back', () => {
  const r = modelEscrow(DEFAULT);
  assert.equal(r.refund.fee, 0n);
  assert.equal(r.refund.refunded, r.gross);
  assert.equal(r.refund.funderReceives, 1000000000n);
});

test('partial release: the fee is taken only on the released part — half released pays half the percentage fee', () => {
  const r = modelEscrow(DEFAULT);
  assert.equal(r.partial.releasedGross, 500000000n);
  assert.equal(r.partial.fee, 5000000n);
  assert.equal(r.partial.releasedFee, r.partial.fee);
  assert.equal(r.partial.releasedNet, 495000000n);
  assert.equal(r.partial.refundedRemainder, 500000000n);
  assert.equal(r.partial.takesAll, false);
  assert.equal(r.partial.capApplied, false);
});

test('accounting identity: released net + released fee + refunded remainder is always the gross', () => {
  const inputs = [
    DEFAULT,
    { ...DEFAULT, feeBps: 250, fixedFee: '1.5' },
    { ...DEFAULT, feeBps: 33, releasedBps: 3333 },
    { ...DEFAULT, amount: '7', decimals: 0, feeBps: 999, releasedBps: 1 },
    { ...DEFAULT, amount: '123.456', feeBps: 500, maxFee: '3', releasedBps: 7777 },
  ];
  for (const input of inputs) {
    const r = modelEscrow(input);
    assert.equal(r.partial.releasedNet + r.partial.fee + r.partial.refundedRemainder, r.gross, JSON.stringify(input));
    assert.equal(r.partial.releasedGross + r.partial.refundedRemainder, r.gross, JSON.stringify(input));
  }
});

test('releasedBps 0: nothing is released, the fee is zero, and everything is refunded', () => {
  const r = modelEscrow({ ...DEFAULT, releasedBps: 0, fixedFee: '2.5' });
  assert.equal(r.partial.releasedGross, 0n);
  assert.equal(r.partial.fee, 0n);
  assert.equal(r.partial.releasedNet, 0n);
  assert.equal(r.partial.refundedRemainder, r.gross);
  assert.equal(r.partial.takesAll, false);
});

test('releasedBps 10000: the partial release equals the full-release outcome exactly', () => {
  const r = modelEscrow({ ...DEFAULT, releasedBps: 10000, fixedFee: '1.5', maxFee: '8' });
  assert.equal(r.partial.releasedGross, r.gross);
  assert.equal(r.partial.fee, r.release.fee);
  assert.equal(r.partial.releasedNet, r.release.sellerNet);
  assert.equal(r.partial.refundedRemainder, 0n);
  assert.equal(r.partial.capApplied, r.release.capApplied);
});

test('a cap bounds the full-release fee and its binding is reported', () => {
  const r = modelEscrow({ ...DEFAULT, maxFee: '5' });
  assert.equal(r.release.uncappedFee, 10000000n);
  assert.equal(r.release.fee, 5000000n);
  assert.equal(r.release.capApplied, true);
  assert.equal(r.release.sellerNet, 995000000n);
});

test('a cap can bind on the partial release even at a smaller released part', () => {
  const r = modelEscrow({ ...DEFAULT, maxFee: '4' });
  // Full release: 1% of 1,000 is 10, capped to 4. Partial: 1% of the
  // released 500 is 5, still above the cap, so the cap binds there too.
  assert.equal(r.partial.releasedGross, 500000000n);
  assert.equal(r.partial.computedFee, 4000000n);
  assert.equal(r.partial.fee, 4000000n);
  assert.equal(r.partial.capApplied, true);
  assert.equal(r.partial.releasedNet, 496000000n);
});

test('a fee that would take the whole amount on a full release is refused, never modeled in part', () => {
  assert.throws(() => modelEscrow({ ...DEFAULT, feeBps: 10000 }), /whole transfer/);
  assert.throws(() => modelEscrow({ amount: '10', decimals: 6, feeBps: 0, fixedFee: '10', releasedBps: 5000 }), /whole transfer/);
});

test('a partial fee that would take the whole released part is flagged takesAll, not refused', () => {
  const r = modelEscrow({ amount: '10', decimals: 6, feeBps: 0, fixedFee: '6', releasedBps: 5000 });
  assert.equal(r.partial.releasedGross, 5000000n);
  assert.equal(r.partial.computedFee, 6000000n);
  assert.equal(r.partial.takesAll, true);
  assert.equal(r.partial.fee, 5000000n);
  assert.equal(r.partial.releasedNet, 0n);
  assert.equal(r.partial.releasedNet + r.partial.fee + r.partial.refundedRemainder, r.gross);
});

test('floor rounding is exact: the released share and the fee both round down to the base unit', () => {
  const r = modelEscrow({ amount: '0.000003', decimals: 6, feeBps: 5000, fixedFee: '0', maxFee: '', releasedBps: 5000 });
  assert.equal(r.gross, 3n);
  assert.equal(r.release.fee, 1n); // floor(3 × 5000 ÷ 10,000) = floor(1.5)
  assert.equal(r.release.sellerNet, 2n);
  assert.equal(r.partial.releasedGross, 1n); // floor(3 × 5000 ÷ 10,000)
  assert.equal(r.partial.fee, 0n); // floor(1 × 5000 ÷ 10,000) = floor(0.5)
  assert.equal(r.partial.releasedNet, 1n);
  assert.equal(r.partial.refundedRemainder, 2n);
});

test('exactness beyond float range: a 9,007,199,254,740,993-unit escrow at 100 bps, half released', () => {
  const r = modelEscrow({ amount: '9007199254740993', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', releasedBps: 5000 });
  assert.equal(r.gross, 9007199254740993n);
  assert.equal(r.release.fee, 90071992547409n);
  assert.equal(r.partial.releasedGross, 4503599627370496n);
  assert.equal(r.partial.fee, 45035996273704n);
  assert.equal(r.partial.releasedNet, 4458563631096792n);
  assert.equal(r.partial.refundedRemainder, 4503599627370497n);
  assert.equal(r.partial.releasedNet + r.partial.fee + r.partial.refundedRemainder, r.gross);
});

test('releasedBps validation: a non-whole or out-of-range share is refused with a clear message', () => {
  assert.throws(() => modelEscrow({ ...DEFAULT, releasedBps: 10001 }), /releasedBps must be a whole number/);
  assert.throws(() => modelEscrow({ ...DEFAULT, releasedBps: -1 }), /releasedBps must be a whole number/);
  assert.throws(() => modelEscrow({ ...DEFAULT, releasedBps: 1.5 }), /releasedBps must be a whole number/);
  assert.throws(() => modelEscrow({ ...DEFAULT, releasedBps: 'half' }), /releasedBps must be a whole number/);
  // The default is a half release.
  const d = modelEscrow({ amount: '1000', decimals: 6, feeBps: 100 });
  assert.equal(d.releasedBps, 5000);
});

test('decimals handling: the split follows the entered scale, and a bad scale is refused by the split', () => {
  const zero = modelEscrow({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', releasedBps: 5000 });
  assert.equal(zero.gross, 1000n);
  assert.equal(zero.release.fee, 10n);
  assert.equal(zero.partial.releasedGross, 500n);
  const two = modelEscrow({ amount: '10.50', decimals: 2, feeBps: 100, fixedFee: '0', maxFee: '', releasedBps: 5000 });
  assert.equal(two.gross, 1050n);
  assert.equal(two.release.fee, 10n); // floor(1050 × 100 ÷ 10,000) = floor(10.5)
  assert.equal(two.release.sellerNet, 1040n);
  assert.throws(() => modelEscrow({ ...DEFAULT, decimals: 7 }), /Decimals/);
  assert.throws(() => modelEscrow({ ...DEFAULT, amount: '1.0000001' }), /decimal places/);
});

test('fee timing and the refund rule: funding collects nothing, and a fixed fee never touches a refund', () => {
  const r = modelEscrow({ ...DEFAULT, fixedFee: '2.5' });
  assert.equal(r.feeAtFunding, 0n);
  assert.equal(r.release.fee, 12500000n); // 10 percentage + 2.5 fixed, at release.
  assert.equal(r.refund.fee, 0n);
  assert.equal(r.refund.funderReceives, r.gross);
});

test('app wires the escrow model: panel, verdict outcomes, honest boundary, v1.169', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /modelEscrow/);
  assert.match(app, /Model an escrow release/);
  assert.match(app, /data-escrow="amount"/);
  assert.match(app, /data-escrow="feeBps"/);
  assert.match(app, /data-escrow="releasedBps"/);
  assert.match(app, /id="escrow-output"/);
  assert.match(app, /PRISM holds no funds, locks nothing, and executes no release or refund/);
  assert.match(app, /v1\.169/);
});

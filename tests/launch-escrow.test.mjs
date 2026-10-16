import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelLaunchEscrow } from '../src/domain.js';

// Launch-escrow milestone model: a launch whose proceeds enter
// escrow, priced end to end. The escrow stage prices the PROCEEDS —
// the fill minus the launch fee — never the fill; on a milestone
// failure the escrow stage charges nothing and everything escrowed
// returns, while the launch fee is retained, disclosed.
const DEFAULT = { hardCap: '50000', subscribed: '75000', decimals: 6, launchFeeBps: 200, launchFixedFee: '0', launchMaxFee: '', escrowFeeBps: 100, escrowFixedFee: '0', escrowMaxFee: '', releasedBps: 5000 };

test('the default chain: the launch fills, its fee is taken, and the proceeds — not the fill — enter escrow', () => {
  const r = modelLaunchEscrow(DEFAULT);
  assert.equal(r.filled, 50000000000n);
  assert.equal(r.launchFee, 1000000000n); // 200 bps of the 50,000 fill
  assert.equal(r.platformFee, r.launchFee);
  assert.equal(r.proceeds, 49000000000n); // The escrowed amount is the fill minus the launch fee.
  assert.equal(r.escrowed, r.proceeds);
  assert.equal(r.launchRefunded, 25000000000n);
  assert.equal(r.oversubscribed, true);
});

test('full release: the escrow fee is priced on the proceeds, and the two fees are the whole cost', () => {
  const r = modelLaunchEscrow(DEFAULT);
  assert.equal(r.release.escrowFee, 490000000n); // 100 bps of the 49,000 proceeds — not of the 50,000 fill (which would be 500)
  assert.notEqual(r.release.escrowFee, 500000000n);
  assert.equal(r.release.issuerFinalNet, 48510000000n);
  assert.equal(r.release.totalFees, 1490000000n);
  assert.equal(r.totalFeesFull, 1490000000n);
  assert.equal(r.totalFeeRateBpsText, '298.00'); // Derived from the two fees over the filled amount.
});

test('accounting identity across both stages on a full release: launch fee + escrow fee + issuer final net + launch refund is always the subscribed amount', () => {
  const inputs = [
    DEFAULT,
    { ...DEFAULT, subscribed: '25000' },
    { ...DEFAULT, subscribed: '50000' },
    { ...DEFAULT, launchFeeBps: 250, launchFixedFee: '1.5', escrowFeeBps: 75, subscribed: '123456' },
    { ...DEFAULT, hardCap: '7', subscribed: '9', decimals: 0, launchFeeBps: 999, escrowFeeBps: 333 },
    { ...DEFAULT, subscribed: '60000', launchMaxFee: '500', escrowMaxFee: '100' },
  ];
  for (const input of inputs) {
    const r = modelLaunchEscrow(input);
    assert.equal(r.launchFee + r.release.escrowFee + r.release.issuerFinalNet + r.launchRefunded, r.subscribed, JSON.stringify(input));
    assert.equal(r.launchFee + r.proceeds + r.launchRefunded, r.subscribed, JSON.stringify(input));
  }
});

test('milestone failure: the escrow stage charges nothing, everything escrowed returns, and the launch fee is retained — disclosed', () => {
  const r = modelLaunchEscrow(DEFAULT);
  assert.equal(r.refund.escrowFee, 0n);
  assert.equal(r.refund.escrowedReturned, 49000000000n);
  assert.equal(r.refund.refundedTotal, 74000000000n); // 25,000 launch oversubscription + 49,000 escrowed proceeds
  assert.equal(r.refund.launchFeeRetained, 1000000000n); // The raise completed; the escrow refund rule governs the escrow stage only.
  assert.equal(r.refund.refundedTotal + r.refund.launchFeeRetained, r.subscribed);
});

test('partial release: the escrow fee is taken only on the released share of the proceeds, and the identity holds', () => {
  const r = modelLaunchEscrow(DEFAULT);
  assert.equal(r.partial.releasedGross, 24500000000n);
  assert.equal(r.partial.releasedFee, 245000000n);
  assert.equal(r.partial.releasedNet, 24255000000n);
  assert.equal(r.partial.stillHeld, 24500000000n);
  assert.equal(r.partial.totalFees, 1245000000n);
  assert.equal(r.launchFee + r.partial.releasedFee + r.partial.releasedNet + r.partial.stillHeld + r.launchRefunded, r.subscribed);
});

test('partial edges: releasedBps 0 releases nothing and holds everything; 10000 is the full release exactly', () => {
  const zero = modelLaunchEscrow({ ...DEFAULT, releasedBps: 0 });
  assert.equal(zero.partial.releasedGross, 0n);
  assert.equal(zero.partial.releasedFee, 0n);
  assert.equal(zero.partial.stillHeld, zero.proceeds);
  const full = modelLaunchEscrow({ ...DEFAULT, releasedBps: 10000 });
  assert.equal(full.partial.releasedGross, full.proceeds);
  assert.equal(full.partial.releasedFee, full.release.escrowFee);
  assert.equal(full.partial.releasedNet, full.release.issuerFinalNet);
  assert.equal(full.partial.stillHeld, 0n);
});

test('the launch stage refusal is judged on the fill: a launch fixed fee taking the whole fill is refused before escrow', () => {
  assert.throws(() => modelLaunchEscrow({ hardCap: '100', subscribed: '1000', decimals: 6, launchFeeBps: 0, launchFixedFee: '100', launchMaxFee: '', escrowFeeBps: 100, escrowFixedFee: '0', escrowMaxFee: '', releasedBps: 5000 }), /whole transfer/);
});

test('the escrow stage refusal is judged on the proceeds: a fixed escrow fee equal to the proceeds but below the fill is refused', () => {
  // Fill 1,000, launch fee 0 → proceeds 1,000; an escrow fixed fee of
  // 990 passes. Raise the launch fee so proceeds fall to 900 and the
  // same 990 escrow fee would take the whole proceeds — refused on
  // the proceeds, though 990 is below the 1,000 fill.
  const ok = modelLaunchEscrow({ hardCap: '1000', subscribed: '1000', decimals: 6, launchFeeBps: 0, launchFixedFee: '0', launchMaxFee: '', escrowFeeBps: 0, escrowFixedFee: '990', escrowMaxFee: '', releasedBps: 5000 });
  assert.equal(ok.proceeds, 1000000000n);
  assert.throws(() => modelLaunchEscrow({ hardCap: '1000', subscribed: '1000', decimals: 6, launchFeeBps: 1000, launchFixedFee: '0', launchMaxFee: '', escrowFeeBps: 0, escrowFixedFee: '990', escrowMaxFee: '', releasedBps: 5000 }), /whole transfer/);
});

test('caps at both stages bind and are reported, with the escrow cap judged on the proceeds fee', () => {
  const r = modelLaunchEscrow({ ...DEFAULT, launchMaxFee: '500', escrowMaxFee: '100' });
  assert.equal(r.launchFee, 500000000n);
  assert.equal(r.launchCapApplied, true);
  assert.equal(r.proceeds, 49500000000n);
  assert.equal(r.release.escrowFee, 100000000n); // The uncapped proceeds fee would be 495.
  assert.equal(r.release.escrowUncappedFee, 495000000n);
  assert.equal(r.release.escrowCapApplied, true);
  assert.equal(r.release.issuerFinalNet, 49400000000n);
});

test('a partial computed fee at the whole released part is flagged takesAll, capped at the part, with the identity intact', () => {
  const r = modelLaunchEscrow({ hardCap: '1000', subscribed: '1000', decimals: 6, launchFeeBps: 0, launchFixedFee: '0', launchMaxFee: '', escrowFeeBps: 0, escrowFixedFee: '60', escrowMaxFee: '', releasedBps: 2500 });
  assert.equal(r.partial.releasedGross, 250000000n);
  assert.equal(r.partial.computedFee, 60000000n);
  assert.equal(r.partial.takesAll, false); // 60 < 250: the fixed fee fits inside the released part here.
  const tight = modelLaunchEscrow({ hardCap: '100', subscribed: '100', decimals: 6, launchFeeBps: 0, launchFixedFee: '0', launchMaxFee: '', escrowFeeBps: 0, escrowFixedFee: '60', escrowMaxFee: '', releasedBps: 2500 });
  assert.equal(tight.partial.releasedGross, 25000000n);
  assert.equal(tight.partial.computedFee, 60000000n);
  assert.equal(tight.partial.takesAll, true);
  assert.equal(tight.partial.releasedFee, 25000000n); // Capped at the part — the identity wins.
  assert.equal(tight.partial.releasedNet, 0n);
  assert.equal(tight.launchFee + tight.partial.releasedFee + tight.partial.releasedNet + tight.partial.stillHeld + tight.launchRefunded, tight.subscribed);
});

test('release-level rows: release shares of the proceeds at the same two fees, exact', () => {
  const r = modelLaunchEscrow(DEFAULT);
  assert.deepEqual(r.rows.map(row => row.levelBps), [0, 2500, 5000, 7500, 10000]);
  assert.deepEqual(r.rows.map(row => row.releasedGross), [0n, 12250000000n, 24500000000n, 36750000000n, 49000000000n]);
  assert.deepEqual(r.rows.map(row => row.escrowFee), [0n, 122500000n, 245000000n, 367500000n, 490000000n]);
  assert.deepEqual(r.rows.map(row => row.releasedNet), [0n, 12127500000n, 24255000000n, 36382500000n, 48510000000n]);
  assert.deepEqual(r.rows.map(row => row.stillHeld), [49000000000n, 36750000000n, 24500000000n, 12250000000n, 0n]);
  assert.deepEqual(r.rows.map(row => row.totalFees), [1000000000n, 1122500000n, 1245000000n, 1367500000n, 1490000000n]);
  assert.ok(r.rows.every(row => row.takesAll === false));
});

test('a release level whose escrow fee would take its whole released part is flagged in its row, not refused', () => {
  const r = modelLaunchEscrow({ hardCap: '100', subscribed: '100', decimals: 6, launchFeeBps: 0, launchFixedFee: '0', launchMaxFee: '', escrowFeeBps: 0, escrowFixedFee: '60', escrowMaxFee: '', releasedBps: 5000 });
  const low = r.rows.find(row => row.levelBps === 2500);
  assert.equal(low.releasedGross, 25000000n);
  assert.equal(low.computedFee, 60000000n);
  assert.equal(low.takesAll, true);
  assert.equal(low.escrowFee, 25000000n);
  assert.equal(low.releasedNet, 0n);
  assert.equal(r.rows.find(row => row.levelBps === 10000).takesAll, false);
});

test('validation propagates from both stages: launch amounts and escrow release share', () => {
  assert.throws(() => modelLaunchEscrow({ ...DEFAULT, hardCap: '0' }), /Hard cap must be greater than zero/);
  assert.throws(() => modelLaunchEscrow({ ...DEFAULT, subscribed: '0' }), /Subscribed amount must be greater than zero/);
  assert.throws(() => modelLaunchEscrow({ ...DEFAULT, releasedBps: 10001 }), /releasedBps must be a whole number/);
  assert.throws(() => modelLaunchEscrow({ ...DEFAULT, releasedBps: 2.5 }), /releasedBps must be a whole number/);
  assert.throws(() => modelLaunchEscrow({ ...DEFAULT, launchFeeBps: 10001 }), /Fee must be a whole number/);
  assert.throws(() => modelLaunchEscrow({ ...DEFAULT, escrowFeeBps: -1 }), /Fee must be a whole number/);
});

test('stage defaults: omitted stage fees use each stage model’s own defaults', () => {
  const r = modelLaunchEscrow({ hardCap: '50000', subscribed: '75000', decimals: 6 });
  assert.equal(r.launchFeeBps, 100); // The split's own default rate, at both stages.
  assert.equal(r.escrowFeeBps, 100);
  assert.equal(r.launchFee, 500000000n);
  assert.equal(r.proceeds, 49500000000n);
  assert.equal(r.release.escrowFee, 495000000n);
});

test('exactness beyond float range: a 9,007,199,254,740,993-unit cap subscribed twice over, both stages at 100 bps', () => {
  const r = modelLaunchEscrow({ hardCap: '9007199254740993', subscribed: '18014398509481986', decimals: 0, launchFeeBps: 100, launchFixedFee: '0', launchMaxFee: '', escrowFeeBps: 100, escrowFixedFee: '0', escrowMaxFee: '', releasedBps: 10000 });
  assert.equal(r.filled, 9007199254740993n);
  assert.equal(r.launchFee, 90071992547409n);
  assert.equal(r.proceeds, 8917127262193584n);
  assert.equal(r.release.escrowFee, 89171272621935n);
  assert.equal(r.release.issuerFinalNet, 8827955989571649n);
  assert.equal(r.launchFee + r.release.escrowFee + r.release.issuerFinalNet + r.launchRefunded, r.subscribed);
  assert.equal(r.totalFeeRateBpsText, '198.99'); // Not 200.00: the escrow fee prices the smaller proceeds base.
});

test('decimals handling: the chain follows the entered scale, and a bad scale is refused', () => {
  const zero = modelLaunchEscrow({ ...DEFAULT, decimals: 0 });
  assert.equal(zero.filled, 50000n);
  assert.equal(zero.launchFee, 1000n);
  assert.equal(zero.proceeds, 49000n);
  assert.equal(zero.release.escrowFee, 490n);
  assert.equal(zero.release.issuerFinalNet, 48510n);
  assert.throws(() => modelLaunchEscrow({ ...DEFAULT, decimals: 7 }), /Decimals/);
});

test('app wires the launch-escrow model: panel, verdict outcomes, honest boundary, v1.212', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /modelLaunchEscrow/);
  assert.match(app, /Model a launch that escrows its proceeds/);
  assert.match(app, /data-lesc="hardCap"/);
  assert.match(app, /data-lesc="escrowFeeBps"/);
  assert.match(app, /data-lesc="releasedBps"/);
  assert.match(app, /id="launch-escrow-output"/);
  assert.match(app, /PRISM runs no launchpad, holds no escrow, and takes no subscriptions/);
  assert.match(app, /v1\.212/);
});

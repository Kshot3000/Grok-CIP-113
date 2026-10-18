import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelReserveRelease } from '../src/domain.js';

// Reserve release model (v1.249): the reserve axis's
// second moment — the holdback states what is held; when
// the hold ends, stated claims are taken from what was
// held and the remainder is released to the seller. The
// release is held minus claims, measured against THE
// AMOUNT HELD, never against the gross settlement;
// claims + released === held exactly. Claims beyond
// what is held are refused. Claim validity, order, and
// the release schedule are not priced.
const DEFAULT = { amount: '1000', reserveRateBps: 1000, claimsAmount: '25', decimals: 6 };

test('the preloaded release: a 1,000 settlement at 10% holds 100, claims of 25 are taken, and 75 is released', () => {
  const r = modelReserveRelease(DEFAULT);
  assert.equal(r.amount, 1000000000n);
  assert.equal(r.heldAmount, 100000000n);
  assert.equal(r.immediateAmount, 900000000n);
  assert.equal(r.claimsAmount, 25000000n);
  assert.equal(r.releasedAmount, 75000000n);
  assert.equal(r.claimsShareBpsText, '2500.00');
  assert.equal(r.releasedShareBpsText, '7500.00');
  assert.equal(r.releasedShareOfSettlementBpsText, '750.00');
  assert.equal(r.noClaimsTaken, false);
  assert.equal(r.claimsTakeWholeHeld, false);
});

test('identity holds across releases: claims plus released is the held amount, and with what was paid at once is the settlement, exactly', () => {
  const cases = [
    DEFAULT,
    { amount: '777', reserveRateBps: 1000, claimsAmount: '7', decimals: 0 },
    { amount: '100', reserveRateBps: 10000, claimsAmount: '100', decimals: 6 },
    { amount: '100', reserveRateBps: 1000, claimsAmount: '0', decimals: 6 },
    { amount: '9007199254740993', reserveRateBps: 1000, claimsAmount: '450359962737049', decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelReserveRelease(c);
    assert.equal(r.claimsAmount + r.releasedAmount, r.heldAmount);
    assert.equal(r.claimsAmount + r.releasedAmount + r.immediateAmount, r.amount);
    assert.ok(r.releasedAmount <= r.heldAmount);
  }
});

test('measuring the release against the settlement minus claims instead would pay what was paid at once a second time: the base is the amount held', () => {
  const r = modelReserveRelease(DEFAULT);
  const releasedOnSettlement = r.amount - r.claimsAmount;
  assert.equal(releasedOnSettlement, 975000000n);
  assert.equal(r.releasedAmount, 75000000n);
  assert.ok(releasedOnSettlement > r.releasedAmount);
  assert.equal(releasedOnSettlement - r.releasedAmount, r.immediateAmount);
});

test('no claims taken releases the held amount whole', () => {
  const r = modelReserveRelease({ ...DEFAULT, claimsAmount: '0' });
  assert.equal(r.releasedAmount, 100000000n);
  assert.equal(r.releasedAmount, r.heldAmount);
  assert.equal(r.noClaimsTaken, true);
  assert.equal(r.claimsShareBpsText, '0.00');
  assert.equal(r.releasedShareBpsText, '10000.00');
  assert.equal(r.releasedShareOfSettlementBpsText, '1000.00');
});

test('claims equal to the whole held amount release nothing, stated as such', () => {
  const r = modelReserveRelease({ ...DEFAULT, claimsAmount: '100' });
  assert.equal(r.claimsAmount, r.heldAmount);
  assert.equal(r.releasedAmount, 0n);
  assert.equal(r.claimsTakeWholeHeld, true);
  assert.equal(r.claimsShareBpsText, '10000.00');
  assert.equal(r.releasedShareBpsText, '0.00');
});

test('claims beyond what is held are refused: a claim larger than the reserve is not met from this reserve', () => {
  assert.throws(() => modelReserveRelease({ ...DEFAULT, claimsAmount: '101' }), /Claims taken must not exceed the amount held/);
  assert.throws(() => modelReserveRelease({ ...DEFAULT, claimsAmount: '100.000001' }), /Claims taken must not exceed the amount held/);
});

test('with no reserve stated nothing is held and nothing is released, and any claims amount is refused against the empty reserve', () => {
  const r = modelReserveRelease({ ...DEFAULT, reserveRateBps: 0, claimsAmount: '0' });
  assert.equal(r.heldAmount, 0n);
  assert.equal(r.releasedAmount, 0n);
  assert.equal(r.noReserveStated, true);
  assert.equal(r.nothingHeld, true);
  assert.throws(() => modelReserveRelease({ ...DEFAULT, reserveRateBps: 0, claimsAmount: '1' }), /Claims taken must not exceed the amount held/);
});

test('a stated rate flooring to zero holds nothing at this size, so nothing is released', () => {
  const r = modelReserveRelease({ amount: '0.000001', reserveRateBps: 1000, claimsAmount: '0', decimals: 6 });
  assert.equal(r.amount, 1n);
  assert.equal(r.heldAmount, 0n);
  assert.equal(r.releasedAmount, 0n);
  assert.equal(r.reserveFloorsToZero, true);
  assert.equal(r.nothingHeld, true);
});

test('the 777 case at no decimals: 777 at 10% holds 77, claims of 7 leave 70 released', () => {
  const r = modelReserveRelease({ amount: '777', reserveRateBps: 1000, claimsAmount: '7', decimals: 0 });
  assert.equal(r.heldAmount, 77n);
  assert.equal(r.releasedAmount, 70n);
  assert.equal(r.claimsShareBpsText, '909.09');
  assert.equal(r.releasedShareBpsText, '9090.90');
  assert.equal(r.releasedShareOfSettlementBpsText, '900.90');
});

test('amounts beyond float precision stay exact: a 2^53+1 settlement at 10% with claims of 450359962737049 releases 450359962737050', () => {
  const r = modelReserveRelease({ amount: '9007199254740993', reserveRateBps: 1000, claimsAmount: '450359962737049', decimals: 0 });
  assert.equal(r.heldAmount, 900719925474099n);
  assert.equal(r.releasedAmount, 450359962737050n);
});

test('a reserve rate beyond the whole is refused by the composed holdback', () => {
  assert.throws(() => modelReserveRelease({ ...DEFAULT, reserveRateBps: 10001 }), /Reserve rate must be/);
});

test('a zero settlement amount is refused by the composed holdback', () => {
  assert.throws(() => modelReserveRelease({ ...DEFAULT, amount: '0' }), /Amount must be greater than zero/);
});

test('what is not priced is stated: the release is not a fee, and claim eligibility, claim order, and the release schedule are flagged unpriced', () => {
  const r = modelReserveRelease(DEFAULT);
  assert.equal(r.reserveIsFee, false);
  assert.equal(r.claimsEligibilityPriced, false);
  assert.equal(r.claimOrderPriced, false);
  assert.equal(r.releaseSchedulePriced, false);
});

test('wiring: the app imports the model, renders a reserve release panel, and the README names the model', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(app.includes('modelReserveRelease'));
  assert.ok(app.includes('data-resrel'));
  assert.ok(app.includes('resrel-output'));
  assert.match(app, /v1\.249/);
  assert.ok(readme.includes('Reserve release model'));
});

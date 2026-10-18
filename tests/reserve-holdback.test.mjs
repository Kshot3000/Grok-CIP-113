import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelReserveHoldback } from '../src/domain.js';

// Reserve holdback model (v1.255): a NEW axis — a stated
// share of a gross settlement held back as a rolling
// reserve, still the seller's. The held amount is
// floor(settlement x rate / 10,000), measured against the
// gross settlement, never against what remains after the
// holdback itself; held + paid at once === settlement
// exactly. No hold duration, release, or claims are priced.
const DEFAULT = { amount: '1000', reserveRateBps: 1000, decimals: 6 };

test('the preloaded holdback: a 1,000 settlement at a stated 10% reserve holds 100 back and pays 900 at once', () => {
  const r = modelReserveHoldback(DEFAULT);
  assert.equal(r.amount, 1000000000n);
  assert.equal(r.reserveRateBps, 1000);
  assert.equal(r.heldAmount, 100000000n);
  assert.equal(r.immediateAmount, 900000000n);
  assert.equal(r.heldShareBpsText, '1000.00');
  assert.equal(r.immediateShareBpsText, '9000.00');
  assert.equal(r.noReserveStated, false);
  assert.equal(r.reserveTakesWhole, false);
});

test('identity holds across settlements: held plus paid at once is the settlement amount, exactly', () => {
  const cases = [
    DEFAULT,
    { amount: '777', reserveRateBps: 1000, decimals: 0 },
    { amount: '100', reserveRateBps: 10000, decimals: 6 },
    { amount: '100', reserveRateBps: 0, decimals: 6 },
    { amount: '0.000001', reserveRateBps: 1000, decimals: 6 },
    { amount: '9007199254740993', reserveRateBps: 1000, decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelReserveHoldback(c);
    assert.equal(r.heldAmount + r.immediateAmount, r.amount);
    assert.ok(r.heldAmount <= r.amount);
  }
});

test('measuring the reserve against what is paid at once instead would understate it: the base is the gross settlement', () => {
  const r = modelReserveHoldback(DEFAULT);
  const heldOnImmediate = r.immediateAmount * BigInt(r.reserveRateBps) / 10000n;
  assert.equal(heldOnImmediate, 90000000n);
  assert.equal(r.heldAmount, 100000000n);
  assert.ok(r.heldAmount > heldOnImmediate);
});

test('a reserve rate of zero states no holdback: the settlement is paid whole at once', () => {
  const r = modelReserveHoldback({ ...DEFAULT, reserveRateBps: 0 });
  assert.equal(r.heldAmount, 0n);
  assert.equal(r.immediateAmount, r.amount);
  assert.equal(r.noReserveStated, true);
  assert.equal(r.heldShareBpsText, '0.00');
  assert.equal(r.immediateShareBpsText, '10000.00');
});

test('a reserve rate of the whole holds the settlement whole: nothing is paid at once, stated as such', () => {
  const r = modelReserveHoldback({ ...DEFAULT, reserveRateBps: 10000 });
  assert.equal(r.heldAmount, 1000000000n);
  assert.equal(r.immediateAmount, 0n);
  assert.equal(r.reserveTakesWhole, true);
  assert.equal(r.heldShareBpsText, '10000.00');
  assert.equal(r.immediateShareBpsText, '0.00');
});

test('a stated reserve rate flooring to zero on a one-base-unit settlement holds nothing at that size', () => {
  const r = modelReserveHoldback({ amount: '0.000001', reserveRateBps: 1000, decimals: 6 });
  assert.equal(r.amount, 1n);
  assert.equal(r.heldAmount, 0n);
  assert.equal(r.immediateAmount, 1n);
  assert.equal(r.reserveFloorsToZero, true);
  assert.equal(r.noReserveStated, false);
});

test('the 777 case at no decimals: 777 at 10% holds 77 and pays 700 at once', () => {
  const r = modelReserveHoldback({ amount: '777', reserveRateBps: 1000, decimals: 0 });
  assert.equal(r.heldAmount, 77n);
  assert.equal(r.immediateAmount, 700n);
  assert.equal(r.heldShareBpsText, '990.99');
  assert.equal(r.immediateShareBpsText, '9009.00');
});

test('amounts beyond float precision stay exact: a 2^53+1 settlement at 10% holds 900719925474099 and pays 8106479329266894 at once', () => {
  const r = modelReserveHoldback({ amount: '9007199254740993', reserveRateBps: 1000, decimals: 0 });
  assert.equal(r.heldAmount, 900719925474099n);
  assert.equal(r.immediateAmount, 8106479329266894n);
});

test('a reserve rate beyond the whole is refused: holding back more than the settlement is not a holdback on it', () => {
  assert.throws(() => modelReserveHoldback({ ...DEFAULT, reserveRateBps: 10001 }), /Reserve rate must be/);
});

test('a negative reserve rate is refused', () => {
  assert.throws(() => modelReserveHoldback({ ...DEFAULT, reserveRateBps: -1 }), /Reserve rate must be/);
});

test('a fractional reserve rate is refused', () => {
  assert.throws(() => modelReserveHoldback({ ...DEFAULT, reserveRateBps: 2.5 }), /Reserve rate must be/);
});

test('a zero settlement amount is refused', () => {
  assert.throws(() => modelReserveHoldback({ ...DEFAULT, amount: '0' }), /Amount must be greater than zero/);
});

test('what is not priced is stated: the reserve is not a fee, and hold duration and claims are flagged unpriced', () => {
  const r = modelReserveHoldback(DEFAULT);
  assert.equal(r.reserveIsFee, false);
  assert.equal(r.holdDurationPriced, false);
  assert.equal(r.claimsPriced, false);
});

test('wiring: the app imports the model, renders a reserve holdback panel, and the README names the model', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(app.includes('modelReserveHoldback'));
  assert.ok(app.includes('data-reserve'));
  assert.ok(app.includes('reserve-output'));
  assert.match(app, /v1\.255/);
  assert.ok(readme.includes('Reserve holdback model'));
});

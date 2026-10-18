import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDutchAuction } from '../src/domain.js';

// Dutch auction sale model (v1.253): the price descends from a start
// price to a floor price over a stated number of periods — the elapsed
// share of the drop is floored, so the price is never below the exact
// schedule and never below the floor — and the first bid at the
// current price clears the whole lot. The platform fee is floored on
// the proceeds. Whether any bid arrives is not priced.
const DEFAULT = { startPrice: '100', floorPrice: '40', quantity: '1000', decimals: 6, periods: 10, elapsedPeriods: 3, platformFeeBps: 250 };

test('the preloaded auction: after 3 of 10 periods the price has fallen from 100 to 82, and a bid clears 1000 tokens for 82000 of which 2050 is the platform fee', () => {
  const r = modelDutchAuction(DEFAULT);
  assert.equal(r.drop, 60000000n);
  assert.equal(r.priceNow, 82000000n);
  assert.equal(r.proceeds, 82000000000n);
  assert.equal(r.platformFee, 2050000000n);
  assert.equal(r.sellerNet, 79950000000n);
  assert.equal(r.discount, 18000000n);
  assert.equal(r.priceShareBpsText, '8200.00');
  assert.equal(r.discountShareBpsText, '1800.00');
  assert.equal(r.feeShareBpsText, '250.00');
  assert.equal(r.sellerShareBpsText, '9750.00');
  assert.equal(r.atStart, false);
  assert.equal(r.atFloor, false);
});

test('identities hold across prices, quantities, periods, and decimals: fee plus seller net is the proceeds, and the price never leaves the start-to-floor range', () => {
  const cases = [
    { startPrice: '250', floorPrice: '25', quantity: '40', decimals: 6, periods: 7, elapsedPeriods: 5, platformFeeBps: 175 },
    { startPrice: '9', floorPrice: '2', quantity: '12345', decimals: 0, periods: 3, elapsedPeriods: 2, platformFeeBps: 500 },
    { startPrice: '1000', floorPrice: '999', quantity: '2', decimals: 2, periods: 100, elapsedPeriods: 99, platformFeeBps: 1 },
  ];
  for (const c of cases) {
    const r = modelDutchAuction(c);
    assert.equal(r.platformFee + r.sellerNet, r.proceeds);
    assert.ok(r.priceNow >= r.floorPrice && r.priceNow <= r.startPrice);
    assert.equal(r.discount, r.startPrice - r.priceNow);
    assert.equal(r.drop, r.startPrice - r.floorPrice);
  }
});

test('at zero elapsed periods the price is the start price exactly and nothing has been discounted', () => {
  const r = modelDutchAuction({ ...DEFAULT, elapsedPeriods: 0 });
  assert.equal(r.priceNow, 100000000n);
  assert.equal(r.discount, 0n);
  assert.equal(r.proceeds, 100000000000n);
  assert.equal(r.atStart, true);
  assert.equal(r.discountShareBpsText, '0.00');
  assert.equal(r.priceShareBpsText, '10000.00');
});

test('when every period has elapsed the price is the floor exactly — the descent completes on the floor, never below it', () => {
  const r = modelDutchAuction({ ...DEFAULT, elapsedPeriods: 10 });
  assert.equal(r.priceNow, 40000000n);
  assert.equal(r.priceNow, r.floorPrice);
  assert.equal(r.proceeds, 40000000000n);
  assert.equal(r.atFloor, true);
  assert.equal(r.discountShareBpsText, '6000.00');
});

test('a floor equal to the start means the price never descends: elapsed periods change nothing', () => {
  const r = modelDutchAuction({ startPrice: '50', floorPrice: '50', quantity: '10', decimals: 6, periods: 5, elapsedPeriods: 3, platformFeeBps: 0 });
  assert.equal(r.noDescent, true);
  assert.equal(r.drop, 0n);
  assert.equal(r.priceNow, 50000000n);
  assert.equal(r.proceeds, 500000000n);
  assert.equal(r.noFee, true);
});

test('the elapsed drop floors: after 1 of 3 periods of a 100-token drop the price is 67.666667, above the exact schedule, and the discount share is derived from the amounts (3300.33), not the period ratio (3333.33)', () => {
  const r = modelDutchAuction({ startPrice: '101', floorPrice: '1', quantity: '1', decimals: 6, periods: 3, elapsedPeriods: 1, platformFeeBps: 0 });
  assert.equal(r.priceNow, 67666667n);
  assert.equal(r.discount, 33333333n);
  assert.equal(r.priceRoundsUp, true);
  assert.equal(r.discountShareBpsText, '3300.33');
  assert.equal(r.priceShareBpsText, '6699.67');
  const r2 = modelDutchAuction({ startPrice: '101', floorPrice: '1', quantity: '1', decimals: 6, periods: 3, elapsedPeriods: 2, platformFeeBps: 0 });
  assert.equal(r2.priceNow, 34333334n);
  assert.equal(r2.discountShareBpsText, '6600.66');
});

test('amounts beyond float precision stay exact: a start price of 2^53+1 halves to an exact price and an amount-derived discount share of 4999.99', () => {
  const r = modelDutchAuction({ startPrice: '9007199254740993', floorPrice: '1', quantity: '1', decimals: 0, periods: 2, elapsedPeriods: 1, platformFeeBps: 0 });
  assert.equal(r.priceNow, 4503599627370497n);
  assert.equal(r.discount, 4503599627370496n);
  assert.equal(r.proceeds, 4503599627370497n);
  assert.equal(r.discountShareBpsText, '4999.99');
  assert.equal(r.priceShareBpsText, '5000.00');
});

test('the platform fee is floored on the proceeds, its stated base: on the preloaded case it is exactly 250 of the 82000 proceeds', () => {
  const r = modelDutchAuction(DEFAULT);
  assert.equal(r.platformFee, r.proceeds * 250n / 10000n);
  assert.equal(r.feeShareBpsText, '250.00');
});

test('a stated fee that floors to zero on small proceeds is flagged, never presented as a fee that is taken', () => {
  const r = modelDutchAuction({ startPrice: '1', floorPrice: '1', quantity: '3', decimals: 0, periods: 1, elapsedPeriods: 0, platformFeeBps: 1 });
  assert.equal(r.proceeds, 3n);
  assert.equal(r.platformFee, 0n);
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.sellerNet, 3n);
});

test('proceeds that floor to zero on the decimal scale are stated as raising nothing, never as a sale', () => {
  const r = modelDutchAuction({ startPrice: '0.000001', floorPrice: '0.000001', quantity: '0.5', decimals: 6, periods: 1, elapsedPeriods: 0, platformFeeBps: 250 });
  assert.equal(r.proceeds, 0n);
  assert.equal(r.noProceeds, true);
  assert.equal(r.proceedsFloor, true);
  assert.equal(r.platformFee, 0n);
  assert.equal(r.sellerNet, 0n);
});

test('a platform fee taking the whole proceeds is refused', () => {
  assert.throws(() => modelDutchAuction({ ...DEFAULT, platformFeeBps: 10000 }), /must not take the whole proceeds/);
});

test('a floor above the start is refused: an auction descends, never rises', () => {
  assert.throws(() => modelDutchAuction({ ...DEFAULT, floorPrice: '101' }), /must not exceed the start price/);
});

test('elapsed periods beyond the total are refused: the auction has ended at its floor', () => {
  assert.throws(() => modelDutchAuction({ ...DEFAULT, elapsedPeriods: 11 }), /between 0 and the total periods/);
  assert.throws(() => modelDutchAuction({ ...DEFAULT, elapsedPeriods: -1 }), /between 0 and the total periods/);
  assert.throws(() => modelDutchAuction({ ...DEFAULT, elapsedPeriods: 1.5 }), /between 0 and the total periods/);
});

test('the auction terms are validated: positive prices and quantity, whole periods in range, fee in range', () => {
  assert.throws(() => modelDutchAuction({ ...DEFAULT, startPrice: '0' }), /Start price must be greater than zero/);
  assert.throws(() => modelDutchAuction({ ...DEFAULT, floorPrice: '0' }), /Floor price must be greater than zero/);
  assert.throws(() => modelDutchAuction({ ...DEFAULT, quantity: '0' }), /Quantity offered must be greater than zero/);
  assert.throws(() => modelDutchAuction({ ...DEFAULT, periods: 0 }), /between 1 and 1,000/);
  assert.throws(() => modelDutchAuction({ ...DEFAULT, periods: 1001 }), /between 1 and 1,000/);
  assert.throws(() => modelDutchAuction({ ...DEFAULT, platformFeeBps: 10001 }), /between 0 and 10,000/);
  assert.throws(() => modelDutchAuction({ ...DEFAULT, platformFeeBps: -1 }), /between 0 and 10,000/);
});

test('a one-period auction goes from the start straight to the floor: there is no intermediate price', () => {
  const open = modelDutchAuction({ ...DEFAULT, periods: 1, elapsedPeriods: 0 });
  assert.equal(open.priceNow, open.startPrice);
  const ended = modelDutchAuction({ ...DEFAULT, periods: 1, elapsedPeriods: 1 });
  assert.equal(ended.priceNow, ended.floorPrice);
  assert.equal(ended.atFloor, true);
});

test('waiting longer never raises the price and never lowers it below the floor, at every step of the preloaded descent', () => {
  let previous = null;
  for (let e = 0; e <= 10; e++) {
    const r = modelDutchAuction({ ...DEFAULT, elapsedPeriods: e });
    assert.ok(r.priceNow >= r.floorPrice);
    if (previous !== null) assert.ok(r.priceNow <= previous);
    previous = r.priceNow;
  }
  assert.equal(previous, 40000000n);
});

test('an unstated fee defaults to the disclosed 250 bps and an unstated elapsed count defaults to the open', () => {
  const r = modelDutchAuction({ startPrice: '100', floorPrice: '40', quantity: '1000', decimals: 6, periods: 10 });
  assert.equal(r.platformFeeBps, 250);
  assert.equal(r.elapsedPeriods, 0);
  assert.equal(r.atStart, true);
  assert.equal(r.priceNow, r.startPrice);
});

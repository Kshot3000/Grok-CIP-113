import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDutchAuctionUnsold } from '../src/domain.js';

// Dutch auction unsold model (v1.221): the sale model prices a bid
// landing in a stated period; this model prices the auction that
// reaches its floor with NO bid. It is stated as a non-sale: nothing
// sold, the whole lot returned, proceeds zero, and no platform fee
// charged — a fee is charged on the proceeds of a sale. What a bid
// at the floor would have paid is stated separately, never merged
// with what was received. A stated relist cost is the seller's cost
// of the unsold outcome, stated as a signed net position.
const DEFAULT = { startPrice: '100', floorPrice: '40', quantity: '1000', decimals: 6, periods: 10, platformFeeBps: 250, relistCost: '500' };

test('the preloaded unsold auction: the lot of 1000 reached its floor of 40 with no bid, so nothing is sold, the whole lot is returned, proceeds are zero, and no fee is charged', () => {
  const r = modelDutchAuctionUnsold(DEFAULT);
  assert.equal(r.unsold, true);
  assert.equal(r.quantitySold, 0n);
  assert.equal(r.quantityReturned, 1000000000n);
  assert.equal(r.returnsWholeLot, true);
  assert.equal(r.proceeds, 0n);
  assert.equal(r.platformFeeCharged, 0n);
  assert.equal(r.noFeeCharged, true);
  assert.equal(r.sellerReceives, 0n);
  assert.equal(r.unsoldShareBpsText, '10000.00');
});

test('what a bid at the floor would have paid is stated separately: 40000 in proceeds, of which 1000 would have been the fee and 39000 the seller\u2019s', () => {
  const r = modelDutchAuctionUnsold(DEFAULT);
  assert.equal(r.floorProceeds, 40000000000n);
  assert.equal(r.feeNotCharged, 1000000000n);
  assert.equal(r.sellerWouldHaveReceived, 39000000000n);
  assert.equal(r.feeNotCharged + r.sellerWouldHaveReceived, r.floorProceeds);
  assert.equal(r.feeNotChargedShareBpsText, '250.00');
  assert.equal(r.wouldHaveShareBpsText, '9750.00');
});

test('identities hold across terms: sold plus returned is the lot, the not-charged fee plus the would-have receipt is the floor proceeds, and the net position plus the relist cost is what the seller received (zero)', () => {
  const cases = [
    DEFAULT,
    { startPrice: '250', floorPrice: '25', quantity: '40', decimals: 6, periods: 7, platformFeeBps: 175, relistCost: '25' },
    { startPrice: '9', floorPrice: '2', quantity: '12345', decimals: 0, periods: 3, platformFeeBps: 500, relistCost: '0' },
    { startPrice: '1000', floorPrice: '999', quantity: '2', decimals: 2, periods: 100, platformFeeBps: 1, relistCost: '3' },
  ];
  for (const c of cases) {
    const r = modelDutchAuctionUnsold(c);
    assert.equal(r.quantitySold + r.quantityReturned, r.quantity);
    assert.equal(r.feeNotCharged + r.sellerWouldHaveReceived, r.floorProceeds);
    assert.equal(r.sellerNetPosition + r.relistCost, r.sellerReceives);
    assert.equal(r.proceeds, 0n);
    assert.equal(r.platformFeeCharged, 0n);
  }
});

test('the relist cost is the seller\u2019s signed net position: paying 500 to relist a returned lot leaves the seller at -500, having received nothing', () => {
  const r = modelDutchAuctionUnsold(DEFAULT);
  assert.equal(r.relistCost, 500000000n);
  assert.equal(r.sellerNetPosition, -500000000n);
  assert.equal(r.relistCostShareBpsText, '125.00');
  assert.equal(r.relistCostZero, false);
});

test('with no relist cost the unsold outcome costs the seller nothing beyond receiving nothing: the net position is zero', () => {
  const r = modelDutchAuctionUnsold({ ...DEFAULT, relistCost: '0' });
  assert.equal(r.relistCost, 0n);
  assert.equal(r.sellerNetPosition, 0n);
  assert.equal(r.relistCostZero, true);
  assert.equal(r.relistCostShareBpsText, '0.00');
});

test('an unstated relist cost defaults to zero', () => {
  const { relistCost, ...rest } = DEFAULT;
  const r = modelDutchAuctionUnsold(rest);
  assert.equal(r.relistCost, 0n);
  assert.equal(r.relistCostZero, true);
});

test('a relist cost larger than the floor proceeds is flagged: relisting would cost more than a clearing bid at the floor would have raised in total', () => {
  const r = modelDutchAuctionUnsold({ ...DEFAULT, relistCost: '50000' });
  assert.equal(r.relistCostExceedsFloorProceeds, true);
  assert.equal(r.relistCostEqualsFloorProceeds, false);
  assert.equal(r.sellerNetPosition, -50000000000n);
});

test('a relist cost exactly equal to the floor proceeds is flagged as equal, not as exceeding', () => {
  const r = modelDutchAuctionUnsold({ ...DEFAULT, relistCost: '40000' });
  assert.equal(r.relistCostEqualsFloorProceeds, true);
  assert.equal(r.relistCostExceedsFloorProceeds, false);
  assert.equal(r.relistCostShareBpsText, '10000.00');
});

test('shares are derived from the amounts: on the 777-to-111 case the discount share is 8571.42 and the relist cost share is 1287.00 against the 777 the floor would have raised', () => {
  const r = modelDutchAuctionUnsold({ startPrice: '777', floorPrice: '111', quantity: '7', decimals: 6, periods: 3, platformFeeBps: 333, relistCost: '100' });
  assert.equal(r.floorProceeds, 777000000n);
  assert.equal(r.feeNotCharged, 25874100n);
  assert.equal(r.sellerWouldHaveReceived, 751125900n);
  assert.equal(r.discountShareBpsText, '8571.42');
  assert.equal(r.feeNotChargedShareBpsText, '333.00');
  assert.equal(r.wouldHaveShareBpsText, '9667.00');
  assert.equal(r.relistCostShareBpsText, '1287.00');
});

test('the full descent is realized in an unsold auction: the price fell the whole drop from start to floor, a 6000.00 share on the preloaded terms', () => {
  const r = modelDutchAuctionUnsold(DEFAULT);
  assert.equal(r.drop, 60000000n);
  assert.equal(r.discountShareBpsText, '6000.00');
});

test('a floor equal to the start is still unsold when no bid arrives: no descent happened and the lot is returned whole', () => {
  const r = modelDutchAuctionUnsold({ startPrice: '50', floorPrice: '50', quantity: '10', decimals: 6, periods: 5, platformFeeBps: 0, relistCost: '0' });
  assert.equal(r.noDescent, true);
  assert.equal(r.floorProceeds, 500000000n);
  assert.equal(r.feeNotCharged, 0n);
  assert.equal(r.quantityReturned, r.quantity);
});

test('floor proceeds that would have floored to zero are flagged: even a bid at the floor would have raised nothing', () => {
  const r = modelDutchAuctionUnsold({ startPrice: '0.000001', floorPrice: '0.000001', quantity: '0.5', decimals: 6, periods: 1, platformFeeBps: 250, relistCost: '0' });
  assert.equal(r.floorProceeds, 0n);
  assert.equal(r.floorProceedsZero, true);
  assert.equal(r.feeNotCharged, 0n);
  assert.equal(r.feeNotChargedShareBpsText, '0.00');
});

test('a platform fee taking the whole floor proceeds is refused, exactly as in the sale model: such a sale could never have paid the seller', () => {
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, platformFeeBps: 10000 }), /must not take the whole proceeds/);
});

test('the auction terms are validated through the sale model: a floor above the start, non-positive prices or quantity, and out-of-range periods or fee are refused', () => {
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, floorPrice: '101' }), /must not exceed the start price/);
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, startPrice: '0' }), /Start price must be greater than zero/);
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, quantity: '0' }), /Quantity offered must be greater than zero/);
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, periods: 0 }), /between 1 and 1,000/);
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, platformFeeBps: 10001 }), /between 0 and 10,000/);
});

test('the relist cost is validated as an amount in the same units: commas, exponents, and too many decimal places are refused', () => {
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, relistCost: '1,000' }), /without commas or exponents/);
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, relistCost: '1e3' }), /without commas or exponents/);
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, relistCost: '-5' }), /without commas or exponents/);
  assert.throws(() => modelDutchAuctionUnsold({ ...DEFAULT, relistCost: '0.0000001' }), /at most 6 decimal places/);
});

test('amounts beyond float precision stay exact: a 2^53+1 start price with a floor of 1 leaves floor proceeds of exactly 7 for a lot of 7', () => {
  const r = modelDutchAuctionUnsold({ startPrice: '9007199254740993', floorPrice: '1', quantity: '7', decimals: 0, periods: 2, platformFeeBps: 0, relistCost: '0' });
  assert.equal(r.floorProceeds, 7n);
  assert.equal(r.sellerWouldHaveReceived, 7n);
  assert.equal(r.quantityReturned, 7n);
});

test('a one-period auction that draws no bid is unsold at its floor after its single period', () => {
  const r = modelDutchAuctionUnsold({ ...DEFAULT, periods: 1 });
  assert.equal(r.floorProceeds, 40000000000n);
  assert.equal(r.unsold, true);
  assert.equal(r.periods, 1);
});

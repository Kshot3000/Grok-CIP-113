import test from 'node:test';
import assert from 'node:assert/strict';
import { modelDvpSettlement } from '../src/domain.js';

const DEFAULT = { cashAmount: '25000', assetQuantity: '500', buyerCashAvailable: '30000', sellerAssetAvailable: '500', decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, sellerAssetAvailable: '400' },
  { ...DEFAULT, buyerCashAvailable: '20000' },
  { ...DEFAULT, buyerCashAvailable: '20000', sellerAssetAvailable: '400' },
  { ...DEFAULT, buyerCashAvailable: '25000' },
  { ...DEFAULT, buyerCashAvailable: '0', sellerAssetAvailable: '0' },
  { ...DEFAULT, sellerAssetAvailable: '501' },
  { cashAmount: '100.5', assetQuantity: '2.25', buyerCashAvailable: '100.5', sellerAssetAvailable: '2.25', decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { cashAmount: '1', assetQuantity: '1', buyerCashAvailable: '1000000', sellerAssetAvailable: '1000000', decimals: 6 },
];

test('preload: both legs covered settles both legs in full — 25000 cash moves, 500 asset moves, the buyer keeps 5000 and the seller is left at zero on exact cover', () => {
  const r = modelDvpSettlement(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.cashAmount, 25000000000n);
  assert.equal(r.assetQuantity, 500000000n);
  assert.equal(r.buyerCashAvailable, 30000000000n);
  assert.equal(r.sellerAssetAvailable, 500000000n);
  assert.equal(r.cashShortfallAmount, 0n);
  assert.equal(r.assetShortfallAmount, 0n);
  assert.equal(r.settled, true);
  assert.equal(r.blockedBy, 'none');
  assert.equal(r.cashMovedAmount, 25000000000n);
  assert.equal(r.assetMovedAmount, 500000000n);
  assert.equal(r.buyerCashAfterAmount, 5000000000n);
  assert.equal(r.sellerAssetAfterAmount, 0n);
  assert.equal(r.exactAssetCover, true);
});

test('the settlement is atomic: where the asset leg falls short the cash leg does not move either, even though the buyer could pay it in full', () => {
  const r = modelDvpSettlement({ ...DEFAULT, sellerAssetAvailable: '400' });
  assert.equal(r.settled, false);
  assert.equal(r.blockedBy, 'asset');
  assert.equal(r.assetShortfallAmount, 100000000n);
  assert.equal(r.cashLegCovered, true);
  assert.equal(r.cashMovedAmount, 0n);
  assert.notEqual(r.cashMovedAmount, r.cashAmount);
  assert.equal(r.assetMovedAmount, 0n);
  assert.equal(r.buyerCashAfterAmount, r.buyerCashAvailable);
  assert.equal(r.sellerAssetAfterAmount, r.sellerAssetAvailable);
});

test('the settlement is atomic the other way: where the cash leg falls short the asset leg does not move either, even though the seller could deliver it in full', () => {
  const r = modelDvpSettlement({ ...DEFAULT, buyerCashAvailable: '20000' });
  assert.equal(r.settled, false);
  assert.equal(r.blockedBy, 'cash');
  assert.equal(r.cashShortfallAmount, 5000000000n);
  assert.equal(r.assetLegCovered, true);
  assert.equal(r.assetMovedAmount, 0n);
  assert.notEqual(r.assetMovedAmount, r.assetQuantity);
  assert.equal(r.cashMovedAmount, 0n);
});

test('where both legs fall short the settlement is blocked by both and nothing moves', () => {
  const r = modelDvpSettlement({ ...DEFAULT, buyerCashAvailable: '20000', sellerAssetAvailable: '400' });
  assert.equal(r.settled, false);
  assert.equal(r.blockedBy, 'both');
  assert.equal(r.cashMovedAmount, 0n);
  assert.equal(r.assetMovedAmount, 0n);
});

test('there is no partial settlement: a leg is never settled in part against a short other leg, on any stated case', () => {
  for (const input of CASES) {
    const r = modelDvpSettlement(input);
    assert.equal(r.partialSettlementPriced, false);
    if (r.settled) {
      assert.equal(r.cashMovedAmount, r.cashAmount);
      assert.equal(r.assetMovedAmount, r.assetQuantity);
    } else {
      assert.equal(r.cashMovedAmount, 0n);
      assert.equal(r.assetMovedAmount, 0n);
    }
  }
});

test('each side is conserved exactly on every stated case: availability equals what that side keeps plus what it moved', () => {
  for (const input of CASES) {
    const r = modelDvpSettlement(input);
    assert.equal(r.buyerCashAfterAmount + r.cashMovedAmount, r.buyerCashAvailable);
    assert.equal(r.sellerAssetAfterAmount + r.assetMovedAmount, r.sellerAssetAvailable);
    assert.equal(r.sidesConserved, true);
    assert.equal(r.atomicSettlement, true);
  }
});

test('exact cover settles: availability exactly equal to a leg is cover, and leaves that side at zero', () => {
  const r = modelDvpSettlement({ ...DEFAULT, buyerCashAvailable: '25000' });
  assert.equal(r.settled, true);
  assert.equal(r.buyerCashAfterAmount, 0n);
  const r2 = modelDvpSettlement({ cashAmount: '100.5', assetQuantity: '2.25', buyerCashAvailable: '100.5', sellerAssetAvailable: '2.25', decimals: 6 });
  assert.equal(r2.settled, true);
  assert.equal(r2.buyerCashAfterAmount, 0n);
  assert.equal(r2.sellerAssetAfterAmount, 0n);
});

test('an availability of zero is stated, not refused: it cannot cover a positive leg and its shortfall is the whole leg', () => {
  const r = modelDvpSettlement({ ...DEFAULT, buyerCashAvailable: '0', sellerAssetAvailable: '0' });
  assert.equal(r.settled, false);
  assert.equal(r.blockedBy, 'both');
  assert.equal(r.cashShortfallAmount, r.cashAmount);
  assert.equal(r.assetShortfallAmount, r.assetQuantity);
});

test('one base unit short blocks the whole settlement: a shortfall of exactly one base unit moves nothing', () => {
  const r = modelDvpSettlement({ cashAmount: '25000', assetQuantity: '500', buyerCashAvailable: '30000', sellerAssetAvailable: '499.999999', decimals: 6 });
  assert.equal(r.assetShortfallAmount, 1n);
  assert.equal(r.settled, false);
  assert.equal(r.cashMovedAmount, 0n);
  assert.equal(r.assetMovedAmount, 0n);
});

test('the legs are stated gross and never netted: extra availability on one side does not reduce the other leg', () => {
  const r = modelDvpSettlement({ ...DEFAULT, sellerAssetAvailable: '501' });
  assert.equal(r.legsStatedGross, true);
  assert.equal(r.settled, true);
  assert.equal(r.cashMovedAmount, r.cashAmount);
  assert.equal(r.assetMovedAmount, r.assetQuantity);
  assert.equal(r.sellerAssetAfterAmount, 1000000n);
});

test('neither leg is a fee, and no price per unit is stated or derived', () => {
  const r = modelDvpSettlement(DEFAULT);
  assert.equal(r.cashIsFee, false);
  assert.equal(r.assetIsFee, false);
  assert.equal(r.agreedPricePriced, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('no third party holds either leg: escrow, credit, enforceability, and the settlement window are not priced', () => {
  const r = modelDvpSettlement(DEFAULT);
  assert.equal(r.escrowPriced, false);
  assert.equal(r.creditPriced, false);
  assert.equal(r.enforceabilityPriced, false);
  assert.equal(r.settlementWindowPriced, false);
});

test('a cash amount of zero is refused', () => {
  assert.throws(() => modelDvpSettlement({ ...DEFAULT, cashAmount: '0' }), /Cash amount must be greater than zero/);
});

test('an asset quantity of zero is refused', () => {
  assert.throws(() => modelDvpSettlement({ ...DEFAULT, assetQuantity: '0' }), /Asset quantity must be greater than zero/);
});

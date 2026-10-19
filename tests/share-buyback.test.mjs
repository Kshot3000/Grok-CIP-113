import test from 'node:test';
import assert from 'node:assert/strict';
import { modelShareBuyback } from '../src/domain.js';

const DEFAULT = { sharesOutstanding: 1000000, buybackCash: '250000', pricePerShare: '5', holderShares: 95000, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, buybackCash: '250003' },
  { ...DEFAULT, buybackCash: '0' },
  { sharesOutstanding: 1000, buybackCash: '3', pricePerShare: '5', holderShares: 100, decimals: 6 },
  { sharesOutstanding: 100000, buybackCash: '250000', pricePerShare: '5', holderShares: 50000, decimals: 6 },
  { sharesOutstanding: 10, buybackCash: '0.000007', pricePerShare: '0.000002', holderShares: 3, decimals: 6 },
  { sharesOutstanding: 2000000, buybackCash: '123456.789', pricePerShare: '12.34', holderShares: 123456, decimals: 6 },
  { sharesOutstanding: 3, buybackCash: '5', pricePerShare: '5', holderShares: 1, decimals: 6 },
  { sharesOutstanding: 1000000, buybackCash: '250000', pricePerShare: '5', holderShares: 0, decimals: 0 },
  { sharesOutstanding: 777, buybackCash: '999', pricePerShare: '7', holderShares: 77, decimals: 6 },
];

test('preload: cash of 250000 at a price of 5 retires 50000 of 1000000 shares, spends 250000000000, and leaves 950000 shares', () => {
  const r = modelShareBuyback(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.sharesOutstanding, 1000000);
  assert.equal(r.buybackCash, 250000000000n);
  assert.equal(r.pricePerShare, 5000000n);
  assert.equal(r.holderShares, 95000);
  assert.equal(r.sharesRetired, 50000n);
  assert.equal(r.cashSpent, 250000000000n);
  assert.equal(r.unspentCash, 0n);
  assert.equal(r.sharesAfter, 950000n);
});

test('the holder shares never change: 95000 shares held 950 bps before and hold 1000 bps after, an uplift of 50', () => {
  const r = modelShareBuyback(DEFAULT);
  assert.equal(r.holderSharesUnchanged, true);
  assert.equal(r.ownershipMeasuredOnSharesRemaining, true);
  assert.equal(r.holderOwnershipBeforeBps, 950n);
  assert.equal(r.holderOwnershipAfterBps, 1000n);
  assert.equal(r.ownershipUpliftBps, 50n);
});

test('only whole shares are retired: cash of 250003 at a price of 5 retires the same 50000 shares and leaves 3000000 unspent', () => {
  const r = modelShareBuyback({ ...DEFAULT, buybackCash: '250003' });
  assert.equal(r.wholeSharesOnly, true);
  assert.equal(r.sharesRetired, 50000n);
  assert.equal(r.cashSpent, 250000000000n);
  assert.equal(r.unspentCash, 3000000n);
  assert.ok(r.unspentCash < r.pricePerShare);
});

test('cash and shares are conserved exactly, and both ownership figures are floors, on every stated case', () => {
  for (const input of CASES) {
    const r = modelShareBuyback(input);
    assert.equal(r.cashSpent + r.unspentCash, r.buybackCash);
    assert.equal(r.cashSpent, r.sharesRetired * r.pricePerShare);
    assert.ok(r.unspentCash >= 0n && r.unspentCash < r.pricePerShare);
    assert.equal(r.sharesAfter + r.sharesRetired, BigInt(r.sharesOutstanding));
    assert.ok(r.holderOwnershipAfterBps >= r.holderOwnershipBeforeBps);
    assert.equal(r.ownershipUpliftBps, r.holderOwnershipAfterBps - r.holderOwnershipBeforeBps);
    assert.ok(BigInt(r.sharesOutstanding) * r.holderOwnershipBeforeBps <= BigInt(r.holderShares) * 10000n);
    assert.ok(BigInt(r.holderShares) * 10000n < BigInt(r.sharesOutstanding) * (r.holderOwnershipBeforeBps + 1n) || r.holderShares === 0);
    assert.ok(r.sharesAfter * r.holderOwnershipAfterBps <= BigInt(r.holderShares) * 10000n);
    assert.ok(BigInt(r.holderShares) * 10000n < r.sharesAfter * (r.holderOwnershipAfterBps + 1n) || r.holderShares === 0);
  }
});

test('cash below the price of one share retires nothing and spends nothing: cash of 3 at a price of 5 leaves all 3 unspent', () => {
  const r = modelShareBuyback({ sharesOutstanding: 1000, buybackCash: '3', pricePerShare: '5', holderShares: 100, decimals: 6 });
  assert.equal(r.sharesRetired, 0n);
  assert.equal(r.cashSpent, 0n);
  assert.equal(r.unspentCash, 3000000n);
  assert.equal(r.sharesAfter, 1000n);
  assert.equal(r.holderOwnershipBeforeBps, 1000n);
  assert.equal(r.holderOwnershipAfterBps, 1000n);
  assert.equal(r.ownershipUpliftBps, 0n);
});

test('buyback cash of zero is stated, not refused: nothing is retired and no ownership moves', () => {
  const r = modelShareBuyback({ ...DEFAULT, buybackCash: '0' });
  assert.equal(r.sharesRetired, 0n);
  assert.equal(r.cashSpent, 0n);
  assert.equal(r.unspentCash, 0n);
  assert.equal(r.holderOwnershipBeforeBps, 950n);
  assert.equal(r.holderOwnershipAfterBps, 950n);
});

test('a holder of no shares holds nothing before or after, however much is retired', () => {
  const r = modelShareBuyback({ sharesOutstanding: 1000000, buybackCash: '250000', pricePerShare: '5', holderShares: 0, decimals: 0 });
  assert.equal(r.sharesRetired, 50000n);
  assert.equal(r.holderOwnershipBeforeBps, 0n);
  assert.equal(r.holderOwnershipAfterBps, 0n);
  assert.equal(r.ownershipUpliftBps, 0n);
});

test('a holder of every remaining share holds the whole count after: 50000 of 100000 with 50000 retired states 10000 bps', () => {
  const r = modelShareBuyback({ sharesOutstanding: 100000, buybackCash: '250000', pricePerShare: '5', holderShares: 50000, decimals: 6 });
  assert.equal(r.sharesAfter, 50000n);
  assert.equal(r.holderOwnershipBeforeBps, 5000n);
  assert.equal(r.holderOwnershipAfterBps, 10000n);
  assert.equal(r.ownershipUpliftBps, 5000n);
});

test('the buyback is not a fee and creates no value here, and fractional shares, market price, remaining assets, earnings, and taxes are not priced', () => {
  const r = modelShareBuyback(DEFAULT);
  assert.equal(r.buybackIsFee, false);
  assert.equal(r.buybackCreatesValue, false);
  assert.equal(r.fractionalSharesPriced, false);
  assert.equal(r.marketPricePriced, false);
  assert.equal(r.remainingAssetsPriced, false);
  assert.equal(r.earningsPriced, false);
  assert.equal(r.taxesPriced, false);
  assert.equal(r.ownershipRoundedDown, true);
});

test('tiny amounts are exact: cash of 0.000007 at a price of 0.000002 retires 3 shares, spends 6, and leaves 1 unspent', () => {
  const r = modelShareBuyback({ sharesOutstanding: 10, buybackCash: '0.000007', pricePerShare: '0.000002', holderShares: 3, decimals: 6 });
  assert.equal(r.sharesRetired, 3n);
  assert.equal(r.cashSpent, 6n);
  assert.equal(r.unspentCash, 1n);
  assert.equal(r.sharesAfter, 7n);
  assert.equal(r.holderOwnershipBeforeBps, 3000n);
  assert.equal(r.holderOwnershipAfterBps, 4285n);
  assert.equal(r.ownershipUpliftBps, 1285n);
});

test('fractional amounts are exact: cash of 123456.789 at 12.34 retires 10004 shares and restates 123456 shares from 617 to 620 bps', () => {
  const r = modelShareBuyback({ sharesOutstanding: 2000000, buybackCash: '123456.789', pricePerShare: '12.34', holderShares: 123456, decimals: 6 });
  assert.equal(r.sharesRetired, 10004n);
  assert.equal(r.cashSpent, 123449360000n);
  assert.equal(r.unspentCash, 7429000n);
  assert.equal(r.sharesAfter, 1989996n);
  assert.equal(r.holderOwnershipBeforeBps, 617n);
  assert.equal(r.holderOwnershipAfterBps, 620n);
  assert.equal(r.ownershipUpliftBps, 3n);
});

test('a small stated case floors the before figure: 1 of 3 shares states 3333 bps before and 5000 bps after 1 is retired', () => {
  const r = modelShareBuyback({ sharesOutstanding: 3, buybackCash: '5', pricePerShare: '5', holderShares: 1, decimals: 6 });
  assert.equal(r.sharesRetired, 1n);
  assert.equal(r.holderOwnershipBeforeBps, 3333n);
  assert.equal(r.holderOwnershipAfterBps, 5000n);
  assert.equal(r.ownershipUpliftBps, 1667n);
});

test('a price per share of zero is refused', () => {
  assert.throws(() => modelShareBuyback({ ...DEFAULT, pricePerShare: '0' }), /Price per share must be greater than zero/);
});

test('cash that would retire every share outstanding is refused, and a holder above the shares remaining is refused', () => {
  assert.throws(() => modelShareBuyback({ sharesOutstanding: 100, buybackCash: '500', pricePerShare: '5', holderShares: 0, decimals: 6 }), /retire every share outstanding/);
  assert.throws(() => modelShareBuyback({ sharesOutstanding: 100, buybackCash: '505', pricePerShare: '5', holderShares: 0, decimals: 6 }), /retire every share outstanding/);
  assert.throws(() => modelShareBuyback({ sharesOutstanding: 100, buybackCash: '100', pricePerShare: '5', holderShares: 90, decimals: 6 }), /exceed the shares remaining after the buyback/);
});

test('fractional, zero, negative, or over-cap share counts are refused', () => {
  assert.throws(() => modelShareBuyback({ ...DEFAULT, sharesOutstanding: 2.5 }), /Shares outstanding must be a whole number/);
  assert.throws(() => modelShareBuyback({ ...DEFAULT, sharesOutstanding: 0 }), /Shares outstanding must be a whole number/);
  assert.throws(() => modelShareBuyback({ ...DEFAULT, sharesOutstanding: 1000000000001 }), /Shares outstanding must be a whole number/);
  assert.throws(() => modelShareBuyback({ ...DEFAULT, holderShares: -1 }), /Holder shares must be a whole number/);
  assert.throws(() => modelShareBuyback({ ...DEFAULT, holderShares: 1000001 }), /Holder shares must be a whole number/);
  assert.throws(() => modelShareBuyback({ ...DEFAULT, holderShares: 1.5 }), /Holder shares must be a whole number/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelBondSecondarySale } from '../src/domain.js';

// Tokenised bond secondary-sale model (v1.190): a sale before
// maturity settles in two parts, never merged — a clean price for
// the bond itself, and the accrued coupon (the elapsed share of
// the current period's coupon) paid by the buyer to the seller on
// top of it. The buyer receives the current period's coupon whole,
// which is exactly what the accrued payment compensates for. Both
// parties' returns are stated signed; a sale at or after maturity
// is refused.
const DEFAULT = { amount: '100000', decimals: 6, couponBps: 250, periods: 20, price: '98000', periodsElapsed: 7, accruedBps: 5000, salePrice: '101000' };

test('the preloaded sale: 7 periods paid, half the current period elapsed, clean price 101000', () => {
  const r = modelBondSecondarySale(DEFAULT);
  assert.equal(r.face, 100000000000n);
  assert.equal(r.couponPerPeriod, 2500000000n);
  assert.equal(r.priorCoupons, 17500000000n);
  assert.equal(r.accruedCoupon, 1250000000n);
  assert.equal(r.cleanPrice, 101000000000n);
  assert.equal(r.dirtyPrice, 102250000000n);
  assert.equal(r.dirtyPrice, r.cleanPrice + r.accruedCoupon);
  assert.equal(r.remainingPeriods, 13);
  assert.equal(r.remainingCoupons, 32500000000n);
  assert.equal(r.priorCoupons + r.remainingCoupons, r.totalCoupons);
  assert.equal(r.sellerTotal, 119750000000n);
  assert.equal(r.sellerTotal, r.priorCoupons + r.dirtyPrice);
  assert.equal(r.sellerReturn, 21750000000n);
  assert.equal(r.buyerFuture, 132500000000n);
  assert.equal(r.buyerFuture, r.remainingCoupons + r.face);
  assert.equal(r.buyerReturn, 30250000000n);
  assert.equal(r.accruedShareBpsText, '5000.00');
  assert.equal(r.cleanPriceShareBpsText, '10100.00');
  assert.equal(r.sellerReturnRateBpsText, '2219.38');
  assert.equal(r.buyerReturnRateBpsText, '2958.43');
  assert.equal(r.cleanAtPremium, true);
  assert.equal(r.sellerPositiveReturn, true);
  assert.equal(r.buyerPositiveReturn, true);
});

test('identities hold across faces, rates, terms, and sale terms', () => {
  const cases = [
    { amount: '5000', decimals: 6, couponBps: 400, periods: 10, price: '5000', periodsElapsed: 0, accruedBps: 0, salePrice: '5100' },
    { amount: '250000', decimals: 2, couponBps: 125, periods: 40, price: '260000', periodsElapsed: 39, accruedBps: 9999, salePrice: '240000' },
    { amount: '777', decimals: 0, couponBps: 9999, periods: 3, price: '700', periodsElapsed: 2, accruedBps: 10000, salePrice: '777' },
    { amount: '1000000', decimals: 6, couponBps: 0, periods: 120, price: '1000000', periodsElapsed: 119, accruedBps: 5000, salePrice: '900000' },
  ];
  for (const c of cases) {
    const r = modelBondSecondarySale(c);
    assert.equal(r.dirtyPrice, r.cleanPrice + r.accruedCoupon);
    assert.equal(r.priorCoupons + r.remainingCoupons, r.totalCoupons);
    assert.equal(r.sellerTotal, r.priorCoupons + r.dirtyPrice);
    assert.equal(r.sellerReturn, r.sellerTotal - r.purchasePrice);
    assert.equal(r.buyerFuture, r.remainingCoupons + r.face);
    assert.equal(r.buyerReturn, r.buyerFuture - r.dirtyPrice);
    assert.equal(r.remainingPeriods, r.periods - r.periodsElapsed);
  }
});

test('an unstated sale price is par and an unstated elapsed state is a coupon-date sale at issue', () => {
  const r = modelBondSecondarySale({ amount: '100000', decimals: 6, couponBps: 250, periods: 20, price: '98000' });
  assert.equal(r.cleanPrice, r.face);
  assert.equal(r.cleanAtPar, true);
  assert.equal(r.periodsElapsed, 0);
  assert.equal(r.atCouponDate, true);
  assert.equal(r.accruedCoupon, 0n);
  assert.equal(r.dirtyPrice, r.cleanPrice);
});

test('a sale on a coupon date accrues nothing: the dirty price is the clean price', () => {
  const r = modelBondSecondarySale({ ...DEFAULT, periodsElapsed: 0, accruedBps: 0, salePrice: '98000' });
  assert.equal(r.atCouponDate, true);
  assert.equal(r.noAccrued, true);
  assert.equal(r.accruedCoupon, 0n);
  assert.equal(r.dirtyPrice, 98000000000n);
  assert.equal(r.sellerReturn, 0n);
  assert.equal(r.sellerZeroReturn, true);
  // The buyer steps into the seller's exact position: same whole-term return as buying at issue for 98000.
  assert.equal(r.buyerReturn, 52000000000n);
  assert.equal(r.buyerReturnRateBpsText, '5306.12');
});

test('the accrued coupon never enters the clean price: two sales at the same clean price on different days differ only by the accrued', () => {
  const early = modelBondSecondarySale({ ...DEFAULT, accruedBps: 2500 });
  const late = modelBondSecondarySale({ ...DEFAULT, accruedBps: 7500 });
  assert.equal(early.cleanPrice, late.cleanPrice);
  assert.equal(early.accruedCoupon, 625000000n);
  assert.equal(late.accruedCoupon, 1875000000n);
  assert.equal(late.dirtyPrice - early.dirtyPrice, 1250000000n);
  assert.equal(late.buyerFuture, early.buyerFuture);
});

test('a whole period elapsed accrues the whole coupon', () => {
  const r = modelBondSecondarySale({ ...DEFAULT, accruedBps: 10000, salePrice: '100000' });
  assert.equal(r.accruedFullPeriod, true);
  assert.equal(r.accruedCoupon, r.couponPerPeriod);
  assert.equal(r.accruedShareBpsText, '10000.00');
  assert.equal(r.dirtyPrice, 102500000000n);
});

test('in the last period the buyer pays almost a whole coupon of accrued for one coupon and the face', () => {
  const r = modelBondSecondarySale({ ...DEFAULT, periodsElapsed: 19, accruedBps: 9999, salePrice: '100000' });
  assert.equal(r.remainingPeriods, 1);
  assert.equal(r.accruedCoupon, 2499750000n);
  assert.equal(r.dirtyPrice, 102499750000n);
  assert.equal(r.buyerFuture, 102500000000n);
  assert.equal(r.buyerReturn, 250000n);
  assert.equal(r.accruedShareBpsText, '9999.00');
});

test('a buyer who pays a dirty price above everything left to receive loses — stated signed, never refused', () => {
  const r = modelBondSecondarySale({ amount: '10000', decimals: 6, couponBps: 100, periods: 4, price: '10000', periodsElapsed: 3, accruedBps: 5000, salePrice: '10200' });
  assert.equal(r.accruedCoupon, 50000000n);
  assert.equal(r.dirtyPrice, 10250000000n);
  assert.equal(r.buyerFuture, 10100000000n);
  assert.equal(r.buyerReturn, -150000000n);
  assert.equal(r.buyerNegativeReturn, true);
  assert.equal(r.buyerReturnRateBpsText, '-146.34');
  // The same sale can still leave the seller ahead: the two returns answer different questions.
  assert.equal(r.sellerReturn, 550000000n);
  assert.equal(r.sellerPositiveReturn, true);
});

test('a seller who paid a large premium can sell and still lose — stated signed', () => {
  const r = modelBondSecondarySale({ ...DEFAULT, price: '130000' });
  assert.equal(r.sellerTotal, 119750000000n);
  assert.equal(r.sellerReturn, -10250000000n);
  assert.equal(r.sellerNegativeReturn, true);
  assert.equal(r.sellerReturnRateBpsText, '-788.46');
});

test('a zero-coupon bond accrues nothing ever: its dirty price is its clean price at any elapsed share', () => {
  const r = modelBondSecondarySale({ amount: '10000', decimals: 6, couponBps: 0, periods: 12, price: '9000', periodsElapsed: 5, accruedBps: 5000, salePrice: '9500' });
  assert.equal(r.zeroCoupon, true);
  assert.equal(r.noAccrued, true);
  assert.equal(r.accruedCoupon, 0n);
  assert.equal(r.dirtyPrice, r.cleanPrice);
  assert.equal(r.sellerReturn, 500000000n);
  assert.equal(r.buyerReturn, 500000000n);
});

test('an accrued share that floors to zero is stated, never presented as compensation that exists', () => {
  const r = modelBondSecondarySale({ amount: '1000', decimals: 0, couponBps: 100, periods: 12, price: '1000', periodsElapsed: 0, accruedBps: 1, salePrice: '1000' });
  assert.equal(r.couponPerPeriod, 10n);
  assert.equal(r.accruedCoupon, 0n);
  assert.equal(r.accruedFloorsToZero, true);
  assert.equal(r.zeroCoupon, false);
  assert.equal(r.dirtyPrice, r.cleanPrice);
  assert.equal(r.buyerReturn, 120n);
});

test('the accrued coupon floors: a third of a 24-unit coupon at 3333 bps accrues 7, not 7.9992', () => {
  const r = modelBondSecondarySale({ amount: '999', decimals: 0, couponBps: 250, periods: 20, price: '999', periodsElapsed: 0, accruedBps: 3333, salePrice: '999' });
  assert.equal(r.couponPerPeriod, 24n);
  assert.equal(r.accruedCoupon, 7n);
  assert.equal(r.accruedShareBpsText, '2916.66');
});

test('beyond float: shares are derived from the floored amounts, not the entered shares', () => {
  const r = modelBondSecondarySale({ amount: '1234567890123', decimals: 6, couponBps: 333, periods: 7, price: '1200000000000', periodsElapsed: 2, accruedBps: 3333, salePrice: '1300000000000' });
  assert.equal(r.accruedCoupon, 13702333210007263n);
  assert.equal(r.dirtyPrice, 1313702333210007263n);
  assert.equal(r.accruedShareBpsText, '3332.99');
  assert.equal(r.sellerReturnRateBpsText, '1632.70');
  assert.equal(r.buyerReturnRateBpsText, '962.32');
});

test('a sale at or after maturity is refused: the bond has been redeemed and nothing is left to sell', () => {
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, periodsElapsed: 20 }), /nothing left to sell/);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, periodsElapsed: 21 }), /nothing left to sell/);
});

test('validation: elapsed periods, accrued share, and sale price are each refused out of range', () => {
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, periodsElapsed: -1 }), /Periods already paid before the sale must be a whole number/);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, periodsElapsed: 2.5 }), /Periods already paid before the sale must be a whole number/);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, accruedBps: 10001 }), /Accrued share of the current period must be a whole number of basis points between 0 and 10,000\./);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, accruedBps: -1 }), /Accrued share of the current period/);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, accruedBps: 2.5 }), /Accrued share of the current period/);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, salePrice: '0' }), /Bond sale price must be greater than zero\./);
});

test('validation: the composed coupon model refusals propagate unchanged', () => {
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, amount: '0' }), /Bond face value must be greater than zero\./);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, couponBps: 10001 }), /Coupon rate must be a whole number of basis points between 0 and 10,000\./);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, periods: 121 }), /Periods to maturity must be a whole number between 1 and 120\./);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, price: '0' }), /Bond price must be greater than zero\./);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, salePrice: '1,000' }), /positive decimal amount/);
  assert.throws(() => modelBondSecondarySale({ ...DEFAULT, decimals: 9 }), /Decimals must be between 0 and 6\./);
});

test('wiring: app.js imports the model, renders a bond-sale panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelBondSecondarySale/);
  assert.match(app, /data-bsale/);
  assert.match(app, /bsale-output/);
  assert.match(app, /v1\.190/);
  assert.match(readme, /Bond secondary-sale model/);
});

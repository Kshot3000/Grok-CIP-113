import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelBondCoupon } from '../src/domain.js';

// Tokenised bond coupon model (v1.268): a bond owes two kinds of
// payment — a coupon each period on the FACE (the face never
// amortises and the price never enters the coupon's base) and the
// face whole at maturity. The price is stated separately from the
// face: their signed difference is the discount or premium, and
// the holder's whole-term return (totalPaid − price) is signed —
// a premium larger than the total coupons returns less than was
// paid, stated, never refused.
const DEFAULT = { amount: '100000', decimals: 6, couponBps: 250, periods: 20, price: '98000' };

test('the preloaded bond: 2.5% of the 100000 face each period for 20 periods, bought at 98000', () => {
  const r = modelBondCoupon(DEFAULT);
  assert.equal(r.face, 100000000000n);
  assert.equal(r.couponPerPeriod, 2500000000n);
  assert.equal(r.schedule.length, 20);
  assert.ok(r.schedule.every(c => c === 2500000000n));
  assert.equal(r.schedule.reduce((a, b) => a + b, 0n), r.totalCoupons);
  assert.equal(r.totalCoupons, 50000000000n);
  assert.equal(r.redemption, 100000000000n);
  assert.equal(r.maturityPayment, 102500000000n);
  assert.equal(r.totalPaid, 150000000000n);
  assert.equal(r.totalPaid, r.totalCoupons + r.redemption);
  assert.equal(r.discount, 2000000000n);
  assert.equal(r.discountAmount, 2000000000n);
  assert.equal(r.premiumAmount, 0n);
  assert.equal(r.investorReturn, 52000000000n);
  assert.equal(r.investorReturn, r.totalPaid - r.price);
  assert.equal(r.couponShareBpsText, '3333.33');
  assert.equal(r.priceShareBpsText, '9800.00');
  assert.equal(r.totalReturnRateBpsText, '5306.12');
  assert.equal(r.atDiscount, true);
  assert.equal(r.atPar, false);
  assert.equal(r.atPremium, false);
  assert.equal(r.positiveReturn, true);
});

test('identities hold across faces, rates, terms, and prices', () => {
  const cases = [
    { amount: '5000', decimals: 6, couponBps: 400, periods: 10, price: '5000' },
    { amount: '250000', decimals: 2, couponBps: 125, periods: 40, price: '260000' },
    { amount: '777', decimals: 0, couponBps: 9999, periods: 3, price: '700' },
    { amount: '1000000', decimals: 6, couponBps: 0, periods: 120, price: '1000000' },
  ];
  for (const c of cases) {
    const r = modelBondCoupon(c);
    assert.equal(r.totalPaid, r.totalCoupons + r.redemption);
    assert.equal(r.investorReturn, r.totalPaid - r.price);
    assert.equal(r.maturityPayment, r.face + r.couponPerPeriod);
    assert.equal(r.schedule.reduce((a, b) => a + b, 0n), r.totalCoupons);
    assert.equal(r.discount, r.face - r.price);
    assert.equal(r.discountAmount - r.premiumAmount, r.discount);
  }
});

test('an unstated price is par: the holder pays the face and the return is the coupons alone', () => {
  const r = modelBondCoupon({ amount: '100000', decimals: 6, couponBps: 250, periods: 20 });
  assert.equal(r.price, r.face);
  assert.equal(r.atPar, true);
  assert.equal(r.discount, 0n);
  assert.equal(r.investorReturn, r.totalCoupons);
  assert.equal(r.priceShareBpsText, '10000.00');
  assert.equal(r.totalReturnRateBpsText, '5000.00');
});

test('the coupon base is the face, never the price: discount and premium buyers earn the same coupon', () => {
  const disc = modelBondCoupon({ ...DEFAULT, price: '90000' });
  const prem = modelBondCoupon({ ...DEFAULT, price: '110000' });
  assert.equal(disc.couponPerPeriod, prem.couponPerPeriod);
  assert.equal(disc.totalCoupons, prem.totalCoupons);
  assert.equal(disc.totalPaid, prem.totalPaid);
  // Only the return moves with the price.
  assert.equal(disc.investorReturn - prem.investorReturn, 20000000000n);
});

test('a premium larger than the total coupons returns less than was paid — stated signed, never refused', () => {
  const r = modelBondCoupon({ amount: '10000', decimals: 6, couponBps: 100, periods: 4, price: '10500' });
  assert.equal(r.totalCoupons, 400000000n);
  assert.equal(r.totalPaid, 10400000000n);
  assert.equal(r.discount, -500000000n);
  assert.equal(r.premiumAmount, 500000000n);
  assert.equal(r.discountAmount, 0n);
  assert.equal(r.investorReturn, -100000000n);
  assert.equal(r.negativeReturn, true);
  assert.equal(r.positiveReturn, false);
  assert.equal(r.totalReturnRateBpsText, '-95.23');
  assert.equal(r.couponShareBpsText, '384.61');
  assert.equal(r.priceShareBpsText, '10500.00');
});

test('a premium the coupons more than repay still returns positively', () => {
  const r = modelBondCoupon({ ...DEFAULT, price: '101000' });
  assert.equal(r.atPremium, true);
  assert.equal(r.premiumAmount, 1000000000n);
  assert.equal(r.investorReturn, 49000000000n);
  assert.equal(r.positiveReturn, true);
});

test('zero coupon at a discount: the whole return is the discount, nothing is paid until maturity', () => {
  const r = modelBondCoupon({ amount: '10000', decimals: 6, couponBps: 0, periods: 12, price: '9000' });
  assert.equal(r.zeroCoupon, true);
  assert.equal(r.noCoupons, true);
  assert.equal(r.couponPerPeriod, 0n);
  assert.equal(r.totalPaid, r.face);
  assert.equal(r.maturityPayment, r.face);
  assert.equal(r.investorReturn, 1000000000n);
  assert.equal(r.investorReturn, r.discountAmount);
  assert.equal(r.couponShareBpsText, '0.00');
  assert.equal(r.totalReturnRateBpsText, '1111.11');
});

test('zero coupon at a premium returns less than was paid', () => {
  const r = modelBondCoupon({ amount: '10000', decimals: 6, couponBps: 0, periods: 12, price: '10100' });
  assert.equal(r.zeroCoupon, true);
  assert.equal(r.investorReturn, -100000000n);
  assert.equal(r.negativeReturn, true);
  assert.equal(r.totalReturnRateBpsText, '-99.00');
});

test('a coupon that floors to zero on a small face is stated, never presented as a coupon that exists', () => {
  const r = modelBondCoupon({ amount: '10', decimals: 0, couponBps: 1, periods: 12, price: '10' });
  assert.equal(r.couponPerPeriod, 0n);
  assert.equal(r.couponFloorsToZero, true);
  assert.equal(r.zeroCoupon, false);
  assert.equal(r.noCoupons, true);
  assert.equal(r.zeroReturn, true);
  assert.equal(r.maturityPayment, 10n);
});

test('the per-period coupon floors: 333 bps on a 100 face at 0 decimals pays 3, not 3.33', () => {
  const r = modelBondCoupon({ amount: '100', decimals: 0, couponBps: 333, periods: 3, price: '100' });
  assert.equal(r.couponPerPeriod, 3n);
  assert.equal(r.totalCoupons, 9n);
  assert.equal(r.maturityPayment, 103n);
  assert.equal(r.couponShareBpsText, '825.68');
});

test('beyond float: shares are derived from the floored amounts, not the entered rate', () => {
  const r = modelBondCoupon({ amount: '1234567890123', decimals: 6, couponBps: 333, periods: 7, price: '1200000000000' });
  assert.equal(r.couponPerPeriod, 41111110741095900n);
  assert.equal(r.totalCoupons, 287777775187671300n);
  assert.equal(r.couponShareBpsText, '1890.35');
  assert.equal(r.priceShareBpsText, '9720.00');
  assert.equal(r.totalReturnRateBpsText, '2686.21');
});

test('a 10000 bps coupon pays the whole face every period', () => {
  const r = modelBondCoupon({ amount: '1000', decimals: 6, couponBps: 10000, periods: 2, price: '1000' });
  assert.equal(r.couponPerPeriod, r.face);
  assert.equal(r.totalCoupons, 2000000000n);
  assert.equal(r.couponShareBpsText, '6666.66');
});

test('a single-period bond pays everything at maturity', () => {
  const r = modelBondCoupon({ ...DEFAULT, periods: 1 });
  assert.equal(r.totalPaid, r.maturityPayment);
  assert.equal(r.schedule.length, 1);
});

test('term rows price the same face, coupon, and price at other maturities', () => {
  const r = modelBondCoupon(DEFAULT);
  assert.deepEqual(r.rows.map(row => row.periods), [1, 6, 12, 24, 36]);
  assert.equal(r.rows[0].totalCoupons, 2500000000n);
  assert.equal(r.rows[0].investorReturn, 4500000000n);
  assert.equal(r.rows[3].totalCoupons, 60000000000n);
  assert.equal(r.rows[4].totalPaid, 190000000000n);
  for (const row of r.rows) assert.equal(row.investorReturn, row.totalPaid - r.price);
});

test('validation: face, coupon rate, periods, and price are each refused out of range', () => {
  assert.throws(() => modelBondCoupon({ ...DEFAULT, amount: '0' }), /Bond face value must be greater than zero\./);
  assert.throws(() => modelBondCoupon({ ...DEFAULT, couponBps: 10001 }), /Coupon rate must be a whole number of basis points between 0 and 10,000\./);
  assert.throws(() => modelBondCoupon({ ...DEFAULT, couponBps: -1 }), /Coupon rate must be a whole number of basis points/);
  assert.throws(() => modelBondCoupon({ ...DEFAULT, couponBps: 2.5 }), /Coupon rate must be a whole number of basis points/);
  assert.throws(() => modelBondCoupon({ ...DEFAULT, periods: 0 }), /Periods to maturity must be a whole number between 1 and 120\./);
  assert.throws(() => modelBondCoupon({ ...DEFAULT, periods: 121 }), /Periods to maturity must be a whole number between 1 and 120\./);
  assert.throws(() => modelBondCoupon({ ...DEFAULT, periods: 2.5 }), /Periods to maturity must be a whole number between 1 and 120\./);
  assert.throws(() => modelBondCoupon({ ...DEFAULT, price: '0' }), /Bond price must be greater than zero\./);
});

test('validation: bad amounts and decimals propagate from the amount parser', () => {
  assert.throws(() => modelBondCoupon({ ...DEFAULT, amount: '-5' }), /positive decimal amount/);
  assert.throws(() => modelBondCoupon({ amount: '1.5', decimals: 0 }), /Use at most 0 decimal places\./);
  assert.throws(() => modelBondCoupon({ ...DEFAULT, decimals: 9 }), /Decimals must be between 0 and 6\./);
  assert.throws(() => modelBondCoupon({ ...DEFAULT, price: '1,000' }), /positive decimal amount/);
});

test('wiring: app.js imports the model, renders a bond panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelBondCoupon/);
  assert.match(app, /data-bond/);
  assert.match(app, /bond-output/);
  assert.match(app, /v1\.268/);
  assert.match(readme, /Bond coupon model/);
});

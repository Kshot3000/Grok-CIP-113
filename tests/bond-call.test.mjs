import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelBondCall } from '../src/domain.js';

// Tokenised bond early-redemption (call) model (v1.237): an
// issuer ends a bond early on a coupon date by paying the call
// price; the remaining periods never run, so their coupons are
// never paid. Both accounts are stated signed — the holder's
// against what they paid and against holding to maturity, and
// the issuer's saving (foregone coupons minus the premium),
// which can be negative when a premium exceeds the coupons it
// saves. A call at or after maturity is refused.
const DEFAULT = { amount: '100000', decimals: 6, couponBps: 250, periods: 20, price: '98000', periodsElapsed: 7, callPrice: '102000' };

test('the preloaded call: 7 periods paid, call price 102000 at a premium over the 100000 face', () => {
  const r = modelBondCall(DEFAULT);
  assert.equal(r.face, 100000000000n);
  assert.equal(r.couponPerPeriod, 2500000000n);
  assert.equal(r.priorCoupons, 17500000000n);
  assert.equal(r.remainingPeriods, 13);
  assert.equal(r.foregoneCoupons, 32500000000n);
  assert.equal(r.priorCoupons + r.foregoneCoupons, r.totalCoupons);
  assert.equal(r.callPremium, 2000000000n);
  assert.equal(r.premiumAmount, 2000000000n);
  assert.equal(r.holderTotal, 119500000000n);
  assert.equal(r.holderTotal, r.priorCoupons + r.callPrice);
  assert.equal(r.holderReturn, 21500000000n);
  assert.equal(r.issuerTotalIfCalled, r.holderTotal);
  assert.equal(r.issuerTotalToMaturity, 150000000000n);
  assert.equal(r.issuerSaving, 30500000000n);
  assert.equal(r.issuerSaving, r.foregoneCoupons - r.callPremium);
  assert.equal(r.holderVsMaturity, -30500000000n);
  assert.equal(r.holderVsMaturity, -r.issuerSaving);
  assert.equal(r.callPriceShareBpsText, '10200.00');
  assert.equal(r.foregoneShareBpsText, '6500.00');
  assert.equal(r.holderReturnRateBpsText, '2193.87');
  assert.equal(r.issuerSavingShareBpsText, '2033.33');
  assert.equal(r.callAtPremium, true);
  assert.equal(r.holderPositiveReturn, true);
  assert.equal(r.issuerSaves, true);
});

test('identities hold across faces, rates, terms, and call terms', () => {
  const cases = [
    { amount: '5000', decimals: 6, couponBps: 400, periods: 10, price: '5000', periodsElapsed: 0, callPrice: '5100' },
    { amount: '250000', decimals: 2, couponBps: 125, periods: 40, price: '260000', periodsElapsed: 39, callPrice: '240000' },
    { amount: '777', decimals: 0, couponBps: 9999, periods: 3, price: '700', periodsElapsed: 2, callPrice: '777' },
    { amount: '1000000', decimals: 6, couponBps: 0, periods: 120, price: '1000000', periodsElapsed: 119, callPrice: '900000' },
  ];
  for (const c of cases) {
    const r = modelBondCall(c);
    assert.equal(r.priorCoupons + r.foregoneCoupons, r.totalCoupons);
    assert.equal(r.holderTotal, r.priorCoupons + r.callPrice);
    assert.equal(r.holderReturn, r.holderTotal - r.purchasePrice);
    assert.equal(r.issuerSaving, r.issuerTotalToMaturity - r.issuerTotalIfCalled);
    assert.equal(r.issuerSaving, r.foregoneCoupons - r.callPremium);
    assert.equal(r.holderVsMaturity, -r.issuerSaving);
    assert.equal(r.remainingPeriods, r.periods - r.periodsElapsed);
  }
});

test('an unstated call price is par and an unstated elapsed state is a call at issue', () => {
  const r = modelBondCall({ amount: '100000', decimals: 6, couponBps: 250, periods: 20, price: '98000' });
  assert.equal(r.callPrice, r.face);
  assert.equal(r.callAtPar, true);
  assert.equal(r.periodsElapsed, 0);
  assert.equal(r.calledAtIssue, true);
  assert.equal(r.priorCoupons, 0n);
  assert.equal(r.foregoneCoupons, r.totalCoupons);
  assert.equal(r.holderReturn, 2000000000n);
  assert.equal(r.foregoneShareBpsText, '10000.00');
});

test('a call at par compensates nothing: the holder keeps only the coupons already paid over their purchase price', () => {
  const r = modelBondCall({ ...DEFAULT, periodsElapsed: 19, callPrice: '100000' });
  assert.equal(r.callAtPar, true);
  assert.equal(r.callInFinalPeriod, true);
  assert.equal(r.foregoneCoupons, 2500000000n);
  assert.equal(r.holderTotal, 147500000000n);
  assert.equal(r.holderReturn, 49500000000n);
  assert.equal(r.issuerSaving, 2500000000n);
  assert.equal(r.foregoneShareBpsText, '500.00');
});

test('a premium larger than the foregone coupons makes the call cost the issuer more than maturity — stated signed', () => {
  const r = modelBondCall({ amount: '10000', decimals: 6, couponBps: 100, periods: 4, price: '10000', periodsElapsed: 3, callPrice: '10300' });
  assert.equal(r.foregoneCoupons, 100000000n);
  assert.equal(r.callPremium, 300000000n);
  assert.equal(r.issuerSaving, -200000000n);
  assert.equal(r.issuerCallCostsMore, true);
  assert.equal(r.issuerSavingShareBpsText, '-192.30');
  // The holder's side is the mirror: they receive MORE than holding to maturity would have paid.
  assert.equal(r.holderVsMaturity, 200000000n);
  assert.equal(r.holderReturn, 600000000n);
});

test('a premium exactly equal to the foregone coupons leaves the issuer neither saving nor losing', () => {
  const r = modelBondCall({ amount: '10000', decimals: 6, couponBps: 100, periods: 4, price: '10000', periodsElapsed: 3, callPrice: '10100' });
  assert.equal(r.issuerSaving, 0n);
  assert.equal(r.issuerSavingZero, true);
  assert.equal(r.holderVsMaturity, 0n);
  assert.equal(r.holderTotal, r.issuerTotalToMaturity);
});

test('a call at a discount can leave the holder with less than they paid — stated signed, never refused', () => {
  const r = modelBondCall({ amount: '10000', decimals: 6, couponBps: 100, periods: 4, price: '10000', periodsElapsed: 3, callPrice: '9000' });
  assert.equal(r.callAtDiscount, true);
  assert.equal(r.discountAmount, 1000000000n);
  assert.equal(r.holderTotal, 9300000000n);
  assert.equal(r.holderReturn, -700000000n);
  assert.equal(r.holderNegativeReturn, true);
  assert.equal(r.holderReturnRateBpsText, '-700.00');
  assert.equal(r.issuerSaving, 1100000000n);
});

test('the call premium never enters the coupons: two calls at the same point with different call prices forego the same coupons', () => {
  const par = modelBondCall({ ...DEFAULT, callPrice: '100000' });
  const premium = modelBondCall({ ...DEFAULT, callPrice: '110000' });
  assert.equal(par.foregoneCoupons, premium.foregoneCoupons);
  assert.equal(par.priorCoupons, premium.priorCoupons);
  assert.equal(premium.holderTotal - par.holderTotal, 10000000000n);
  assert.equal(par.issuerSaving - premium.issuerSaving, 10000000000n);
});

test('a zero-coupon bond foregoes no coupons: its call is a pure face-versus-call-price question', () => {
  const r = modelBondCall({ amount: '10000', decimals: 6, couponBps: 0, periods: 12, price: '9000', periodsElapsed: 5, callPrice: '9500' });
  assert.equal(r.zeroCoupon, true);
  assert.equal(r.noForegoneCoupons, true);
  assert.equal(r.foregoneCoupons, 0n);
  assert.equal(r.foregoneShareBpsText, '0.00');
  assert.equal(r.holderReturn, 500000000n);
  assert.equal(r.issuerSaving, 500000000n);
  assert.equal(r.issuerSaving, -r.callPremium);
});

test('calling later foregoes fewer coupons: the foregone total falls period by period', () => {
  const early = modelBondCall({ ...DEFAULT, periodsElapsed: 2 });
  const late = modelBondCall({ ...DEFAULT, periodsElapsed: 12 });
  assert.equal(early.foregoneCoupons, 45000000000n);
  assert.equal(late.foregoneCoupons, 20000000000n);
  assert.equal(early.foregoneCoupons - late.foregoneCoupons, 25000000000n);
  assert.equal(late.priorCoupons - early.priorCoupons, 25000000000n);
});

test('beyond float: shares are derived from the floored amounts, not the entered rates', () => {
  const r = modelBondCall({ amount: '1234567890123', decimals: 6, couponBps: 333, periods: 7, price: '1200000000000', periodsElapsed: 2, callPrice: '1300000000000' });
  assert.equal(r.couponPerPeriod, 41111110741095900n);
  assert.equal(r.foregoneCoupons, 205555553705479500n);
  assert.equal(r.holderTotal, 1382222221482191800n);
  assert.equal(r.issuerSaving, 140123443828479500n);
  assert.equal(r.callPriceShareBpsText, '10530.00');
  assert.equal(r.foregoneShareBpsText, '7142.85');
  assert.equal(r.holderReturnRateBpsText, '1518.51');
  assert.equal(r.issuerSavingShareBpsText, '920.44');
});

test('a holder who paid par and is called at par at issue gets exactly their money back', () => {
  const r = modelBondCall({ amount: '999', decimals: 0, couponBps: 250, periods: 20, price: '999', periodsElapsed: 0, callPrice: '999' });
  assert.equal(r.couponPerPeriod, 24n);
  assert.equal(r.holderReturn, 0n);
  assert.equal(r.holderZeroReturn, true);
  assert.equal(r.issuerSaving, 480n);
});

test('a call at or after maturity is refused: that payment is the redemption itself, not a call', () => {
  assert.throws(() => modelBondCall({ ...DEFAULT, periodsElapsed: 20 }), /not a call, it is the redemption itself/);
  assert.throws(() => modelBondCall({ ...DEFAULT, periodsElapsed: 21 }), /not a call, it is the redemption itself/);
});

test('validation: elapsed periods and call price are each refused out of range', () => {
  assert.throws(() => modelBondCall({ ...DEFAULT, periodsElapsed: -1 }), /Periods already paid before the call must be a whole number/);
  assert.throws(() => modelBondCall({ ...DEFAULT, periodsElapsed: 2.5 }), /Periods already paid before the call must be a whole number/);
  assert.throws(() => modelBondCall({ ...DEFAULT, callPrice: '0' }), /Bond call price must be greater than zero\./);
});

test('validation: the composed coupon model refusals propagate unchanged', () => {
  assert.throws(() => modelBondCall({ ...DEFAULT, amount: '0' }), /Bond face value must be greater than zero\./);
  assert.throws(() => modelBondCall({ ...DEFAULT, couponBps: 10001 }), /Coupon rate must be a whole number of basis points between 0 and 10,000\./);
  assert.throws(() => modelBondCall({ ...DEFAULT, periods: 121 }), /Periods to maturity must be a whole number between 1 and 120\./);
  assert.throws(() => modelBondCall({ ...DEFAULT, price: '0' }), /Bond price must be greater than zero\./);
  assert.throws(() => modelBondCall({ ...DEFAULT, callPrice: '1,000' }), /positive decimal amount/);
  assert.throws(() => modelBondCall({ ...DEFAULT, decimals: 9 }), /Decimals must be between 0 and 6\./);
});

test('wiring: app.js imports the model, renders a bond-call panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelBondCall/);
  assert.match(app, /data-bcall/);
  assert.match(app, /bcall-output/);
  assert.match(app, /v1\.237/);
  assert.match(readme, /Bond early-redemption \(call\) model/);
});

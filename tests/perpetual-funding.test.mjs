import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPerpetualFundingSettlement } from '../src/domain.js';

const DEFAULT = { positionNotional: '1000000', fundingRateBps: 25, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, fundingRateBps: -25 },
  { ...DEFAULT, fundingRateBps: 0 },
  { ...DEFAULT, fundingRateBps: 10000 },
  { ...DEFAULT, fundingRateBps: -10000 },
  { positionNotional: '333333.333333', fundingRateBps: -111, decimals: 6 },
  { positionNotional: '1', fundingRateBps: 1, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { positionNotional: '2', fundingRateBps: 10000, decimals: 6 },
  { positionNotional: '0.001', fundingRateBps: 1, decimals: 6 },
];

test('preload: a position notional of 1000000 at a funding rate of 25 basis points states a funding payment of 2500 paid by the long side to the short side', () => {
  const r = modelPerpetualFundingSettlement(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.positionNotional, 1000000000000n);
  assert.equal(r.fundingRateBps, 25);
  assert.equal(r.fundingPayment, 2500000000n);
  assert.equal(r.direction, 'longs-pay');
  assert.equal(r.longPays, 2500000000n);
  assert.equal(r.shortPays, 0n);
  assert.equal(r.longReceives, 0n);
  assert.equal(r.shortReceives, 2500000000n);
});

test('the sign of the stated rate alone sets the payer: a negative rate flips the payment to the short side at the same magnitude', () => {
  const r = modelPerpetualFundingSettlement({ ...DEFAULT, fundingRateBps: -25 });
  assert.equal(r.directionFromSign, true);
  assert.equal(r.direction, 'shorts-pay');
  assert.equal(r.fundingPayment, 2500000000n);
  assert.equal(r.shortPays, 2500000000n);
  assert.equal(r.longPays, 0n);
  assert.equal(r.longReceives, 2500000000n);
  assert.equal(r.shortReceives, 0n);
});

test('funding is zero-sum on every stated case: what one side pays the other receives exactly, and the signed nets sum to zero', () => {
  for (const input of CASES) {
    const r = modelPerpetualFundingSettlement(input);
    assert.equal(r.zeroSum, true);
    assert.equal(r.longReceives, r.shortPays);
    assert.equal(r.shortReceives, r.longPays);
    assert.equal((r.longReceives - r.longPays) + (r.shortReceives - r.shortPays), 0n);
  }
});

test('at most one side pays on every stated case: the payment is single and directional, never two gross legs that both move', () => {
  for (const input of CASES) {
    const r = modelPerpetualFundingSettlement(input);
    assert.equal(r.oneSidePays, true);
    assert.ok(r.longPays === 0n || r.shortPays === 0n);
    assert.equal(r.longPays + r.shortPays, r.fundingPayment);
  }
});

test('the payment is measured on the whole position notional actually stated, never on a part of it', () => {
  const r = modelPerpetualFundingSettlement(DEFAULT);
  assert.equal(r.fundingPayment, r.positionNotional * 25n / 10000n);
  assert.notEqual(r.fundingPayment, 0n);
});

test('the notional is not exchanged: it is the base the payment is measured on and the position stays open', () => {
  const r = modelPerpetualFundingSettlement(DEFAULT);
  assert.equal(r.notionalNotExchanged, true);
  assert.notEqual(r.fundingPayment, r.positionNotional);
});

test('the payment is not a fee, and the rate derivation from prices, the period length, later periods, price movement, and margin are not priced', () => {
  const r = modelPerpetualFundingSettlement(DEFAULT);
  assert.equal(r.paymentIsFee, false);
  assert.equal(r.rateFromPricesPriced, false);
  assert.equal(r.periodLengthPriced, false);
  assert.equal(r.laterPeriodsPriced, false);
  assert.equal(r.priceMovementPriced, false);
  assert.equal(r.marginPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a funding rate of zero is stated, not refused: no side pays and no payment moves', () => {
  const r = modelPerpetualFundingSettlement({ ...DEFAULT, fundingRateBps: 0 });
  assert.equal(r.direction, 'none');
  assert.equal(r.fundingPayment, 0n);
  assert.equal(r.longPays, 0n);
  assert.equal(r.shortPays, 0n);
});

test('funding rates of 10000 and -10000 basis points are each stated, in opposite directions', () => {
  const pos = modelPerpetualFundingSettlement({ ...DEFAULT, fundingRateBps: 10000 });
  assert.equal(pos.direction, 'longs-pay');
  assert.equal(pos.fundingPayment, 1000000000000n);
  const neg = modelPerpetualFundingSettlement({ ...DEFAULT, fundingRateBps: -10000 });
  assert.equal(neg.direction, 'shorts-pay');
  assert.equal(neg.fundingPayment, 1000000000000n);
});

test('flooring is exact on a fractional notional: the payment floors and the zero-sum identity stays exact', () => {
  const r = modelPerpetualFundingSettlement({ positionNotional: '333333.333333', fundingRateBps: -111, decimals: 6 });
  assert.equal(r.fundingPayment, 3699999999n);
  assert.equal(r.shortPays, 3699999999n);
  assert.equal(r.longReceives, 3699999999n);
});

test('on a tiny notional a stated rate can floor the payment to zero, and that is stated, not hidden: the direction still stands', () => {
  const r = modelPerpetualFundingSettlement({ positionNotional: '0.001', fundingRateBps: 1, decimals: 6 });
  assert.equal(r.fundingPayment, 0n);
  assert.equal(r.direction, 'longs-pay');
  assert.equal(r.longPays, 0n);
});

test('on a notional of 1 at 1 basis point the payment is exactly 100 base units', () => {
  const r = modelPerpetualFundingSettlement({ positionNotional: '1', fundingRateBps: 1, decimals: 6 });
  assert.equal(r.fundingPayment, 100n);
});

test('a position notional of zero is refused', () => {
  assert.throws(() => modelPerpetualFundingSettlement({ ...DEFAULT, positionNotional: '0' }), /Position notional must be greater than zero/);
});

test('a funding rate above 10000 or below -10000 basis points is refused', () => {
  assert.throws(() => modelPerpetualFundingSettlement({ ...DEFAULT, fundingRateBps: 10001 }), /Funding rate must be a whole number of basis points/);
  assert.throws(() => modelPerpetualFundingSettlement({ ...DEFAULT, fundingRateBps: -10001 }), /Funding rate must be a whole number of basis points/);
});

test('a funding rate that is not a whole number is refused', () => {
  assert.throws(() => modelPerpetualFundingSettlement({ ...DEFAULT, fundingRateBps: 12.5 }), /Funding rate must be a whole number of basis points/);
  assert.throws(() => modelPerpetualFundingSettlement({ ...DEFAULT, fundingRateBps: -0.5 }), /Funding rate must be a whole number of basis points/);
});

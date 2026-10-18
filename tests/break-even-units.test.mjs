import test from 'node:test';
import assert from 'node:assert/strict';
import { modelBreakEvenUnits } from '../src/domain.js';

const DEFAULT = { fixedCosts: '1000000', pricePerUnit: '500', variableCostPerUnit: '300', statedUnits: 6000, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, variableCostPerUnit: '200' },
  { ...DEFAULT, statedUnits: 4000 },
  { ...DEFAULT, variableCostPerUnit: '500' },
  { ...DEFAULT, variableCostPerUnit: '600' },
  { ...DEFAULT, fixedCosts: '0' },
  { fixedCosts: '0.001', pricePerUnit: '0.0005', variableCostPerUnit: '0.0003', statedUnits: 10, decimals: 6 },
  { fixedCosts: '1000000', pricePerUnit: '500', variableCostPerUnit: '300', statedUnits: 5000, decimals: 0 },
  { fixedCosts: '123456.789', pricePerUnit: '12.34', variableCostPerUnit: '5.67', statedUnits: 20000, decimals: 6 },
  { fixedCosts: '7', pricePerUnit: '3', variableCostPerUnit: '1', statedUnits: 3, decimals: 6 },
];

test('preload: fixed costs of 1000000 at a price of 500 and a variable cost of 300 break even at 5000 units with revenue of 2500000000000', () => {
  const r = modelBreakEvenUnits(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.fixedCosts, 1000000000000n);
  assert.equal(r.pricePerUnit, 500000000n);
  assert.equal(r.variableCostPerUnit, 300000000n);
  assert.equal(r.statedUnits, 6000);
  assert.equal(r.contributionPerUnit, 200000000n);
  assert.equal(r.breakEvenUnits, 5000n);
  assert.equal(r.breakEvenRevenue, 2500000000000n);
});

test('the contribution is measured per unit, on the price less the variable cost, and the stated result is exact', () => {
  const r = modelBreakEvenUnits(DEFAULT);
  assert.equal(r.contributionMeasuredPerUnit, true);
  assert.equal(r.contributionPerUnit, r.pricePerUnit - r.variableCostPerUnit);
  assert.equal(r.totalContributionAtStatedUnits, 1200000000000n);
  assert.equal(r.profitAtStatedUnits, 200000000000n);
  assert.equal(r.marginOfSafetyUnits, 1000n);
  assert.equal(r.coversFixedCostsAtStatedUnits, true);
  assert.equal(r.shortfallAtStatedUnits, 0n);
});

test('the count is rounded up: at a variable cost of 200 the count is 3334, because 3333 units would contribute only 999900000000', () => {
  const r = modelBreakEvenUnits({ ...DEFAULT, variableCostPerUnit: '200' });
  assert.equal(r.unitsRoundedUp, true);
  assert.equal(r.contributionPerUnit, 300000000n);
  assert.equal(r.breakEvenUnits, 3334n);
  assert.equal((r.breakEvenUnits - 1n) * r.contributionPerUnit, 999900000000n);
  assert.ok((r.breakEvenUnits - 1n) * r.contributionPerUnit < r.fixedCosts);
  assert.equal(r.contributionAtBreakEven, 1000200000000n);
  assert.equal(r.excessContributionAtBreakEven, 200000000n);
  assert.equal(r.breakEvenRevenue, 1667000000000n);
});

test('the break-even count always covers the fixed costs and by less than one contribution more, on every stated case that breaks even', () => {
  for (const input of CASES) {
    const r = modelBreakEvenUnits(input);
    assert.equal(r.profitAtStatedUnits, r.totalContributionAtStatedUnits - r.fixedCosts);
    assert.equal(r.shortfallAtStatedUnits, r.profitAtStatedUnits < 0n ? -r.profitAtStatedUnits : 0n);
    if (r.breakEvenUnits === null) {
      assert.equal(r.breaksEven, false);
      assert.equal(r.breakEvenRevenue, null);
      assert.equal(r.marginOfSafetyUnits, null);
    } else {
      assert.ok(r.contributionAtBreakEven >= r.fixedCosts);
      assert.ok(r.excessContributionAtBreakEven >= 0n && r.excessContributionAtBreakEven < r.contributionPerUnit || r.breakEvenUnits === 0n);
      assert.equal(r.breakEvenRevenue, r.breakEvenUnits * r.pricePerUnit);
      assert.equal(r.marginOfSafetyUnits, BigInt(r.statedUnits) - r.breakEvenUnits);
    }
  }
});

test('below break-even the result is a loss stated as a loss: 4000 units lose 200000000000 with a margin of safety of -1000', () => {
  const r = modelBreakEvenUnits({ ...DEFAULT, statedUnits: 4000 });
  assert.equal(r.totalContributionAtStatedUnits, 800000000000n);
  assert.equal(r.profitAtStatedUnits, -200000000000n);
  assert.equal(r.shortfallAtStatedUnits, 200000000000n);
  assert.equal(r.marginOfSafetyUnits, -1000n);
  assert.equal(r.coversFixedCostsAtStatedUnits, false);
});

test('at exactly the break-even count the result is zero and the fixed costs are covered', () => {
  const r = modelBreakEvenUnits({ fixedCosts: '1000000', pricePerUnit: '500', variableCostPerUnit: '300', statedUnits: 5000, decimals: 0 });
  assert.equal(r.breakEvenUnits, 5000n);
  assert.equal(r.profitAtStatedUnits, 0n);
  assert.equal(r.marginOfSafetyUnits, 0n);
  assert.equal(r.coversFixedCostsAtStatedUnits, true);
  assert.equal(r.breakEvenRevenue, 2500000n);
});

test('a variable cost equal to the price states no break-even: the contribution is zero and the result is the whole fixed cost as a loss', () => {
  const r = modelBreakEvenUnits({ ...DEFAULT, variableCostPerUnit: '500' });
  assert.equal(r.noFiniteBreakEvenWhenContributionNotPositive, true);
  assert.equal(r.contributionPerUnit, 0n);
  assert.equal(r.breaksEven, false);
  assert.equal(r.breakEvenUnits, null);
  assert.equal(r.contributionAtBreakEven, null);
  assert.equal(r.totalContributionAtStatedUnits, 0n);
  assert.equal(r.profitAtStatedUnits, -1000000000000n);
});

test('a variable cost above the price states no break-even and losses that grow with every unit: 6000 units lose 1600000000000', () => {
  const r = modelBreakEvenUnits({ ...DEFAULT, variableCostPerUnit: '600' });
  assert.equal(r.contributionPerUnit, -100000000n);
  assert.equal(r.breakEvenUnits, null);
  assert.equal(r.totalContributionAtStatedUnits, -600000000000n);
  assert.equal(r.profitAtStatedUnits, -1600000000000n);
  assert.equal(r.shortfallAtStatedUnits, 1600000000000n);
  const fewer = modelBreakEvenUnits({ ...DEFAULT, variableCostPerUnit: '600', statedUnits: 3000 });
  assert.ok(fewer.profitAtStatedUnits > r.profitAtStatedUnits);
});

test('fixed costs of zero are stated, not refused: break-even is zero units and every contribution stands past it', () => {
  const r = modelBreakEvenUnits({ ...DEFAULT, fixedCosts: '0' });
  assert.equal(r.breakEvenUnits, 0n);
  assert.equal(r.breakEvenRevenue, 0n);
  assert.equal(r.contributionAtBreakEven, 0n);
  assert.equal(r.excessContributionAtBreakEven, 0n);
  assert.equal(r.profitAtStatedUnits, 1200000000000n);
  assert.equal(r.marginOfSafetyUnits, 6000n);
});

test('the contribution is not a fee, and demand, price changes, step costs, and taxes are not priced', () => {
  const r = modelBreakEvenUnits(DEFAULT);
  assert.equal(r.contributionIsFee, false);
  assert.equal(r.demandPriced, false);
  assert.equal(r.priceChangesPriced, false);
  assert.equal(r.stepCostsPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('tiny amounts are exact: fixed costs of 0.001 at a price of 0.0005 and a variable cost of 0.0003 break even at 5 units', () => {
  const r = modelBreakEvenUnits({ fixedCosts: '0.001', pricePerUnit: '0.0005', variableCostPerUnit: '0.0003', statedUnits: 10, decimals: 6 });
  assert.equal(r.contributionPerUnit, 200n);
  assert.equal(r.breakEvenUnits, 5n);
  assert.equal(r.breakEvenRevenue, 2500n);
  assert.equal(r.profitAtStatedUnits, 1000n);
});

test('fractional amounts are exact: 123456.789 of fixed costs at 12.34 less 5.67 break even at 18510 units with an excess of 4911000', () => {
  const r = modelBreakEvenUnits({ fixedCosts: '123456.789', pricePerUnit: '12.34', variableCostPerUnit: '5.67', statedUnits: 20000, decimals: 6 });
  assert.equal(r.contributionPerUnit, 6670000n);
  assert.equal(r.breakEvenUnits, 18510n);
  assert.equal(r.contributionAtBreakEven, 123461700000n);
  assert.equal(r.excessContributionAtBreakEven, 4911000n);
  assert.equal(r.breakEvenRevenue, 228413400000n);
  assert.equal(r.profitAtStatedUnits, 9943211000n);
  assert.equal(r.marginOfSafetyUnits, 1490n);
});

test('a small stated case rounds up and falls short below it: fixed costs of 7 at 3 less 1 break even at 4 units, and 3 units lose 1000000', () => {
  const r = modelBreakEvenUnits({ fixedCosts: '7', pricePerUnit: '3', variableCostPerUnit: '1', statedUnits: 3, decimals: 6 });
  assert.equal(r.breakEvenUnits, 4n);
  assert.equal(r.excessContributionAtBreakEven, 1000000n);
  assert.equal(r.profitAtStatedUnits, -1000000n);
  assert.equal(r.marginOfSafetyUnits, -1n);
});

test('a price of zero is refused', () => {
  assert.throws(() => modelBreakEvenUnits({ ...DEFAULT, pricePerUnit: '0' }), /Price per unit must be greater than zero/);
});

test('a fractional, negative, or over-cap stated unit count is refused', () => {
  assert.throws(() => modelBreakEvenUnits({ ...DEFAULT, statedUnits: 2.5 }), /Stated units must be a whole number/);
  assert.throws(() => modelBreakEvenUnits({ ...DEFAULT, statedUnits: -1 }), /Stated units must be a whole number/);
  assert.throws(() => modelBreakEvenUnits({ ...DEFAULT, statedUnits: 100000001 }), /Stated units must be a whole number/);
});

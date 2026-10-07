import test from 'node:test';
import assert from 'node:assert/strict';
import { creditScenario, collateralStressTest, STRESS_DROPS } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, collateral: 80000, advance: 70 };

test('the default scenario at no drop reproduces the credit scenario exactly', () => {
  const base = creditScenario({ ...LOAN, rate: 8, months: 12 });
  const r = collateralStressTest({ ...LOAN, dropPercent: 0 });
  assert.equal(r.baseLtv, base.ltv);
  assert.equal(r.baseCeiling, base.ceiling);
  assert.deepEqual(r.stressed, r.rows[0]);
  assert.equal(r.stressed.collateralValue, 80000);
  assert.equal(r.stressed.ltv, 62.5);
  assert.equal(r.stressed.headroom, 6000);
  assert.equal(r.stressed.withinLimit, true);
  assert.equal(r.stressed.shortfall, 0);
  assert.equal(r.stressed.topUp, 0);
});

test('the break points are exact: ceiling breached at 10.71%, par at 37.5%', () => {
  const r = collateralStressTest(LOAN);
  assert.ok(near(r.requiredCollateral, 71428.57), `required ${r.requiredCollateral}`);
  assert.ok(near(r.maxDropPercent, 10.71428571, 1e-6), `max drop ${r.maxDropPercent}`);
  assert.equal(r.dropToParPercent, 37.5);
  assert.equal(r.alreadyBreached, false);
});

test('at the maximum drop the ceiling equals the principal; just above it, it breaches', () => {
  const r = collateralStressTest(LOAN);
  const at = collateralStressTest({ ...LOAN, dropPercent: r.maxDropPercent });
  assert.ok(near(at.stressed.headroom, 0, 1e-6), `headroom ${at.stressed.headroom}`);
  assert.equal(at.stressed.withinLimit, true);
  const above = collateralStressTest({ ...LOAN, dropPercent: r.maxDropPercent + 0.1 });
  assert.equal(above.stressed.withinLimit, false);
  assert.ok(above.stressed.shortfall > 0);
});

test('a 25% drop on the default scenario: value $60,000, LTV 83.33%, $8,000 over the ceiling', () => {
  const r = collateralStressTest({ ...LOAN, dropPercent: 25 });
  assert.equal(r.stressed.collateralValue, 60000);
  assert.ok(near(r.stressed.ltv, 83.33), `ltv ${r.stressed.ltv}`);
  assert.equal(r.stressed.ceiling, 42000);
  assert.equal(r.stressed.headroom, -8000);
  assert.equal(r.stressed.shortfall, 8000);
  // Top-up is measured against the required collateral, not the shortfall:
  // restoring the ceiling takes $11,428.57 of collateral at the stressed value.
  assert.ok(near(r.stressed.topUp, 11428.57), `top-up ${r.stressed.topUp}`);
  const topped = collateralStressTest({ principal: 50000, collateral: 80000 * 0.75 + r.stressed.topUp, advance: 70, dropPercent: 0 });
  assert.ok(near(topped.stressed.headroom, 0, 0.01), `topped headroom ${topped.stressed.headroom}`);
});

test('the standard-drop table is monotone: value and ceiling fall, LTV rises', () => {
  const r = collateralStressTest(LOAN);
  assert.deepEqual(r.rows.map(row => row.dropPercent), [...STRESS_DROPS]);
  for (let i = 1; i < r.rows.length; i++) {
    assert.ok(r.rows[i].collateralValue < r.rows[i - 1].collateralValue);
    assert.ok(r.rows[i].ceiling < r.rows[i - 1].ceiling);
    assert.ok(r.rows[i].ltv > r.rows[i - 1].ltv);
  }
  assert.equal(r.rows.at(-1).collateralValue, 40000);
  assert.equal(r.rows.at(-1).ltv, 125);
});

test('a scenario already above its ceiling is already breached, not a 0% tolerance', () => {
  const r = collateralStressTest({ principal: 60000, collateral: 80000, advance: 70 });
  assert.equal(r.alreadyBreached, true);
  assert.equal(r.maxDropPercent, 0);
  assert.equal(r.stressed.withinLimit, false);
  assert.ok(near(r.maxDropPercent, 0));
});

test('a scenario exactly on its ceiling is within at 0% but breached by any fall', () => {
  const r = collateralStressTest({ principal: 56000, collateral: 80000, advance: 70, dropPercent: 0 });
  assert.equal(r.alreadyBreached, false);
  assert.equal(r.maxDropPercent, 0);
  assert.equal(r.stressed.withinLimit, true);
  const any = collateralStressTest({ principal: 56000, collateral: 80000, advance: 70, dropPercent: 1 });
  assert.equal(any.stressed.withinLimit, false);
});

test('drop-to-par is null once the principal already exceeds the collateral', () => {
  const r = collateralStressTest({ principal: 90000, collateral: 80000, advance: 100 });
  assert.equal(r.dropToParPercent, null);
  assert.ok(r.baseLtv > 100);
  const par = collateralStressTest({ principal: 80000, collateral: 80000, advance: 100 });
  assert.equal(par.dropToParPercent, 0);
});

test('at par the stressed LTV is exactly 100%', () => {
  const r = collateralStressTest(LOAN);
  const at = collateralStressTest({ ...LOAN, dropPercent: r.dropToParPercent });
  assert.ok(near(at.stressed.ltv, 100, 1e-9), `ltv ${at.stressed.ltv}`);
  assert.ok(near(at.stressed.collateralValue, 50000, 1e-6));
});

test('invalid stress inputs are rejected', () => {
  assert.throws(() => collateralStressTest({ ...LOAN, dropPercent: -1 }), /collateral drop/);
  assert.throws(() => collateralStressTest({ ...LOAN, dropPercent: 100 }), /collateral drop/);
  assert.throws(() => collateralStressTest({ ...LOAN, dropPercent: NaN }), /collateral drop/);
  assert.throws(() => collateralStressTest({ ...LOAN, principal: -5 }), /principal/);
  assert.throws(() => collateralStressTest({ ...LOAN, collateral: 0 }), /collateral/);
  assert.throws(() => collateralStressTest({ ...LOAN, advance: 0 }), /advance rate/);
  assert.throws(() => collateralStressTest({ ...LOAN, advance: 101 }), /advance rate/);
});

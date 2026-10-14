import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelLendingLiquidation } from '../src/domain.js';

// Lending liquidation model (v1.174): a position is liquidatable
// only when its debt exceeds the most debt its collateral may
// carry at the liquidation threshold; the liquidator repays a
// stated part of the debt and seizes the repayment plus a penalty
// charged on the repayment — never on the whole collateral or the
// whole debt. The seizure is capped at the collateral that exists,
// and debt left under no collateral is stated as bad debt.
const DEFAULT = { collateralValue: '10000', debtValue: '9000', liquidationThresholdBps: 8000, liquidationPenaltyBps: 1000, repayAmount: '4500', decimals: 6 };

test('the preloaded liquidation: repaying 4500 of 9000 debt against 10000 collateral at an 8000 threshold and 1000 penalty seizes 4950', () => {
  const r = modelLendingLiquidation(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.collateralValue, 10000000000n);
  assert.equal(r.debtValue, 9000000000n);
  assert.equal(r.maxDebt, 8000000000n);
  assert.equal(r.repayAmount, 4500000000n);
  assert.equal(r.seizedExact, 4950000000n);
  assert.equal(r.seized, 4950000000n);
  assert.equal(r.penaltyAmount, 450000000n);
  assert.equal(r.liquidatorShortfall, 0n);
  assert.equal(r.debtAfter, 4500000000n);
  assert.equal(r.collateralAfter, 5050000000n);
  assert.equal(r.maxDebtAfter, 4040000000n);
  assert.equal(r.healthBpsText, '8888.88');
  assert.equal(r.seizedShareBpsText, '4950.00');
  assert.equal(r.repaidShareBpsText, '5000.00');
  assert.equal(r.liquidatable, true);
  assert.equal(r.collateralExhausted, false);
  assert.equal(r.fullyRepaid, false);
  assert.equal(r.stillLiquidatableAfter, true);
  assert.equal(r.badDebt, false);
  assert.equal(r.noPenalty, false);
});

test('identities: debt after is debt minus repayment, collateral after is collateral minus seizure, and a covered seizure is repayment plus penalty', () => {
  const r = modelLendingLiquidation(DEFAULT);
  assert.equal(r.debtAfter, r.debtValue - r.repayAmount);
  assert.equal(r.collateralAfter, r.collateralValue - r.seized);
  assert.equal(r.seized, r.repayAmount + r.penaltyAmount);
});

test('a healthy position is refused: debt within the threshold cannot be liquidated', () => {
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, debtValue: '8000' }), /not liquidatable/);
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, debtValue: '7000' }), /not liquidatable/);
});

test('debt exactly one base unit past the threshold is liquidatable', () => {
  const r = modelLendingLiquidation({ collateralValue: '10000', debtValue: '8000.000001', liquidationThresholdBps: 8000, liquidationPenaltyBps: 1000, repayAmount: '1', decimals: 6 });
  assert.equal(r.maxDebt, 8000000000n);
  assert.equal(r.debtValue, 8000000001n);
  assert.equal(r.liquidatable, true);
});

test('repaying the whole debt closes the position: fully repaid, nothing left liquidatable', () => {
  const r = modelLendingLiquidation({ ...DEFAULT, repayAmount: '9000' });
  assert.equal(r.seized, 9900000000n);
  assert.equal(r.penaltyAmount, 900000000n);
  assert.equal(r.debtAfter, 0n);
  assert.equal(r.collateralAfter, 100000000n);
  assert.equal(r.fullyRepaid, true);
  assert.equal(r.stillLiquidatableAfter, false);
  assert.equal(r.repaidShareBpsText, '10000.00');
  assert.equal(r.seizedShareBpsText, '9900.00');
});

test('the seizure is capped at the collateral that exists, and the shortfall is stated', () => {
  const r = modelLendingLiquidation({ collateralValue: '5000', debtValue: '9000', liquidationThresholdBps: 8000, liquidationPenaltyBps: 5000, repayAmount: '9000', decimals: 6 });
  assert.equal(r.seizedExact, 13500000000n);
  assert.equal(r.seized, 5000000000n);
  assert.equal(r.collateralExhausted, true);
  assert.equal(r.collateralAfter, 0n);
  assert.equal(r.penaltyAmount, 0n);
  assert.equal(r.liquidatorShortfall, 4000000000n);
  assert.equal(r.seizedShareBpsText, '10000.00');
});

test('bad debt: collateral exhausted while debt remains is stated, never dropped', () => {
  const r = modelLendingLiquidation({ collateralValue: '5000', debtValue: '9000', liquidationThresholdBps: 8000, liquidationPenaltyBps: 5000, repayAmount: '4000', decimals: 6 });
  assert.equal(r.seized, 5000000000n);
  assert.equal(r.penaltyAmount, 1000000000n);
  assert.equal(r.debtAfter, 5000000000n);
  assert.equal(r.collateralAfter, 0n);
  assert.equal(r.badDebt, true);
  assert.equal(r.repaidShareBpsText, '4444.44');
});

test('a zero penalty seizes exactly the repayment', () => {
  const r = modelLendingLiquidation({ ...DEFAULT, liquidationPenaltyBps: 0 });
  assert.equal(r.seized, r.repayAmount);
  assert.equal(r.penaltyAmount, 0n);
  assert.equal(r.noPenalty, true);
  assert.equal(r.collateralAfter, 5500000000n);
});

test('the penalty is charged on the repayment, never on the debt or the collateral', () => {
  const a = modelLendingLiquidation(DEFAULT);
  const b = modelLendingLiquidation({ ...DEFAULT, repayAmount: '2250' });
  assert.equal(b.seized, 2475000000n);
  assert.equal(b.penaltyAmount, 225000000n);
  assert.equal(a.penaltyAmount, 2n * b.penaltyAmount);
});

test('shares are derived from the amounts, beyond float precision', () => {
  const r = modelLendingLiquidation({ collateralValue: '10000.000001', debtValue: '9000.000001', liquidationThresholdBps: 8000, liquidationPenaltyBps: 3333, repayAmount: '4500.000001', decimals: 6 });
  assert.equal(r.seized, 5999850001n);
  assert.equal(r.penaltyAmount, 1499850000n);
  assert.equal(r.seizedShareBpsText, '5999.85');
  assert.equal(r.repaidShareBpsText, '5000.00');
  assert.equal(r.healthBpsText, '8888.88');
});

test('the penalty can floor to zero on a tiny repayment, and the model states it', () => {
  const r = modelLendingLiquidation({ collateralValue: '10', debtValue: '9', liquidationThresholdBps: 8000, liquidationPenaltyBps: 1000, repayAmount: '5', decimals: 0 });
  assert.equal(r.seizedExact, 5n);
  assert.equal(r.seized, 5n);
  assert.equal(r.penaltyAmount, 0n);
  assert.equal(r.noPenalty, false);
});

test('refusals: zero collateral, zero debt, zero repayment, and repaying more than the debt', () => {
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, collateralValue: '0' }), /Collateral value must be greater than zero/);
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, debtValue: '0' }), /Debt value must be greater than zero/);
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, repayAmount: '0' }), /Repayment amount must be greater than zero/);
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, repayAmount: '9001' }), /Cannot repay more than the outstanding debt/);
});

test('refusals: out-of-range or fractional threshold and penalty', () => {
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, liquidationThresholdBps: 0 }), /Liquidation threshold/);
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, liquidationThresholdBps: 10001 }), /Liquidation threshold/);
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, liquidationThresholdBps: 8000.5 }), /Liquidation threshold/);
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, liquidationPenaltyBps: -1 }), /Liquidation penalty/);
  assert.throws(() => modelLendingLiquidation({ ...DEFAULT, liquidationPenaltyBps: 10001 }), /Liquidation penalty/);
});

test('a partial liquidation that restores health says so', () => {
  const r = modelLendingLiquidation({ collateralValue: '10', debtValue: '9', liquidationThresholdBps: 8000, liquidationPenaltyBps: 1000, repayAmount: '5', decimals: 0 });
  assert.equal(r.debtAfter, 4n);
  assert.equal(r.maxDebtAfter, 4n);
  assert.equal(r.stillLiquidatableAfter, false);
});

test('the shipped site carries the lending liquidation panel and its honesty boundary', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /lending-liquidation-output/);
  assert.match(app, /PRISM lends nothing, holds no collateral, repays no debt, and seizes nothing/);
  assert.match(app, /v1\.174/);
});

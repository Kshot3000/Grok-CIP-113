import test from 'node:test';
import assert from 'node:assert/strict';
import { modelWaterfallDistribution } from '../src/domain.js';

const DEFAULT = { proceeds: '1000', seniorClaim: '600', juniorClaim: '500', decimals: 6 };
const CASES = [['1000', '600', '500', 6], ['300', '600', '500', 6], ['600', '600', '500', 6], ['1100', '600', '500', 6], ['1500', '600', '500', 6], ['0', '600', '500', 6], ['1000', '0', '500', 6], ['1000', '0', '0', 6], ['100.25', '40.1', '30', 6], ['7', '3', '2', 0]];

test('preload: proceeds of 1000 pay the senior claim of 600 in full, then pay 400 toward the junior claim of 500, which stands 100 short', () => {
  const r = modelWaterfallDistribution(DEFAULT);
  assert.equal(r.proceedsAmount, 1000000000n);
  assert.equal(r.seniorClaimAmount, 600000000n);
  assert.equal(r.juniorClaimAmount, 500000000n);
  assert.equal(r.totalClaimsAmount, 1100000000n);
  assert.equal(r.seniorPaidAmount, 600000000n);
  assert.equal(r.remainingAfterSeniorAmount, 400000000n);
  assert.equal(r.juniorPaidAmount, 400000000n);
  assert.equal(r.residualAmount, 0n);
  assert.equal(r.seniorShortfallAmount, 0n);
  assert.equal(r.juniorShortfallAmount, 100000000n);
  assert.equal(r.totalPaidToClaimsAmount, 1000000000n);
  assert.equal(r.totalShortfallAmount, 100000000n);
  assert.equal(r.seniorPaidInFull, true);
  assert.equal(r.juniorPaidInFull, false);
  assert.equal(r.claimsPaidInFull, false);
});

test('the distribution is conserved exactly on every stated case: each receipt plus its shortfall equals its claim, and both receipts plus the residual equal the proceeds', () => {
  for (const [proceeds, seniorClaim, juniorClaim, decimals] of CASES) {
    const r = modelWaterfallDistribution({ proceeds, seniorClaim, juniorClaim, decimals });
    assert.equal(r.distributionConserved, true);
    assert.equal(r.seniorPaidAmount + r.seniorShortfallAmount, r.seniorClaimAmount);
    assert.equal(r.juniorPaidAmount + r.juniorShortfallAmount, r.juniorClaimAmount);
    assert.equal(r.seniorPaidAmount + r.juniorPaidAmount + r.residualAmount, r.proceedsAmount);
    assert.equal(r.seniorPaidAmount + r.remainingAfterSeniorAmount, r.proceedsAmount);
    assert.equal(r.totalPaidToClaimsAmount + r.totalShortfallAmount, r.totalClaimsAmount);
  }
});

test('the junior claim is measured on the remainder after the senior claim, never on the whole proceeds', () => {
  const r = modelWaterfallDistribution(DEFAULT);
  assert.equal(r.juniorMeasuredOnRemainder, true);
  assert.equal(r.juniorPaidAmount, 400000000n);
  // Measured on the whole proceeds, the junior claim would have been paid its whole 500 alongside the senior claim.
  assert.notEqual(r.juniorPaidAmount, r.juniorClaimAmount);
  assert.equal(r.juniorPaidAmount, r.remainingAfterSeniorAmount);
});

test('the senior claim is paid first on every stated case: the junior receives nothing while any of the senior claim stands short', () => {
  for (const [proceeds, seniorClaim, juniorClaim, decimals] of CASES) {
    const r = modelWaterfallDistribution({ proceeds, seniorClaim, juniorClaim, decimals });
    assert.equal(r.seniorPaidFirst, true);
    if (r.seniorShortfallAmount > 0n) assert.equal(r.juniorPaidAmount, 0n);
    assert.ok(r.seniorPaidAmount <= r.seniorClaimAmount);
    assert.ok(r.juniorPaidAmount <= r.juniorClaimAmount);
  }
});

test('where the proceeds do not reach the senior claim, the junior claim receives nothing and both claims stand short', () => {
  const r = modelWaterfallDistribution({ proceeds: '300', seniorClaim: '600', juniorClaim: '500', decimals: 6 });
  assert.equal(r.seniorPaidAmount, 300000000n);
  assert.equal(r.seniorShortfallAmount, 300000000n);
  assert.equal(r.seniorStandsShort, true);
  assert.equal(r.juniorPaidAmount, 0n);
  assert.equal(r.juniorReceivesNothing, true);
  assert.equal(r.juniorShortfallAmount, 500000000n);
  assert.equal(r.remainingAfterSeniorAmount, 0n);
});

test('where the proceeds exactly reach the senior claim, the senior is paid in full and the junior still receives nothing', () => {
  const r = modelWaterfallDistribution({ proceeds: '600', seniorClaim: '600', juniorClaim: '500', decimals: 6 });
  assert.equal(r.seniorPaidInFull, true);
  assert.equal(r.seniorStandsShort, false);
  assert.equal(r.juniorPaidAmount, 0n);
  assert.equal(r.juniorReceivesNothing, true);
  assert.equal(r.juniorShortfallAmount, 500000000n);
});

test('where the proceeds cover both claims exactly, both are paid in full and no residual remains', () => {
  const r = modelWaterfallDistribution({ proceeds: '1100', seniorClaim: '600', juniorClaim: '500', decimals: 6 });
  assert.equal(r.claimsPaidInFull, true);
  assert.equal(r.juniorPaidInFull, true);
  assert.equal(r.residualAmount, 0n);
  assert.equal(r.proceedsExceedClaims, false);
  assert.equal(r.totalShortfallAmount, 0n);
});

test('proceeds beyond both claims are the residual: paid to neither claim and stated as beyond them', () => {
  const r = modelWaterfallDistribution({ proceeds: '1500', seniorClaim: '600', juniorClaim: '500', decimals: 6 });
  assert.equal(r.claimsPaidInFull, true);
  assert.equal(r.seniorPaidAmount, 600000000n);
  assert.equal(r.juniorPaidAmount, 500000000n);
  assert.equal(r.residualAmount, 400000000n);
  assert.equal(r.proceedsExceedClaims, true);
  assert.equal(r.totalPaidToClaimsAmount, 1100000000n);
});

test('proceeds of zero are stated, not refused: both claims stand short in full and nothing is paid', () => {
  const r = modelWaterfallDistribution({ proceeds: '0', seniorClaim: '600', juniorClaim: '500', decimals: 6 });
  assert.equal(r.hasProceeds, false);
  assert.equal(r.hasClaims, true);
  assert.equal(r.seniorPaidAmount, 0n);
  assert.equal(r.juniorPaidAmount, 0n);
  assert.equal(r.seniorShortfallAmount, 600000000n);
  assert.equal(r.juniorShortfallAmount, 500000000n);
  assert.equal(r.residualAmount, 0n);
});

test('where neither proceeds nor claims are stated there is nothing to distribute', () => {
  const r = modelWaterfallDistribution({ proceeds: '0', seniorClaim: '0', juniorClaim: '0', decimals: 6 });
  assert.equal(r.hasProceeds, false);
  assert.equal(r.hasClaims, false);
  assert.equal(r.claimsPaidInFull, false);
  assert.equal(r.totalClaimsAmount, 0n);
  assert.equal(r.residualAmount, 0n);
});

test('a senior claim of zero is stated, not refused: the junior claim is paid from the whole proceeds', () => {
  const r = modelWaterfallDistribution({ proceeds: '1000', seniorClaim: '0', juniorClaim: '500', decimals: 6 });
  assert.equal(r.seniorPaidAmount, 0n);
  assert.equal(r.seniorPaidInFull, false);
  assert.equal(r.remainingAfterSeniorAmount, 1000000000n);
  assert.equal(r.juniorPaidAmount, 500000000n);
  assert.equal(r.juniorPaidInFull, true);
  assert.equal(r.residualAmount, 500000000n);
});

test('missing amounts state zero, and fractional amounts state exactly in BigInt', () => {
  const missing = modelWaterfallDistribution({ proceeds: '1000', decimals: 6 });
  assert.equal(missing.seniorClaimAmount, 0n);
  assert.equal(missing.juniorClaimAmount, 0n);
  assert.equal(missing.residualAmount, 1000000000n);
  const r = modelWaterfallDistribution({ proceeds: '100.25', seniorClaim: '40.1', juniorClaim: '30', decimals: 6 });
  assert.equal(r.seniorPaidAmount, 40100000n);
  assert.equal(r.remainingAfterSeniorAmount, 60150000n);
  assert.equal(r.juniorPaidAmount, 30000000n);
  assert.equal(r.residualAmount, 30150000n);
});

test('the distribution is not pro-rata: equal claims at different ranks are not paid equal shares of short proceeds', () => {
  const r = modelWaterfallDistribution({ proceeds: '500', seniorClaim: '500', juniorClaim: '500', decimals: 6 });
  assert.equal(r.proRataPriced, false);
  // A pro-rata split of 500 across two equal claims would pay 250 to each; priority pays the senior whole and the junior nothing.
  assert.equal(r.seniorPaidAmount, 500000000n);
  assert.equal(r.juniorPaidAmount, 0n);
  assert.notEqual(r.seniorPaidAmount, r.juniorPaidAmount);
});

test('the residual is not a fee and is not stated as profit, and the distribution itself is not a fee', () => {
  const r = modelWaterfallDistribution({ proceeds: '1500', seniorClaim: '600', juniorClaim: '500', decimals: 6 });
  assert.equal(r.residualIsFee, false);
  assert.equal(r.residualIsProfit, false);
  assert.equal(r.distributionIsFee, false);
});

test('what is not priced stays unpriced: claim validity, interest in a claim, further ranks, fees, and taxes', () => {
  const r = modelWaterfallDistribution(DEFAULT);
  assert.equal(r.claimValidityPriced, false);
  assert.equal(r.interestPriced, false);
  assert.equal(r.furtherRanksPriced, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.taxesPriced, false);
});

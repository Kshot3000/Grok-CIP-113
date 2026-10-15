import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelInsuranceClaim, modelInsuranceClaimRemaining } from '../src/domain.js';

// Insurance claim against remaining coverage model (v1.195): the
// insurance axis's second moment (v1.182 lesson) — the claim model
// prices a claim against a FULL limit and a FULL deductible, but
// coverage is a period limit shared by the period's claims and a
// deductible is met once per period. Prior use shrinks the cap
// (payout capped at the REMAINING limit) and a deductible already
// met is never borne again (only the part still owed is borne
// now). The order is unchanged: deductible still owed first, only
// what remains against the remaining limit. Shares are derived
// from the amounts against this claim.
const DEFAULT = { claimedAmount: '30000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000', coverageAlreadyUsed: '20000', deductibleAlreadyMet: '1000' };

test('the preloaded later claim: 30000 claimed with 20000 of the 25000 period limit already used and the 1000 deductible already met — only 5000 remains, so the payout is 5000, nothing more is borne toward the deductible, and the claimant bears the 25000 above the remaining coverage', () => {
  const r = modelInsuranceClaimRemaining(DEFAULT);
  assert.equal(r.remainingCoverageLimit, 5000000000n);
  assert.equal(r.deductibleStillOwed, 0n);
  assert.equal(r.deductibleBorneNow, 0n);
  assert.equal(r.claimAfterDeductible, 30000000000n);
  assert.equal(r.payout, 5000000000n);
  assert.equal(r.aboveRemainingCoverage, 25000000000n);
  assert.equal(r.borneByClaimant, 25000000000n);
  assert.equal(r.coverageUsedAfter, 25000000000n);
  assert.equal(r.coverageRemainingAfter, 0n);
  assert.equal(r.cappedByRemainingCoverage, true);
  assert.equal(r.deductibleAlreadyFullyMet, true);
  assert.equal(r.coverageExhaustedAfter, true);
});

test('identities hold across later claims: payout plus borne is this claim, the deductible borne now plus above-remaining is what is borne, prior use plus payout plus remaining after is the stated limit, and met plus borne now plus still owed after is the stated deductible', () => {
  const cases = [
    DEFAULT,
    { claimedAmount: '777', decimals: 6, deductibleAmount: '111', coverageLimit: '500', coverageAlreadyUsed: '200', deductibleAlreadyMet: '37' },
    { claimedAmount: '60', decimals: 6, deductibleAmount: '111', coverageLimit: '500', coverageAlreadyUsed: '200', deductibleAlreadyMet: '37' },
    { claimedAmount: '5000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000', coverageAlreadyUsed: '25000', deductibleAlreadyMet: '1000' },
    { claimedAmount: '1000', decimals: 0, deductibleAmount: '0', coverageLimit: '1000', coverageAlreadyUsed: '0', deductibleAlreadyMet: '0' },
  ];
  for (const c of cases) {
    const r = modelInsuranceClaimRemaining(c);
    assert.equal(r.payout + r.borneByClaimant, r.claimedAmount);
    assert.equal(r.deductibleBorneNow + r.aboveRemainingCoverage, r.borneByClaimant);
    assert.equal(r.coverageAlreadyUsed + r.payout + r.coverageRemainingAfter, r.coverageLimit);
    assert.equal(r.deductibleAlreadyMet + r.deductibleBorneNow + r.deductibleStillOwedAfter, r.deductibleAmount);
    assert.equal(r.deductibleBorneNow + r.claimAfterDeductible, r.claimedAmount);
  }
});

test('with nothing used and nothing met, this model agrees with the base claim model exactly — same payout, same borne, same deductible borne, same remainder', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '50000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' });
  const b = modelInsuranceClaim({ claimedAmount: '50000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' });
  assert.equal(r.noPriorUse, true);
  assert.equal(r.payout, b.payout);
  assert.equal(r.borneByClaimant, b.borneByClaimant);
  assert.equal(r.deductibleBorneNow, b.deductibleBorne);
  assert.equal(r.claimAfterDeductible, b.claimAfterDeductible);
});

test('a later claim is the base model on the transformed terms: the 777 case with 37 of the 111 deductible met and 200 of the 500 limit used equals the base model at a 74 deductible and a 300 limit', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '777', decimals: 6, deductibleAmount: '111', coverageLimit: '500', coverageAlreadyUsed: '200', deductibleAlreadyMet: '37' });
  const b = modelInsuranceClaim({ claimedAmount: '777', decimals: 6, deductibleAmount: '74', coverageLimit: '300' });
  assert.equal(r.payout, b.payout);
  assert.equal(r.borneByClaimant, b.borneByClaimant);
  assert.equal(r.deductibleBorneNow, b.deductibleBorne);
});

test('the payout is capped at the remaining limit, never at the stated limit: capping the preload at the stated 25000 limit would pay 25000 of coverage the period has already spent 20000 of', () => {
  const r = modelInsuranceClaimRemaining(DEFAULT);
  assert.equal(r.payout, 5000000000n);
  assert.notEqual(r.payout, 25000000000n);
  assert.ok(r.payout <= r.remainingCoverageLimit);
});

test('a deductible already met is never borne again: on the preload the deductible borne now is zero even though a 1000 deductible is stated', () => {
  const r = modelInsuranceClaimRemaining(DEFAULT);
  assert.equal(r.deductibleBorneNow, 0n);
  assert.equal(r.deductibleNowShareBpsText, '0.00');
  assert.equal(r.deductibleMetAfter, 1000000000n);
});

test('a partly met deductible is borne only for the part still owed: 37 of 111 met leaves 74 still owed, and the 777 claim bears exactly that 74 now and completes the deductible', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '777', decimals: 6, deductibleAmount: '111', coverageLimit: '500', coverageAlreadyUsed: '200', deductibleAlreadyMet: '37' });
  assert.equal(r.deductiblePartlyMet, true);
  assert.equal(r.deductibleStillOwed, 74000000n);
  assert.equal(r.deductibleBorneNow, 74000000n);
  assert.equal(r.deductibleMetAfter, 111000000n);
  assert.equal(r.deductibleCompletedNow, true);
  assert.equal(r.payout, 300000000n);
  assert.equal(r.borneByClaimant, 477000000n);
});

test('coverage already exhausted before this claim pays nothing, and that is not a denial and not the deductible: the whole 5000 claim is above the remaining coverage of zero', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '5000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000', coverageAlreadyUsed: '25000', deductibleAlreadyMet: '1000' });
  assert.equal(r.coverageExhaustedBefore, true);
  assert.equal(r.remainingCoverageLimit, 0n);
  assert.equal(r.payout, 0n);
  assert.equal(r.nothingPaid, true);
  assert.equal(r.aboveRemainingCoverage, 5000000000n);
  assert.equal(r.claimWithinRemainingDeductible, false);
});

test('a claim below the deductible still owed pays nothing and is not spent coverage: the 60 claim against 74 still owed is absorbed by the deductible, 14 remains owed, and the remaining coverage is untouched', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '60', decimals: 6, deductibleAmount: '111', coverageLimit: '500', coverageAlreadyUsed: '200', deductibleAlreadyMet: '37' });
  assert.equal(r.claimWithinRemainingDeductible, true);
  assert.equal(r.payout, 0n);
  assert.equal(r.deductibleBorneNow, 60000000n);
  assert.equal(r.deductibleStillOwedAfter, 14000000n);
  assert.equal(r.coverageRemainingAfter, 300000000n);
  assert.equal(r.coverageExhaustedBefore, false);
});

test('a claim exactly equal to the deductible still owed completes the deductible and nothing remains — a boundary distinct from below it and from above it', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '74', decimals: 6, deductibleAmount: '111', coverageLimit: '500', coverageAlreadyUsed: '200', deductibleAlreadyMet: '37' });
  assert.equal(r.exactlyAtRemainingDeductible, true);
  assert.equal(r.claimAfterDeductible, 0n);
  assert.equal(r.payout, 0n);
  assert.equal(r.deductibleStillOwedAfter, 0n);
  assert.equal(r.deductibleCompletedNow, true);
});

test('a later claim fully covered by the remaining coverage: 4000 claimed, deductible met, 20000 used of 25000 — 4000 remains after the (zero) deductible still owed and the remaining 5000 covers it in full', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '4000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000', coverageAlreadyUsed: '20000', deductibleAlreadyMet: '1000' });
  assert.equal(r.payout, 4000000000n);
  assert.equal(r.aboveRemainingCoverage, 0n);
  assert.equal(r.fullyCovered, true);
  assert.equal(r.coverageRemainingAfter, 1000000000n);
});

test('what remains after the deductible exactly equal to the remaining limit is paid in full at that limit — fully covered, not capped', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '5000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000', coverageAlreadyUsed: '20000', deductibleAlreadyMet: '1000' });
  assert.equal(r.claimAfterDeductible, 5000000000n);
  assert.equal(r.remainingCoverageLimit, 5000000000n);
  assert.equal(r.payout, 5000000000n);
  assert.equal(r.fullyCovered, true);
  assert.equal(r.cappedByRemainingCoverage, false);
  assert.equal(r.coverageExhaustedAfter, true);
});

test('shares are derived from the amounts against this claim: on the 777 case the payout share is 3861.00, the deductible-now share 952.38, and the above-remaining share 5186.61, and the remaining share of the stated limit is 6000.00', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '777', decimals: 6, deductibleAmount: '111', coverageLimit: '500', coverageAlreadyUsed: '200', deductibleAlreadyMet: '37' });
  assert.equal(r.payoutShareBpsText, '3861.00');
  assert.equal(r.deductibleNowShareBpsText, '952.38');
  assert.equal(r.aboveRemainingShareBpsText, '5186.61');
  assert.equal(r.remainingShareBpsText, '6000.00');
});

test('on the preload the payout share of the claim is 1666.66 and the above-remaining share 8333.33 — measured against this claim, never against the stated limit', () => {
  const r = modelInsuranceClaimRemaining(DEFAULT);
  assert.equal(r.payoutShareBpsText, '1666.66');
  assert.equal(r.aboveRemainingShareBpsText, '8333.33');
  assert.equal(r.remainingShareBpsText, '2000.00');
});

test('amounts beyond float precision stay exact: a 2^53+1 claim with the 1-unit deductible met and 1 unit of the limit used pays 2^53 exactly and bears 1', () => {
  const r = modelInsuranceClaimRemaining({ claimedAmount: '9007199254740993', decimals: 0, deductibleAmount: '1', coverageLimit: '9007199254740993', coverageAlreadyUsed: '1', deductibleAlreadyMet: '1' });
  assert.equal(r.payout, 9007199254740992n);
  assert.equal(r.borneByClaimant, 1n);
  assert.equal(r.coverageUsedAfter, 9007199254740993n);
});

test('prior use beyond the stated terms is refused: coverage already used above the limit, and deductible already met above the deductible', () => {
  assert.throws(() => modelInsuranceClaimRemaining({ ...DEFAULT, coverageAlreadyUsed: '25001' }), /Coverage already used cannot exceed the coverage limit/);
  assert.throws(() => modelInsuranceClaimRemaining({ ...DEFAULT, deductibleAlreadyMet: '1001' }), /Deductible already met cannot exceed the deductible/);
  assert.throws(() => modelInsuranceClaimRemaining({ ...DEFAULT, coverageLimit: '0' }), /Coverage limit must be greater than zero/);
});

test('defaults and malformed amounts: an unstated claim is no claim — nothing is paid, nothing more is borne, and the remaining coverage is untouched — and malformed amounts are refused', () => {
  const r = modelInsuranceClaimRemaining({ decimals: 6, deductibleAmount: '1000', coverageLimit: '25000', coverageAlreadyUsed: '20000', deductibleAlreadyMet: '400' });
  assert.equal(r.noClaim, true);
  assert.equal(r.payout, 0n);
  assert.equal(r.borneByClaimant, 0n);
  assert.equal(r.coverageRemainingAfter, 5000000000n);
  assert.throws(() => modelInsuranceClaimRemaining({ ...DEFAULT, claimedAmount: '30,000' }), /without commas or exponents/);
  assert.throws(() => modelInsuranceClaimRemaining({ ...DEFAULT, coverageAlreadyUsed: '2e4' }), /without commas or exponents/);
});

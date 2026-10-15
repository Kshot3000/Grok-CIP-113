import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelInsuranceClaim } from '../src/domain.js';

// Insurance claim model (v1.197): a NEW axis — the deposit axis
// closed with its two moments (v1.181), and PRISM priced no claim
// against stated coverage. The deductible applies FIRST (a claim
// at or below it pays nothing — the deductible absorbing the
// claim, not a denial) and only what remains is measured against
// the coverage limit. What the claimant bears is the deductible
// borne plus the amount above coverage, stated separately.
// Shares are derived from the amounts against the claim.
const DEFAULT = { claimedAmount: '50000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' };

test('the preloaded claim: 50000 claimed against a 1000 deductible and a 25000 limit — 49000 remains after the deductible, the payout is capped at 25000, and the claimant bears 25000 (1000 deductible plus 24000 above coverage)', () => {
  const r = modelInsuranceClaim(DEFAULT);
  assert.equal(r.deductibleBorne, 1000000000n);
  assert.equal(r.claimAfterDeductible, 49000000000n);
  assert.equal(r.payout, 25000000000n);
  assert.equal(r.aboveCoverage, 24000000000n);
  assert.equal(r.borneByClaimant, 25000000000n);
  assert.equal(r.cappedByCoverage, true);
});

test('identities hold across claims: payout plus borne is the claim, deductible borne plus above coverage is what is borne, and deductible borne plus what remains is the claim', () => {
  const cases = [
    DEFAULT,
    { claimedAmount: '777', decimals: 6, deductibleAmount: '111', coverageLimit: '500' },
    { claimedAmount: '800', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' },
    { claimedAmount: '20000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' },
    { claimedAmount: '1000', decimals: 0, deductibleAmount: '0', coverageLimit: '1000' },
  ];
  for (const c of cases) {
    const r = modelInsuranceClaim(c);
    assert.equal(r.payout + r.borneByClaimant, r.claimedAmount);
    assert.equal(r.deductibleBorne + r.aboveCoverage, r.borneByClaimant);
    assert.equal(r.deductibleBorne + r.claimAfterDeductible, r.claimedAmount);
    assert.equal(r.payout + r.aboveCoverage, r.claimAfterDeductible);
  }
});

test('a claim fully within coverage after the deductible is paid in full: 20000 claimed, 1000 deductible, 25000 limit pays 19000 and the claimant bears only the deductible', () => {
  const r = modelInsuranceClaim({ claimedAmount: '20000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' });
  assert.equal(r.payout, 19000000000n);
  assert.equal(r.aboveCoverage, 0n);
  assert.equal(r.borneByClaimant, 1000000000n);
  assert.equal(r.fullyCovered, true);
  assert.equal(r.cappedByCoverage, false);
});

test('a claim below the deductible pays nothing and it is not a denial: the deductible absorbs the whole 800 claim, and the deductible borne is the claim itself, never more than was claimed', () => {
  const r = modelInsuranceClaim({ claimedAmount: '800', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' });
  assert.equal(r.payout, 0n);
  assert.equal(r.nothingPaid, true);
  assert.equal(r.claimWithinDeductible, true);
  assert.equal(r.deductibleBorne, 800000000n);
  assert.equal(r.borneByClaimant, 800000000n);
  assert.equal(r.deductibleShareBpsText, '10000.00');
});

test('a claim exactly equal to the deductible is borne in full and nothing remains — a boundary distinct from below it and from above it', () => {
  const r = modelInsuranceClaim({ claimedAmount: '1000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' });
  assert.equal(r.exactlyAtDeductible, true);
  assert.equal(r.claimWithinDeductible, true);
  assert.equal(r.claimAfterDeductible, 0n);
  assert.equal(r.payout, 0n);
});

test('with no deductible the whole claim is measured against the limit: 30000 claimed with no deductible and a 25000 limit pays 25000 and 5000 is above coverage', () => {
  const r = modelInsuranceClaim({ claimedAmount: '30000', decimals: 6, deductibleAmount: '0', coverageLimit: '25000' });
  assert.equal(r.noDeductible, true);
  assert.equal(r.deductibleBorne, 0n);
  assert.equal(r.payout, 25000000000n);
  assert.equal(r.aboveCoverage, 5000000000n);
});

test('what remains after the deductible exactly equal to the limit is paid in full at the limit — fully covered, not capped: the cap binds only above it', () => {
  const r = modelInsuranceClaim({ claimedAmount: '26000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' });
  assert.equal(r.claimAfterDeductible, 25000000000n);
  assert.equal(r.payout, 25000000000n);
  assert.equal(r.aboveCoverage, 0n);
  assert.equal(r.fullyCovered, true);
  assert.equal(r.cappedByCoverage, false);
});

test('shares are derived from the amounts against the claim: on the 777 case with a 111 deductible and a 500 limit, the payout share is 6435.00, the deductible share 1428.57, and the above-coverage share 2136.42', () => {
  const r = modelInsuranceClaim({ claimedAmount: '777', decimals: 6, deductibleAmount: '111', coverageLimit: '500' });
  assert.equal(r.payout, 500000000n);
  assert.equal(r.borneByClaimant, 277000000n);
  assert.equal(r.payoutShareBpsText, '6435.00');
  assert.equal(r.deductibleShareBpsText, '1428.57');
  assert.equal(r.aboveCoverageShareBpsText, '2136.42');
});

test('on the preload the payout share of the claim is 5000.00, the deductible share 200.00, and the above-coverage share 4800.00', () => {
  const r = modelInsuranceClaim(DEFAULT);
  assert.equal(r.payoutShareBpsText, '5000.00');
  assert.equal(r.deductibleShareBpsText, '200.00');
  assert.equal(r.aboveCoverageShareBpsText, '4800.00');
});

test('amounts beyond float precision stay exact: a 2^53+1 claim with a 1-unit deductible pays 2^53 exactly', () => {
  const r = modelInsuranceClaim({ claimedAmount: '9007199254740993', decimals: 0, deductibleAmount: '1', coverageLimit: '9007199254740993' });
  assert.equal(r.claimAfterDeductible, 9007199254740992n);
  assert.equal(r.payout, 9007199254740992n);
  assert.equal(r.borneByClaimant, 1n);
  assert.equal(r.fullyCovered, true);
});

test('a coverage limit of zero is refused — a policy that can pay nothing has no claim to price', () => {
  assert.throws(() => modelInsuranceClaim({ ...DEFAULT, coverageLimit: '0' }), /Coverage limit must be greater than zero/);
});

test('malformed amounts are refused', () => {
  assert.throws(() => modelInsuranceClaim({ ...DEFAULT, claimedAmount: '50,000' }), /without commas or exponents/);
  assert.throws(() => modelInsuranceClaim({ ...DEFAULT, deductibleAmount: '1e3' }), /without commas or exponents/);
});

test('defaults: an unstated claim is no claim — nothing is paid, nothing is borne, and every share is 0.00', () => {
  const r = modelInsuranceClaim({ coverageLimit: '25000', decimals: 6 });
  assert.equal(r.noClaim, true);
  assert.equal(r.claimedAmount, 0n);
  assert.equal(r.payout, 0n);
  assert.equal(r.borneByClaimant, 0n);
  assert.equal(r.payoutShareBpsText, '0.00');
});

test('the payout never exceeds the coverage limit and never exceeds what remains after the deductible, across claims from zero to twice the limit', () => {
  for (const claimed of ['0', '500', '1000', '25000', '26000', '50000', '100000']) {
    const r = modelInsuranceClaim({ claimedAmount: claimed, decimals: 0, deductibleAmount: '1000', coverageLimit: '25000' });
    assert.ok(r.payout <= 25000n);
    assert.ok(r.payout <= r.claimAfterDeductible);
    assert.ok(r.deductibleBorne <= r.claimedAmount);
    assert.ok(r.borneByClaimant <= r.claimedAmount);
  }
});

test('the deductible is applied before the limit, never after: a 26000 claim with a 1000 deductible against a 25000 limit pays 25000, not 24000 — measuring the claim against the limit first would take the deductible out of the capped payout twice over in effect', () => {
  const r = modelInsuranceClaim({ claimedAmount: '26000', decimals: 6, deductibleAmount: '1000', coverageLimit: '25000' });
  assert.equal(r.payout, 25000000000n);
  assert.notEqual(r.payout, 24000000000n);
});

test('a claim of exactly the coverage limit with no deductible pays the whole claim', () => {
  const r = modelInsuranceClaim({ claimedAmount: '25000', decimals: 6, deductibleAmount: '0', coverageLimit: '25000' });
  assert.equal(r.payout, 25000000000n);
  assert.equal(r.borneByClaimant, 0n);
  assert.equal(r.payoutShareBpsText, '10000.00');
});

test('a one-base-unit claim above a one-base-unit deductible against a one-base-unit limit pays exactly one base unit', () => {
  const r = modelInsuranceClaim({ claimedAmount: '2', decimals: 0, deductibleAmount: '1', coverageLimit: '1' });
  assert.equal(r.claimAfterDeductible, 1n);
  assert.equal(r.payout, 1n);
  assert.equal(r.borneByClaimant, 1n);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { modelReinsuranceCession } from '../src/domain.js';

const DEFAULT = { grossPremium: '1000000', claimsAmount: '400000', cessionBps: 3000, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, cessionBps: 0 },
  { ...DEFAULT, cessionBps: 10000 },
  { ...DEFAULT, claimsAmount: '0' },
  { grossPremium: '333333.333333', claimsAmount: '111111.111111', cessionBps: 3333, decimals: 6 },
  { grossPremium: '1', claimsAmount: '1', cessionBps: 1, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { grossPremium: '2', claimsAmount: '3', cessionBps: 5000, decimals: 6 },
  { grossPremium: '0.001', claimsAmount: '0.001', cessionBps: 9999, decimals: 6 },
  { ...DEFAULT, cessionBps: 1 },
];

test('preload: a gross premium of 1000000 with claims of 400000 at a cession of 3000 basis points states a ceded premium of 300000, a retained premium of 700000, a recovery of 120000, and retained claims of 280000', () => {
  const r = modelReinsuranceCession(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.grossPremium, 1000000000000n);
  assert.equal(r.claimsAmount, 400000000000n);
  assert.equal(r.cessionBps, 3000);
  assert.equal(r.cededPremium, 300000000000n);
  assert.equal(r.retainedPremium, 700000000000n);
  assert.equal(r.claimsRecovered, 120000000000n);
  assert.equal(r.retainedClaims, 280000000000n);
});

test('one stated share applies to both sides: the same cession rate measures the premium ceded and the claims recovered', () => {
  const r = modelReinsuranceCession(DEFAULT);
  assert.equal(r.sameShareBothSides, true);
  assert.equal(r.cededPremium, r.grossPremium * 3000n / 10000n);
  assert.equal(r.claimsRecovered, r.claimsAmount * 3000n / 10000n);
});

test('the premium is conserved on every stated case: the ceded part plus the retained part is the gross premium exactly', () => {
  for (const input of CASES) {
    const r = modelReinsuranceCession(input);
    assert.equal(r.premiumConserved, true);
    assert.equal(r.cededPremium + r.retainedPremium, r.grossPremium);
  }
});

test('the claims are conserved on every stated case: the recovered part plus the retained part is the claims stated exactly', () => {
  for (const input of CASES) {
    const r = modelReinsuranceCession(input);
    assert.equal(r.claimsConserved, true);
    assert.equal(r.claimsRecovered + r.retainedClaims, r.claimsAmount);
  }
});

test('the recovery is measured on the claims actually stated, never on the premium, and never exceeds the claims', () => {
  const r = modelReinsuranceCession(DEFAULT);
  assert.equal(r.recoveryOnClaimsOnly, true);
  assert.equal(r.claimsRecovered, 120000000000n);
  assert.notEqual(r.claimsRecovered, r.grossPremium * 3000n / 10000n);
  for (const input of CASES) {
    const rr = modelReinsuranceCession(input);
    assert.ok(rr.claimsRecovered <= rr.claimsAmount);
    assert.ok(rr.retainedClaims >= 0n);
    assert.ok(rr.retainedPremium >= 0n);
  }
});

test('the ceded premium is not a fee and the recovery is not a fee, and the non-proportional treaty, commission, reinstatement, reinsurer default, and term are not priced', () => {
  const r = modelReinsuranceCession(DEFAULT);
  assert.equal(r.cededPremiumIsFee, false);
  assert.equal(r.recoveryIsFee, false);
  assert.equal(r.nonProportionalPriced, false);
  assert.equal(r.commissionPriced, false);
  assert.equal(r.reinstatementPriced, false);
  assert.equal(r.reinsurerDefaultPriced, false);
  assert.equal(r.termPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a cession of zero is stated, not refused: the insurer retains the whole premium and bears the whole claims', () => {
  const r = modelReinsuranceCession({ ...DEFAULT, cessionBps: 0 });
  assert.equal(r.cededPremium, 0n);
  assert.equal(r.retainedPremium, 1000000000000n);
  assert.equal(r.claimsRecovered, 0n);
  assert.equal(r.retainedClaims, 400000000000n);
});

test('a cession of the whole share is stated: the reinsurer takes the whole premium and bears the whole claims stated', () => {
  const r = modelReinsuranceCession({ ...DEFAULT, cessionBps: 10000 });
  assert.equal(r.cededPremium, 1000000000000n);
  assert.equal(r.retainedPremium, 0n);
  assert.equal(r.claimsRecovered, 400000000000n);
  assert.equal(r.retainedClaims, 0n);
});

test('claims of zero are stated, not refused: nothing is recovered and nothing is retained on the claims side, while the premium still cedes at the stated share', () => {
  const r = modelReinsuranceCession({ ...DEFAULT, claimsAmount: '0' });
  assert.equal(r.claimsRecovered, 0n);
  assert.equal(r.retainedClaims, 0n);
  assert.equal(r.cededPremium, 300000000000n);
});

test('flooring is exact on fractional amounts: each ceded part floors and each retained part is the exact remainder, so both conservations stay exact', () => {
  const r = modelReinsuranceCession({ grossPremium: '333333.333333', claimsAmount: '111111.111111', cessionBps: 3333, decimals: 6 });
  assert.equal(r.cededPremium, 111099999999n);
  assert.equal(r.retainedPremium, 222233333334n);
  assert.equal(r.claimsRecovered, 37033333333n);
  assert.equal(r.retainedClaims, 74077777778n);
});

test('on a premium of 1 and claims of 1 at 1 basis point each ceded part is exactly 100 base units', () => {
  const r = modelReinsuranceCession({ grossPremium: '1', claimsAmount: '1', cessionBps: 1, decimals: 6 });
  assert.equal(r.cededPremium, 100n);
  assert.equal(r.claimsRecovered, 100n);
  assert.equal(r.retainedPremium, 999900n);
  assert.equal(r.retainedClaims, 999900n);
});

test('on tiny amounts at 9999 basis points the retained parts floor to a single base unit each and are stated, not hidden', () => {
  const r = modelReinsuranceCession({ grossPremium: '0.001', claimsAmount: '0.001', cessionBps: 9999, decimals: 6 });
  assert.equal(r.cededPremium, 999n);
  assert.equal(r.retainedPremium, 1n);
  assert.equal(r.claimsRecovered, 999n);
  assert.equal(r.retainedClaims, 1n);
});

test('a gross premium of zero is refused', () => {
  assert.throws(() => modelReinsuranceCession({ ...DEFAULT, grossPremium: '0' }), /Gross premium must be greater than zero/);
});

test('a cession rate above 10000 basis points is refused', () => {
  assert.throws(() => modelReinsuranceCession({ ...DEFAULT, cessionBps: 10001 }), /Cession rate must be a whole number of basis points/);
});

test('a cession rate that is negative or not a whole number is refused', () => {
  assert.throws(() => modelReinsuranceCession({ ...DEFAULT, cessionBps: -1 }), /Cession rate must be a whole number of basis points/);
  assert.throws(() => modelReinsuranceCession({ ...DEFAULT, cessionBps: 12.5 }), /Cession rate must be a whole number of basis points/);
});

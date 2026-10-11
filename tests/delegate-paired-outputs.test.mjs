import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDelegatePairedOutputs } from '../src/domain.js';

// Delegate paired outputs: the per-pair and aggregate output checks
// the delegate pairing planner states it does not judge — same
// address, same datum, other policies identical, the acted-on policy
// changed (third-party) or stripped entirely (unfracking), and the
// third-party balance invariant (spec: ThirdPartyAct / UnfrackingAct
// constructors and delegate validation step 4, re-read 2026-10-10).
const POLICY = 'cc'.repeat(28);
const OTHER = 'dd'.repeat(28);
const NAME = '746f6b656e'; // "token"
const COIN = '636f696e'; // "coin"

const utxo = (patch = {}) => ({
  address: 'addr_test1smartwalletalice',
  datum: 'abcd',
  referenceScript: false,
  assets: [
    { policy: POLICY, name: NAME, quantity: '100' },
    { policy: OTHER, name: COIN, quantity: '5' },
  ],
  ...patch,
});

// The pair strips the acted-on policy into its own base output (the
// otherBaseOutputs list) and leaves everything else untouched: this
// one fixture conforms as an unfracking, and — because the policy
// changed in the pair and the invariant still balances — as a
// third-party action too.
const conformingClaim = (action = 'unfracking') => ({
  action,
  policy: POLICY,
  pairs: [{ input: utxo(), output: utxo({ assets: [{ policy: OTHER, name: COIN, quantity: '5' }] }) }],
  otherBaseOutputs: [{ policy: POLICY, name: NAME, quantity: '100' }],
  mint: [],
});

test('a conforming unfracking passes every position, reference script included', () => {
  const v = checkDelegatePairedOutputs(conformingClaim());
  assert.equal(v.status, 'conforming');
  assert.equal(v.valid, true);
  assert.deepEqual(v.verdicts, {
    address: true, datum: true, otherAssets: true,
    referenceScript: true, policyPosition: true, balanceInvariant: null,
  });
  assert.equal(v.pairs[0].policyPresentInInput, true);
  assert.equal(v.pairs[0].policyAbsentFromOutput, true);
  assert.deepEqual(v.totals, []);
});

test('the same fixture conforms as a third-party action — policy changed, invariant balanced by the other base output', () => {
  const v = checkDelegatePairedOutputs(conformingClaim('third-party'));
  assert.equal(v.valid, true);
  assert.equal(v.verdicts.referenceScript, null);
  assert.equal(v.verdicts.balanceInvariant, true);
  assert.equal(v.totals.length, 1);
  assert.equal(v.totals[0].inputQuantity, '100');
  assert.equal(v.totals[0].expectedQuantity, '100');
  assert.equal(v.totals[0].pairedOutputQuantity, '0');
  assert.equal(v.totals[0].otherOutputQuantity, '100');
  assert.equal(v.totals[0].outputQuantity, '100');
});

test('a partial seizure inside the pair conforms for third-party when the seized part stays at a base output', () => {
  const claim = conformingClaim('third-party');
  claim.pairs[0].output = utxo({ assets: [
    { policy: POLICY, name: NAME, quantity: '60' },
    { policy: OTHER, name: COIN, quantity: '5' },
  ] });
  claim.otherBaseOutputs = [{ policy: POLICY, name: NAME, quantity: '40' }];
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, true);
  assert.equal(v.pairs[0].policyChanged, true);
});

test('a changed address fails only the address position', () => {
  const claim = conformingClaim();
  claim.pairs[0].output = utxo({ address: 'addr_test1someoneelse', assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.address, false);
  assert.equal(v.verdicts.datum, true);
  assert.equal(v.verdicts.otherAssets, true);
  assert.equal(v.verdicts.policyPosition, true);
});

test('a changed datum fails only the datum position', () => {
  const claim = conformingClaim();
  claim.pairs[0].output = utxo({ datum: '1234', assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.datum, false);
  assert.equal(v.verdicts.address, true);
});

test('a moved other-policy asset fails only the other-assets position', () => {
  const claim = conformingClaim();
  claim.pairs[0].output = utxo({ assets: [{ policy: OTHER, name: COIN, quantity: '4' }] });
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.otherAssets, false);
  assert.equal(v.verdicts.policyPosition, true);
});

test('a reference-script difference fails an unfracking but earns no verdict for a third-party action', () => {
  const unfr = conformingClaim();
  unfr.pairs[0].output = utxo({ referenceScript: true, assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const vu = checkDelegatePairedOutputs(unfr);
  assert.equal(vu.verdicts.referenceScript, false);
  assert.equal(vu.valid, false);
  const tp = conformingClaim('third-party');
  tp.pairs[0].output = utxo({ referenceScript: true, assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const vt = checkDelegatePairedOutputs(tp);
  assert.equal(vt.pairs[0].referenceScriptSame, false);
  assert.equal(vt.verdicts.referenceScript, null);
  assert.equal(vt.valid, true);
});

test('a third-party pair whose policy tokens stand still fails the change position — the no-op DoS shape', () => {
  const claim = conformingClaim('third-party');
  claim.pairs[0].output = utxo();
  claim.otherBaseOutputs = [];
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.policyPosition, false);
  assert.equal(v.pairs[0].policyChanged, false);
  assert.equal(v.verdicts.balanceInvariant, true);
});

test('an unfracking that leaves part of the policy in the continuing output fails the strip position', () => {
  const claim = conformingClaim();
  claim.pairs[0].output = utxo({ assets: [
    { policy: POLICY, name: NAME, quantity: '30' },
    { policy: OTHER, name: COIN, quantity: '5' },
  ] });
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.policyPosition, false);
  assert.equal(v.pairs[0].policyAbsentFromOutput, false);
});

test('an unfracking whose input holds none of the policy fails the strip position', () => {
  const claim = conformingClaim();
  claim.pairs[0].input = utxo({ assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.pairs[0].policyPresentInInput, false);
  assert.equal(v.verdicts.policyPosition, false);
});

test('value that leaves the base system fails the balance invariant and names the shortfall', () => {
  const claim = conformingClaim('third-party');
  claim.otherBaseOutputs = [{ policy: POLICY, name: NAME, quantity: '70' }];
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.balanceInvariant, false);
  assert.equal(v.totals[0].outputQuantity, '70');
  assert.equal(v.totals[0].expectedQuantity, '100');
  assert.equal(v.totals[0].meetsInvariant, false);
});

test('a mint raises the invariant floor and a burn lowers it — the wipe shape', () => {
  const mintClaim = conformingClaim('third-party');
  mintClaim.mint = [{ policy: POLICY, name: NAME, quantity: '25' }];
  const vm = checkDelegatePairedOutputs(mintClaim);
  assert.equal(vm.totals[0].expectedQuantity, '125');
  assert.equal(vm.verdicts.balanceInvariant, false);
  const burnClaim = conformingClaim('third-party');
  burnClaim.mint = [{ policy: POLICY, name: NAME, quantity: '-100' }];
  burnClaim.otherBaseOutputs = [];
  const vb = checkDelegatePairedOutputs(burnClaim);
  assert.equal(vb.totals[0].expectedQuantity, '0');
  assert.equal(vb.valid, true);
});

test('a burn larger than the modeled input is named impossible and fails the invariant', () => {
  const claim = conformingClaim('third-party');
  claim.mint = [{ policy: POLICY, name: NAME, quantity: '-150' }];
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.balanceInvariant, false);
  assert.deepEqual(v.impossible, [{ assetName: NAME, expectedQuantity: '-50' }]);
});

test('mint entries under other policies are excluded, never judged', () => {
  const claim = conformingClaim('third-party');
  claim.mint = [{ policy: OTHER, name: COIN, quantity: '7' }];
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.valid, true);
  assert.equal(v.excludedMintCount, 1);
  assert.equal(v.totals.length, 1);
});

test('hex case in the policy and asset names is canonicalised, not a difference', () => {
  const claim = conformingClaim();
  claim.policy = POLICY.toUpperCase();
  claim.pairs[0].input = utxo({ assets: [
    { policy: POLICY.toUpperCase(), name: NAME.toUpperCase(), quantity: '100' },
    { policy: OTHER, name: COIN, quantity: '5' },
  ] });
  const v = checkDelegatePairedOutputs(claim);
  assert.equal(v.policy, POLICY);
  assert.equal(v.valid, true);
});

test('unreadable claims are refused, never scored in part', () => {
  const dup = conformingClaim();
  dup.pairs[0].input = utxo({ assets: [
    { policy: POLICY, name: NAME, quantity: '60' },
    { policy: POLICY, name: NAME, quantity: '40' },
  ] });
  assert.throws(() => checkDelegatePairedOutputs(dup), /twice/);
  const numeric = conformingClaim();
  numeric.pairs[0].input = utxo({ assets: [{ policy: POLICY, name: NAME, quantity: 100 }] });
  assert.throws(() => checkDelegatePairedOutputs(numeric), /decimal string/);
  const noFlag = conformingClaim();
  noFlag.pairs[0].output = utxo({ referenceScript: 'no', assets: [] });
  assert.throws(() => checkDelegatePairedOutputs(noFlag), /boolean/);
  const empty = conformingClaim();
  empty.pairs = [];
  assert.throws(() => checkDelegatePairedOutputs(empty), /non-empty/);
  const unknown = conformingClaim();
  unknown.extra = true;
  assert.throws(() => checkDelegatePairedOutputs(unknown), /unknown field/);
  const missing = conformingClaim();
  delete missing.mint;
  assert.throws(() => checkDelegatePairedOutputs(missing), /missing/);
  const badAction = conformingClaim('transfer');
  assert.throws(() => checkDelegatePairedOutputs(badAction), /third-party or unfracking/);
});

test('the checker does not mutate the claim it judges', () => {
  const claim = conformingClaim('third-party');
  const snapshot = JSON.stringify(claim);
  checkDelegatePairedOutputs(claim);
  assert.equal(JSON.stringify(claim), snapshot);
});

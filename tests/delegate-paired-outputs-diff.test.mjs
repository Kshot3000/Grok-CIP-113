import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkDelegatePairedOutputs, diffDelegatePairedOutputs, DELEGATE_PAIRED_OUTPUTS_COMPARE_FIELDS } from '../src/domain.js';

// Delegate paired-outputs impact (spec: ThirdPartyAct /
// UnfrackingAct and delegate validation step 4, re-read 2026-10-11):
// a paired-output claim that conformed when modeled can be staled
// by assembly rebuilding an output, by value moving out of the base
// system, or by a mint/burn adjustment — and by the invariant floor
// itself moving while every verdict stands. Both versions are
// checked through checkDelegatePairedOutputs itself, and eight
// positions are compared: the status, the address, datum,
// other-assets, reference-script, and policy-position verdicts, the
// balance-invariant verdict, and the invariant expectation (the
// checker's totals as floors; null for unfracking on both sides).
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

// The pair strips the acted-on policy into the other base outputs:
// conforming for both actions, as in the checker suite.
const conformingClaim = (action = 'third-party') => ({
  action,
  policy: POLICY,
  pairs: [{ input: utxo(), output: utxo({ assets: [{ policy: OTHER, name: COIN, quantity: '5' }] }) }],
  otherBaseOutputs: [{ policy: POLICY, name: NAME, quantity: '100' }],
  mint: [],
});

test('an unchanged claim compares as unchanged on all eight positions', () => {
  const d = diffDelegatePairedOutputs(conformingClaim(), conformingClaim());
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.equal(d.action, 'third-party');
  assert.equal(d.policy, POLICY);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 8);
  assert.deepEqual(d.changedPairIndices, []);
  assert.equal(d.addedPairCount, 0);
  assert.equal(d.removedPairCount, 0);
  assert.deepEqual(d.totalsChanges, []);
  assert.equal(d.excludedMintCountChanged, false);
  assert.deepEqual([...DELEGATE_PAIRED_OUTPUTS_COMPARE_FIELDS].map(f => f[0]), ['status', 'address', 'datum', 'otherAssets', 'referenceScript', 'policyPosition', 'balanceInvariant', 'invariantExpectation']);
});

test('rebuilding the continuing output at a different address makes the claim BECAME NOT CONFORMING, on the status and address positions', () => {
  const after = conformingClaim();
  after.pairs[0].output = utxo({ address: 'addr_test1someoneelse', assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const d = diffDelegatePairedOutputs(conformingClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Address']);
  assert.deepEqual(d.changedPairIndices, [0]);
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, false);
});

test('restoring the rebuilt output’s address makes the claim BECAME CONFORMING', () => {
  const before = conformingClaim();
  before.pairs[0].output = utxo({ address: 'addr_test1someoneelse', assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const d = diffDelegatePairedOutputs(before, conformingClaim());
  assert.equal(d.change, 'became-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Address']);
});

test('a mint of 25 met by raising the other base output to 125 is REQUIREMENT CHANGED on the invariant-expectation position alone, with the totals breakdown reported', () => {
  const after = conformingClaim();
  after.mint = [{ policy: POLICY, name: NAME, quantity: '25' }];
  after.otherBaseOutputs = [{ policy: POLICY, name: NAME, quantity: '125' }];
  const d = diffDelegatePairedOutputs(conformingClaim(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Invariant expectation']);
  assert.deepEqual(d.differences[0].before, [{ assetName: NAME, expectedQuantity: '100' }]);
  assert.deepEqual(d.differences[0].after, [{ assetName: NAME, expectedQuantity: '125' }]);
  assert.deepEqual(d.totalsChanges, [{
    assetName: NAME,
    beforeExpectedQuantity: '100', afterExpectedQuantity: '125',
    beforeOutputQuantity: '100', afterOutputQuantity: '125',
    beforeMintQuantity: '0', afterMintQuantity: '25',
  }]);
  assert.deepEqual(d.changedPairIndices, []);
});

test('a mint raised without the outputs following is BECAME NOT CONFORMING — the conformance story takes precedence over the expectation’s move', () => {
  const after = conformingClaim();
  after.mint = [{ policy: POLICY, name: NAME, quantity: '25' }];
  const d = diffDelegatePairedOutputs(conformingClaim(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Balance invariant', 'Invariant expectation']);
  assert.equal(d.after.verdicts.balanceInvariant, false);
});

test('a claim not conforming on both sides whose failing position changed underneath it is STILL NOT CONFORMING', () => {
  const before = conformingClaim();
  before.pairs[0].output = utxo({ address: 'addr_test1someoneelse', assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const after = conformingClaim();
  after.pairs[0].output = utxo({ datum: '1234', assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const d = diffDelegatePairedOutputs(before, after);
  assert.equal(d.change, 'still-not-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, false);
  assert.deepEqual(d.changedFields, ['Address', 'Datum']);
  assert.equal(d.before.verdicts.address, false);
  assert.equal(d.before.verdicts.datum, true);
  assert.equal(d.after.verdicts.address, true);
  assert.equal(d.after.verdicts.datum, false);
});

test('an unfracking whose continuing output gains a reference script is BECAME NOT CONFORMING on the reference-script position', () => {
  const after = conformingClaim('unfracking');
  after.pairs[0].output = utxo({ referenceScript: true, assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const d = diffDelegatePairedOutputs(conformingClaim('unfracking'), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Reference script']);
  assert.equal(d.before.verdicts.referenceScript, true);
  assert.equal(d.after.verdicts.referenceScript, false);
});

test('an unfracking quantity change compares unchanged on positions — its expectation is null on both sides — while the changed pair is reported, never counted', () => {
  const after = conformingClaim('unfracking');
  after.pairs[0].input = utxo({ assets: [
    { policy: POLICY, name: NAME, quantity: '80' },
    { policy: OTHER, name: COIN, quantity: '5' },
  ] });
  after.otherBaseOutputs = [{ policy: POLICY, name: NAME, quantity: '80' }];
  const d = diffDelegatePairedOutputs(conformingClaim('unfracking'), after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedPairIndices, [0]);
  assert.deepEqual(d.totalsChanges, []);
  assert.deepEqual(d.before.totals, []);
  assert.deepEqual(d.after.totals, []);
});

test('a third-party reference-script change is reported via the changed pair, never counted: the verdict is null on both sides (pinned)', () => {
  const after = conformingClaim();
  after.pairs[0].output = utxo({ referenceScript: true, assets: [{ policy: OTHER, name: COIN, quantity: '5' }] });
  const d = diffDelegatePairedOutputs(conformingClaim(), after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.equal(d.changedCount, 0);
  assert.deepEqual(d.changedPairIndices, [0]);
  assert.equal(d.before.verdicts.referenceScript, null);
  assert.equal(d.after.verdicts.referenceScript, null);
});

test('pair-list growth and an excluded mint are reported, never counted', () => {
  const after = conformingClaim('unfracking');
  after.pairs.push({
    input: utxo({ address: 'addr_test1smartwalletbob', assets: [
      { policy: POLICY, name: NAME, quantity: '50' },
      { policy: OTHER, name: COIN, quantity: '5' },
    ] }),
    output: utxo({ address: 'addr_test1smartwalletbob', assets: [{ policy: OTHER, name: COIN, quantity: '5' }] }),
  });
  const d = diffDelegatePairedOutputs(conformingClaim('unfracking'), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.equal(d.addedPairCount, 1);
  assert.equal(d.removedPairCount, 0);
  const back = diffDelegatePairedOutputs(after, conformingClaim('unfracking'));
  assert.equal(back.addedPairCount, 0);
  assert.equal(back.removedPairCount, 1);
  const mintAfter = conformingClaim();
  mintAfter.mint = [{ policy: OTHER, name: COIN, quantity: '7' }];
  const dm = diffDelegatePairedOutputs(conformingClaim(), mintAfter);
  assert.equal(dm.change, 'unchanged');
  assert.deepEqual(dm.differences, []);
  assert.equal(dm.excludedMintCountChanged, true);
  assert.deepEqual(dm.totalsChanges, []);
});

test('hex case alone is the same claim: uppercase policy, names, and datum in the after version compare as unchanged', () => {
  const after = conformingClaim();
  after.policy = POLICY.toUpperCase();
  after.pairs[0].input = utxo({ datum: 'ABCD', assets: [
    { policy: POLICY.toUpperCase(), name: NAME.toUpperCase(), quantity: '100' },
    { policy: OTHER.toUpperCase(), name: COIN.toUpperCase(), quantity: '5' },
  ] });
  after.pairs[0].output = utxo({ datum: 'ABCD', assets: [{ policy: OTHER.toUpperCase(), name: COIN.toUpperCase(), quantity: '5' }] });
  after.otherBaseOutputs = [{ policy: POLICY.toUpperCase(), name: NAME.toUpperCase(), quantity: '100' }];
  const d = diffDelegatePairedOutputs(conformingClaim(), after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.policy, POLICY);
  assert.deepEqual(d.changedPairIndices, []);
});

test('refusal discipline: different actions are refused, never compared', () => {
  assert.throws(() => diffDelegatePairedOutputs(conformingClaim('third-party'), conformingClaim('unfracking')), /declare different actions/);
});

test('refusal discipline: different acted-on policies are refused, never compared', () => {
  const after = conformingClaim();
  after.policy = 'ee'.repeat(28);
  assert.throws(() => diffDelegatePairedOutputs(conformingClaim(), after), /declare different acted-on policies/);
});

test('refusal discipline: a version that cannot be read is refused on either side with the checker’s reason, never compared around', () => {
  const dup = conformingClaim();
  dup.pairs[0].input = utxo({ assets: [
    { policy: POLICY, name: NAME, quantity: '60' },
    { policy: POLICY, name: NAME, quantity: '40' },
  ] });
  assert.throws(() => diffDelegatePairedOutputs(conformingClaim(), dup), /twice/);
  const empty = conformingClaim();
  empty.pairs = [];
  assert.throws(() => diffDelegatePairedOutputs(empty, conformingClaim()), /non-empty/);
  assert.throws(() => diffDelegatePairedOutputs(conformingClaim(), { ...conformingClaim(), extra: 1 }), /unknown field/);
});

test('the comparison does not mutate either claim, and its two sides are the checker’s own verdicts', () => {
  const before = conformingClaim();
  const after = conformingClaim();
  after.mint = [{ policy: POLICY, name: NAME, quantity: '25' }];
  const bSnap = JSON.parse(JSON.stringify(before));
  const aSnap = JSON.parse(JSON.stringify(after));
  const d = diffDelegatePairedOutputs(before, after);
  assert.deepEqual(before, bSnap);
  assert.deepEqual(after, aSnap);
  assert.deepEqual(d.before, checkDelegatePairedOutputs(bSnap));
  assert.deepEqual(d.after, checkDelegatePairedOutputs(aSnap));
});

test('app wires the delegate paired-outputs impact comparison: panel, verdicts, honest boundary, v1.236', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffDelegatePairedOutputs/);
  assert.match(app, /paired-outputs-diff-after-pairs/);
  assert.match(app, /paired-outputs-diff-after-mint/);
  assert.match(app, /DELEGATE PAIRED-OUTPUTS IMPACT · LOCAL MODEL/);
  assert.match(app, /BECAME NOT CONFORMING/);
  assert.match(app, /REQUIREMENT CHANGED/);
  assert.match(app, /v1\.236/);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Delegate paired-outputs impact/);
});

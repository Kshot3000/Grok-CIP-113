import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planTransferOutputValue, diffTransferOutputValue, TRANSFER_VALUE_COMPARE_FIELDS, MAX_ASSET } from '../src/domain.js';

// Transfer output-value comparison — the comparison counterpart to the
// calculator/verifier pair. Planning says what a modeled transfer
// expects at base; comparing says how that expectation changes when
// the transfer itself changes first. Both sides are planned by
// planTransferOutputValue itself, so compare and plan can never
// disagree. One position per validated asset only — its expected
// quantity, the number the delegate checks outputs against: the input
// and mint quantities are that sum's components, so a cancelling
// composition change is reported separately (compositionChanged) and
// never counted, and the excluded ordinary tokens carry no expectation
// at all, so their change is reported separately too.
const A = 'aa'.repeat(28);
const B = 'bb'.repeat(28);
const C = 'cc'.repeat(28); // never validated in the base model
const D = 'dd'.repeat(28);
const N1 = '01';
const N2 = '02';
const e = (policy, assetName, quantity) => ({ policy, assetName, quantity });
const base = (over = {}) => ({
  validatedPolicies: [A, B],
  inputs: [e(A, N1, '100'), e(B, N1, '40'), e(C, N1, '999')],
  mint: [e(A, N1, '-30')],
  ...over,
});
const asset = (r, policy, name = N1) => r.perAsset.find(x => x.policy === policy && x.assetName === name);

test('the same modeled transfer on both sides compares as unchanged for every asset', () => {
  const r = diffTransferOutputValue(base(), base());
  assert.equal(r.change, 'unchanged');
  assert.equal(r.unchanged, true);
  assert.equal(r.changedCount, 0);
  assert.equal(r.unchangedCount, 2);
  assert.deepEqual(r.changedFields, []);
  assert.equal(r.excludedChanged, false);
  assert.equal(r.compositionChanged, false);
  assert.deepEqual(r.addedValidatedPolicies, []);
  assert.deepEqual(r.removedValidatedPolicies, []);
  assert.equal(TRANSFER_VALUE_COMPARE_FIELDS.length, 1);
});

test('comparison returns exactly its nineteen keys, and each per-asset entry exactly seven', () => {
  const r = diffTransferOutputValue(base(), base({ mint: [e(A, N1, '-10')] }));
  assert.deepEqual(Object.keys(r).sort(), ['addedExcluded', 'addedValidatedPolicies', 'after', 'before', 'change', 'changedCount', 'changedExcluded', 'changedFields', 'compositionChanged', 'excludedChanged', 'newlyExpectedCount', 'newlyValidatedCount', 'noLongerExpectedCount', 'noLongerValidatedCount', 'perAsset', 'removedExcluded', 'removedValidatedPolicies', 'unchanged', 'unchangedCount'].sort());
  assert.equal(Object.keys(r).length, 19);
  for (const p of r.perAsset) assert.deepEqual(Object.keys(p).sort(), ['after', 'assetName', 'before', 'change', 'changedFields', 'compositionChanged', 'policy']);
});

test('both sides are the planner returns planTransferOutputValue itself produces', () => {
  const afterIn = base({ mint: [e(A, N1, '-10')] });
  const r = diffTransferOutputValue(base(), afterIn);
  assert.deepEqual(r.before, planTransferOutputValue(base()));
  assert.deepEqual(r.after, planTransferOutputValue(afterIn));
});

test('an input rise moves the expected quantity once — the components are not counted again', () => {
  const r = diffTransferOutputValue(base(), base({ inputs: [e(A, N1, '110'), e(B, N1, '40'), e(C, N1, '999')] }));
  assert.equal(r.change, 'expectations-changed');
  assert.equal(r.changedCount, 1);
  const a = asset(r, A);
  assert.equal(a.change, 'expected-changed');
  assert.deepEqual(a.changedFields, ['expected quantity']);
  assert.equal(a.before.expectedQuantity, '70');
  assert.equal(a.after.expectedQuantity, '80');
  // The composition did change (input 100 -> 110) and is reported,
  // but it is not a second difference beside the expectation it moved.
  assert.equal(a.compositionChanged, true);
  assert.equal(asset(r, B).change, 'unchanged');
});

test('a mint change alone moves the expected quantity for that asset alone', () => {
  const r = diffTransferOutputValue(base(), base({ mint: [e(A, N1, '50')] }));
  assert.equal(asset(r, A).after.expectedQuantity, '150');
  assert.equal(asset(r, A).change, 'expected-changed');
  assert.equal(asset(r, B).change, 'unchanged');
  assert.equal(r.changedCount, 1);
});

test('a cancelling composition change leaves the expectation — and the comparison — unchanged', () => {
  // Input up 10, burn up 10: the components both moved, their sum did
  // not, so every output built against the earlier expectation still
  // meets the delegate's floor exactly. Reported, never counted.
  const r = diffTransferOutputValue(base(), base({
    inputs: [e(A, N1, '110'), e(B, N1, '40'), e(C, N1, '999')],
    mint: [e(A, N1, '-40')],
  }));
  assert.equal(r.change, 'unchanged');
  assert.equal(r.unchanged, true);
  assert.equal(r.changedCount, 0);
  const a = asset(r, A);
  assert.equal(a.change, 'unchanged');
  assert.equal(a.compositionChanged, true);
  assert.equal(r.compositionChanged, true);
  assert.equal(a.after.expectedQuantity, '70');
});

test('a burn that grows past the validated input makes that asset — and the transfer — unplannable', () => {
  const r = diffTransferOutputValue(base(), base({ mint: [e(A, N1, '-150')] }));
  assert.equal(r.change, 'became-unplannable');
  const a = asset(r, A);
  assert.equal(a.change, 'became-unplannable');
  assert.equal(a.after.expectedQuantity, '-50');
  assert.deepEqual(r.after.missing, ['burn-exceeds-input']);
  assert.equal(asset(r, B).change, 'unchanged');
});

test('repairing an excessive burn is became-plannable, the mirror of breaking it', () => {
  const r = diffTransferOutputValue(base({ mint: [e(A, N1, '-150')] }), base());
  assert.equal(r.change, 'became-plannable');
  assert.equal(asset(r, A).change, 'became-plannable');
});

test('two negative expectations of different sizes are still-unplannable, per asset and overall', () => {
  const r = diffTransferOutputValue(base({ mint: [e(A, N1, '-150')] }), base({ mint: [e(A, N1, '-160')] }));
  assert.equal(r.change, 'still-unplannable');
  assert.equal(asset(r, A).change, 'still-unplannable');
  assert.equal(asset(r, A).before.expectedQuantity, '-50');
  assert.equal(asset(r, A).after.expectedQuantity, '-60');
});

test('a validated asset appearing in the transfer is newly-expected, and leaving it is no-longer-expected', () => {
  const added = diffTransferOutputValue(base(), base({ inputs: [e(A, N1, '100'), e(B, N1, '40'), e(C, N1, '999'), e(B, N2, '5')] }));
  const bn2 = asset(added, B, N2);
  assert.equal(bn2.change, 'newly-expected');
  assert.equal(bn2.before, null);
  assert.equal(bn2.after.expectedQuantity, '5');
  assert.equal(added.newlyExpectedCount, 1);
  const removed = diffTransferOutputValue(base({ inputs: [e(A, N1, '100'), e(B, N1, '40'), e(C, N1, '999'), e(B, N2, '5')] }), base());
  assert.equal(asset(removed, B, N2).change, 'no-longer-expected');
  assert.equal(asset(removed, B, N2).after, null);
  assert.equal(removed.noLongerExpectedCount, 1);
});

test("a policy gaining its registry proof moves its asset from excluded to expected — newly-validated", () => {
  const r = diffTransferOutputValue(base(), base({ validatedPolicies: [A, B, C] }));
  const c = asset(r, C);
  assert.equal(c.change, 'newly-validated');
  assert.equal(c.before, null);
  assert.equal(c.after.expectedQuantity, '999');
  assert.equal(r.newlyValidatedCount, 1);
  assert.deepEqual(r.addedValidatedPolicies, [C]);
  // Its amount left the excluded list — reported there too, not counted again.
  assert.deepEqual(r.removedExcluded.map(x => x.policy), [C]);
  assert.equal(r.changedCount, 1);
});

test('a policy losing its registry proof moves its asset back to excluded — no-longer-validated', () => {
  const r = diffTransferOutputValue(base({ validatedPolicies: [A, B, C] }), base());
  const c = asset(r, C);
  assert.equal(c.change, 'no-longer-validated');
  assert.equal(c.after, null);
  assert.equal(r.noLongerValidatedCount, 1);
  assert.deepEqual(r.removedValidatedPolicies, [C]);
  assert.deepEqual(r.addedExcluded.map(x => x.policy), [C]);
});

test('an excluded asset changing amount alone moves no expectation — reported separately, never counted', () => {
  const r = diffTransferOutputValue(base(), base({ inputs: [e(A, N1, '100'), e(B, N1, '40'), e(C, N1, '500')] }));
  assert.equal(r.change, 'unchanged');
  assert.equal(r.changedCount, 0);
  assert.equal(r.excludedChanged, true);
  assert.equal(r.changedExcluded.length, 1);
  assert.equal(r.changedExcluded[0].before.inputQuantity, '999');
  assert.equal(r.changedExcluded[0].after.inputQuantity, '500');
  // The excluded policy's asset never appears in the per-asset comparison.
  assert.equal(asset(r, C), undefined);
});

test('validating a policy that holds no value in the model moves no expectation by itself', () => {
  const r = diffTransferOutputValue(base(), base({ validatedPolicies: [A, B, D] }));
  assert.equal(r.change, 'unchanged');
  assert.equal(r.changedCount, 0);
  assert.deepEqual(r.addedValidatedPolicies, [D]);
  assert.equal(r.perAsset.length, 2);
});

test('expected quantities compare BigInt-exact past 2^53', () => {
  const big = (MAX_ASSET - 10n).toString();
  const before = base({ inputs: [e(A, N1, big)], mint: [e(A, N1, '9')] });
  const after = base({ inputs: [e(A, N1, big)], mint: [e(A, N1, '10')] });
  const r = diffTransferOutputValue(before, after);
  const a = asset(r, A);
  assert.equal(a.change, 'expected-changed');
  assert.equal(a.before.expectedQuantity, (MAX_ASSET - 1n).toString());
  assert.equal(a.after.expectedQuantity, MAX_ASSET.toString());
});

test('hex case alone is the same asset — the planner canonical form compares as unchanged', () => {
  const upper = {
    validatedPolicies: [A.toUpperCase(), B.toUpperCase()],
    inputs: [e(A.toUpperCase(), N1, '100'), e(B.toUpperCase(), N1, '40'), e(C.toUpperCase(), N1, '999')],
    mint: [e(A.toUpperCase(), N1, '-30')],
  };
  const r = diffTransferOutputValue(base(), upper);
  assert.equal(r.change, 'unchanged');
  assert.equal(r.changedCount, 0);
});

test('a version that cannot be read is refused with the planner reason, on either side', () => {
  assert.throws(() => diffTransferOutputValue(base(), base({ validatedPolicies: [A, A] })), /more than once/);
  assert.throws(() => diffTransferOutputValue(base({ mint: [e(A, N1, '5'), e(A, N1, '6')] }), base()), /value map/);
  assert.throws(() => diffTransferOutputValue(base(), base({ inputs: [e(A, N1, '1.5')] })), /whole-number/);
  assert.throws(() => diffTransferOutputValue(base(), base({ inputs: [e(A, N1, 100)] })), /decimal string/);
});

test('comparing mutates neither modeled transfer', () => {
  const before = base(), after = base({ mint: [e(A, N1, '-10')] });
  const snapshot = JSON.stringify([before, after]);
  diffTransferOutputValue(before, after);
  assert.equal(JSON.stringify([before, after]), snapshot);
});

test('app and README carry the comparison at the current version', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /diffTransferOutputValue/);
  assert.match(app, /transferValueDiffPreview/);
  assert.match(app, /transfer-value-diff-after-validated/);
  assert.match(app, /transfer-value-diff-after-inputs/);
  assert.match(app, /transfer-value-diff-after-mint/);
  assert.match(app, /transfer-value-diff-result/);
  assert.match(app, /v1\.108/);
  assert.match(readme, /Transfer output-value comparison/);
});

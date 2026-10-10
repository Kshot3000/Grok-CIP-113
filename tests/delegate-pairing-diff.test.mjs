import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planDelegatePairing, diffDelegatePairing, DELEGATE_PAIRING_COMPARE_FIELDS } from '../src/domain.js';

// Delegate pairing comparison — the comparison counterpart to the
// planner/verifier pair. Planning says what a modeled transaction's
// two hints are; comparing says how they change when the transaction
// itself changes first. Both sides are planned by planDelegatePairing
// itself, so compare and plan can never disagree. Three positions
// only: the pairs are derived by the delegate walking the inputs, not
// carried by the redeemer, so a pairing change is reported separately
// (pairsChanged) and never counted as a difference of its own.
const B = { atBase: true };
const O = { atBase: false };
const base = (over = {}) => ({
  action: 'third-party',
  referenceInputs: ['protocol-parameters', 'registry-node-acted-on', 'registry-node-other'],
  registryNodeRef: 'registry-node-acted-on',
  inputs: [O, B, B, O, B],
  outputs: [B, B, B, B, O],
  outputsStartIdx: 1,
  ...over,
});

test('the same modeled transaction on both sides compares as unchanged on all three positions', () => {
  const r = diffDelegatePairing(base(), base());
  assert.equal(r.change, 'unchanged');
  assert.equal(r.unchanged, true);
  assert.deepEqual(r.differences, []);
  assert.deepEqual(r.changedFields, []);
  assert.deepEqual(r.addedRefs, []);
  assert.deepEqual(r.removedRefs, []);
  assert.equal(r.pairsChanged, false);
  assert.equal(DELEGATE_PAIRING_COMPARE_FIELDS.length, 3);
});

test('comparison returns exactly its eleven keys, and each difference exactly four', () => {
  const r = diffDelegatePairing(base(), base({ referenceInputs: ['extra-reference-input', 'protocol-parameters', 'registry-node-acted-on', 'registry-node-other'] }));
  assert.deepEqual(Object.keys(r).sort(), ['action', 'addedRefs', 'after', 'before', 'change', 'changedFields', 'differences', 'pairsChanged', 'registryNodeRef', 'removedRefs', 'unchanged'].sort());
  assert.equal(Object.keys(r).length, 11);
  for (const diff of r.differences) assert.deepEqual(Object.keys(diff).sort(), ['after', 'before', 'field', 'label']);
});

test('both sides are the planner returns planDelegatePairing itself produces', () => {
  const afterIn = base({ outputsStartIdx: 2, outputs: [B, B, B, B, O, B] });
  const r = diffDelegatePairing(base(), afterIn);
  assert.deepEqual(r.before, planDelegatePairing(base()));
  assert.deepEqual(r.after, planDelegatePairing(afterIn));
  assert.equal(r.action, 'third-party');
  assert.equal(r.registryNodeRef, 'registry-node-acted-on');
});

test('a reference input added ahead of the acted-on node shifts registry_node_idx alone', () => {
  const r = diffDelegatePairing(base(), base({ referenceInputs: ['extra-reference-input', 'protocol-parameters', 'registry-node-acted-on', 'registry-node-other'] }));
  assert.equal(r.change, 'hints-changed');
  assert.deepEqual(r.differences, [{ field: 'registryNodeIdx', label: 'registry_node_idx', before: 1, after: 2 }]);
  assert.deepEqual(r.addedRefs, ['extra-reference-input']);
  assert.deepEqual(r.removedRefs, []);
  assert.equal(r.pairsChanged, false);
});

test('a reference input appended after the acted-on node changes no hint — the list grew, the redeemer did not', () => {
  const r = diffDelegatePairing(base(), base({ referenceInputs: ['protocol-parameters', 'registry-node-acted-on', 'registry-node-other', 'extra-reference-input'] }));
  assert.equal(r.change, 'unchanged');
  assert.equal(r.unchanged, true);
  assert.deepEqual(r.addedRefs, ['extra-reference-input']);
  assert.equal(r.pairsChanged, false);
});

test('a start index moved by one shifts outputs_start_idx alone — and every pair with it', () => {
  const r = diffDelegatePairing(base(), base({ outputsStartIdx: 2, outputs: [B, B, B, B, O, B] }));
  assert.equal(r.change, 'hints-changed');
  assert.deepEqual(r.differences, [{ field: 'outputsStartIdx', label: 'outputs_start_idx', before: 1, after: 2 }]);
  assert.equal(r.pairsChanged, true);
});

test('a base input added with the output to pair it changes the pairing but no hint — the delegate walks the inputs', () => {
  // A fourth base input joins, with a sixth output to pair it: the
  // pairing grows from three pairs to four, but registry_node_idx and
  // outputs_start_idx stand exactly still — the new base input pairs
  // automatically, because the redeemer never enumerates the pairs.
  const r = diffDelegatePairing(base(), base({ inputs: [O, B, B, O, B, B], outputs: [B, B, B, B, O, B] }));
  assert.equal(r.change, 'unchanged');
  assert.deepEqual(r.differences, []);
  assert.equal(r.pairsChanged, true);
  assert.equal(r.before.pairs.length, 3);
  assert.equal(r.after.pairs.length, 4);
});

test('a non-base input inserted first shifts every pair input position but no hint and no output index', () => {
  const r = diffDelegatePairing(base(), base({ inputs: [O, O, B, B, O, B] }));
  assert.equal(r.change, 'unchanged');
  assert.deepEqual(r.differences, []);
  assert.equal(r.pairsChanged, true);
  assert.deepEqual(r.after.pairs.map(p => p.outputIndex), r.before.pairs.map(p => p.outputIndex));
  assert.notDeepEqual(r.after.pairs.map(p => p.inputIndex), r.before.pairs.map(p => p.inputIndex));
});

test('dropping the acted-on node makes the pairing unplannable — status and registry_node_idx differ, the start does not', () => {
  const r = diffDelegatePairing(base(), base({ referenceInputs: ['protocol-parameters', 'registry-node-other'] }));
  assert.equal(r.change, 'became-unplannable');
  assert.deepEqual(r.differences, [
    { field: 'status', label: 'Status', before: 'planned', after: 'unplannable' },
    { field: 'registryNodeIdx', label: 'registry_node_idx', before: 1, after: null },
  ]);
  assert.deepEqual(r.removedRefs, ['registry-node-acted-on']);
  assert.deepEqual(r.after.missing, ['registry-node']);
});

test('running out of outputs makes the pairing unplannable on the status alone — neither hint is invented or moved', () => {
  const r = diffDelegatePairing(base(), base({ outputs: [B, B] }));
  assert.equal(r.change, 'became-unplannable');
  assert.deepEqual(r.differences, [{ field: 'status', label: 'Status', before: 'planned', after: 'unplannable' }]);
  assert.deepEqual(r.after.missing, ['paired-outputs']);
  assert.equal(r.after.shortfall, 2);
});

test('restoring the missing node is became-plannable, the mirror of losing it', () => {
  const r = diffDelegatePairing(base({ referenceInputs: ['protocol-parameters', 'registry-node-other'] }), base());
  assert.equal(r.change, 'became-plannable');
  assert.deepEqual(r.changedFields, ['Status', 'registry_node_idx']);
});

test('two unplannable versions missing different pieces are still-unplannable and differ on the computable hint alone', () => {
  const before = base({ referenceInputs: ['protocol-parameters', 'registry-node-other'] }); // missing node; start 1 computable
  const after = base({ outputs: [B] }); // missing paired outputs; node 1 computable
  const r = diffDelegatePairing(before, after);
  assert.equal(r.change, 'still-unplannable');
  // Status is identical on both sides, so it is NOT a difference — the
  // different missing pieces show up exactly as the node hint's
  // null-ness, and the output shortfall on the status it already shares.
  assert.deepEqual(r.differences, [
    { field: 'registryNodeIdx', label: 'registry_node_idx', before: null, after: 1 },
  ]);
});

test('the same pairing serves the unfracking delegate, and its comparison tracks that action', () => {
  const r = diffDelegatePairing(base({ action: 'unfracking' }), base({ action: 'unfracking', outputsStartIdx: 0 }));
  assert.equal(r.action, 'unfracking');
  assert.equal(r.change, 'hints-changed');
  assert.deepEqual(r.changedFields, ['outputs_start_idx']);
});

test('different actions are different redeemers — refused, never compared', () => {
  assert.throws(
    () => diffDelegatePairing(base(), base({ action: 'unfracking' })),
    /different delegate actions/,
  );
});

test('different registry node references are different redeemers — refused, never compared', () => {
  assert.throws(
    () => diffDelegatePairing(base(), base({ registryNodeRef: 'registry-node-other' })),
    /different registry node references/,
  );
});

test('a version that cannot be read is refused with the planner reason, on either side', () => {
  const dup = base({ referenceInputs: ['protocol-parameters', 'registry-node-acted-on', 'protocol-parameters'] });
  assert.throws(() => diffDelegatePairing(base(), dup), /more than once/);
  assert.throws(() => diffDelegatePairing(dup, base()), /more than once/);
  const badEntry = base({ inputs: [O, { atBase: 'yes' }] });
  assert.throws(() => diffDelegatePairing(base(), badEntry), /as a boolean/);
});

test('comparing mutates neither modeled transaction', () => {
  const before = base(), after = base({ referenceInputs: ['extra-reference-input', 'protocol-parameters', 'registry-node-acted-on', 'registry-node-other'] });
  const snapshot = JSON.stringify([before, after]);
  diffDelegatePairing(before, after);
  assert.equal(JSON.stringify([before, after]), snapshot);
});

test('app and README carry the comparison at the current version', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /diffDelegatePairing/);
  assert.match(app, /delegatePairingDiffPreview/);
  assert.match(app, /delegate-pair-diff-after-refs/);
  assert.match(app, /delegate-pair-diff-after-inputs/);
  assert.match(app, /delegate-pair-diff-after-outputs/);
  assert.match(app, /delegate-pair-diff-after-start/);
  assert.match(app, /delegate-pair-diff-result/);
  assert.match(app, /v1\.97/);
  assert.match(readme, /Delegate pairing comparison/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { planDelegatePairing, verifyDelegatePairing } from '../src/domain.js';

// CIP-113 ThirdParty/Unfracking delegate pairing, per the spec's
// ThirdPartyAct and UnfrackingAct sections: the delegate walks
// tx.inputs in order, pairing every programmableLogicBase input with
// the next consecutive output starting from outputs_start_idx; inputs
// at other addresses are skipped and consume no output.
const B = { atBase: true };
const O = { atBase: false };
const base = (over = {}) => ({
  action: 'third-party',
  referenceInputs: ['protocol-parameters', 'registry-node-acted-on', 'registry-node-other'],
  registryNodeRef: 'registry-node-acted-on',
  // Base inputs at positions 1, 2, 4; non-base inputs at 0 and 3 are
  // skipped and consume no output.
  inputs: [O, B, B, O, B],
  // Output 0 sits at a base address before the paired outputs begin.
  outputs: [B, B, B, B, O],
  outputsStartIdx: 1,
  ...over,
});

test('registry_node_idx is the acted-on node position in the reference inputs as listed', () => {
  const p = planDelegatePairing(base());
  assert.equal(p.status, 'planned');
  assert.equal(p.registryNodeIndex, 1);
  const moved = planDelegatePairing(base({ referenceInputs: ['registry-node-acted-on', 'protocol-parameters'] }));
  assert.equal(moved.registryNodeIndex, 0);
});

test('pairing walks inputs in order, skips non-base inputs, and pairs consecutively from outputs_start_idx', () => {
  const p = planDelegatePairing(base());
  assert.deepEqual(p.pairs, [
    { baseOrdinal: 0, inputIndex: 1, outputIndex: 1 },
    { baseOrdinal: 1, inputIndex: 2, outputIndex: 2 },
    { baseOrdinal: 2, inputIndex: 4, outputIndex: 3 },
  ]);
  assert.equal(p.baseInputCount, 3);
  assert.equal(p.skippedInputCount, 2);
  // The counting trap, pinned: pairing the k-th INPUT (not base input)
  // would pair input 4 with output 1+4=5, which does not exist.
  assert.notEqual(p.pairs[2].outputIndex, 1 + p.pairs[2].inputIndex);
});

test('outputs before the start are unpaired, and base outputs among them are counted separately', () => {
  const p = planDelegatePairing(base());
  assert.equal(p.earlyOutputCount, 1);
  assert.equal(p.earlyBaseOutputCount, 1); // counts toward the third-party balance invariant's output side
  assert.equal(p.trailingOutputCount, 1); // output 4 follows the last pair and is paired with nothing
  const none = planDelegatePairing(base({ outputsStartIdx: 0 }));
  assert.equal(none.earlyOutputCount, 0);
  assert.equal(none.earlyBaseOutputCount, 0);
  assert.deepEqual(none.pairs.map(x => x.outputIndex), [0, 1, 2]);
});

test('the same pairing serves the unfracking delegate — the redeemer shape is shared', () => {
  const p = planDelegatePairing(base({ action: 'unfracking' }));
  assert.equal(p.status, 'planned');
  assert.equal(p.action, 'unfracking');
  assert.deepEqual(p.pairs, planDelegatePairing(base()).pairs);
});

test('a transaction with no base inputs pairs nothing and is still plannable', () => {
  const p = planDelegatePairing(base({ inputs: [O, O], outputs: [O], outputsStartIdx: 1 }));
  assert.equal(p.status, 'planned');
  assert.deepEqual(p.pairs, []);
  assert.equal(p.baseInputCount, 0);
});

test('a registry node missing from the reference inputs is unplannable, never given an invented index', () => {
  const p = planDelegatePairing(base({ registryNodeRef: 'registry-node-absent' }));
  assert.equal(p.status, 'unplannable');
  assert.deepEqual(p.missing, ['registry-node']);
  assert.equal(p.registryNodeIndex, null);
  assert.deepEqual(p.pairs, []);
});

test('too few outputs from the start is unplannable with the shortfall named', () => {
  const p = planDelegatePairing(base({ outputs: [B, B] })); // start 1 + 3 base inputs needs 4 outputs
  assert.equal(p.status, 'unplannable');
  assert.deepEqual(p.missing, ['paired-outputs']);
  assert.equal(p.shortfall, 2);
  const past = planDelegatePairing(base({ outputsStartIdx: 9 }));
  assert.equal(past.status, 'unplannable');
  assert.deepEqual(past.missing, ['outputs-start']);
  const both = planDelegatePairing(base({ registryNodeRef: 'absent', outputs: [B] }));
  assert.deepEqual(both.missing, ['registry-node', 'paired-outputs']);
});

test('a modeled transaction that cannot be read is refused, never planned in part', () => {
  assert.throws(() => planDelegatePairing(base({ action: 'transfer' })), /TransferAct carries registry proofs/);
  assert.throws(() => planDelegatePairing(base({ referenceInputs: ['a', 'a'] })), /more than once/);
  assert.throws(() => planDelegatePairing(base({ inputs: [O, { atBase: 'yes' }] })), /as a boolean/);
  assert.throws(() => planDelegatePairing(base({ outputs: [{}] })), /as a boolean/);
  assert.throws(() => planDelegatePairing(base({ inputs: [{ atBase: true, label: 'x' }] })), /unknown field "label"/);
  assert.throws(() => planDelegatePairing(base({ outputsStartIdx: 1.5 })), /non-negative integer/);
  assert.throws(() => planDelegatePairing(base({ outputsStartIdx: -1 })), /non-negative integer/);
  assert.throws(() => planDelegatePairing(base({ registryNodeRef: ' ' })), /must name one of the reference inputs/);
  assert.throws(() => planDelegatePairing({ ...base(), extra: 1 }), /unknown field "extra"/);
});

test('planning does not mutate the modeled lists it was given', () => {
  const input = base();
  const snapshot = JSON.parse(JSON.stringify(input));
  planDelegatePairing(input);
  assert.deepEqual(input, snapshot);
});

test('the planned redeemer verifies, and each hint fails alone', () => {
  const ok = verifyDelegatePairing(base(), { registryNodeIdx: 1, outputsStartIdx: 1 });
  assert.equal(ok.status, 'correct');
  assert.equal(ok.valid, true);
  // A start off by one shifts every pair — and fails only that hint.
  const shifted = verifyDelegatePairing(base(), { registryNodeIdx: 1, outputsStartIdx: 0 });
  assert.equal(shifted.status, 'incorrect');
  assert.deepEqual(shifted.verdicts, { registryNodeIdx: true, outputsStartIdx: false });
  const wrongNode = verifyDelegatePairing(base(), { registryNodeIdx: 2, outputsStartIdx: 1 });
  assert.equal(wrongNode.status, 'incorrect');
  assert.deepEqual(wrongNode.verdicts, { registryNodeIdx: false, outputsStartIdx: true });
});

test('an unstated hint is incomplete, never a pass and never a failure', () => {
  const v = verifyDelegatePairing(base(), { registryNodeIdx: 1 });
  assert.equal(v.status, 'incomplete');
  assert.deepEqual(v.verdicts, { registryNodeIdx: true, outputsStartIdx: 'not-stated' });
  const none = verifyDelegatePairing(base(), {});
  assert.equal(none.status, 'incomplete');
  assert.deepEqual(none.verdicts, { registryNodeIdx: 'not-stated', outputsStartIdx: 'not-stated' });
});

test('a malformed claimed hint is refused, never scored', () => {
  assert.throws(() => verifyDelegatePairing(base(), { registryNodeIdx: 0.5, outputsStartIdx: 1 }), /non-negative integer/);
  assert.throws(() => verifyDelegatePairing(base(), { registryNodeIdx: 1, outputsStartIdx: '1' }), /non-negative integer/);
  assert.throws(() => verifyDelegatePairing(base(), { registryNodeIdx: 1, outputsStartIdx: 1, paramsIdx: 0 }), /only registry_node_idx and outputs_start_idx/);
});

test('a claim for an unplannable transaction is reported unplannable, with no claim scored', () => {
  const v = verifyDelegatePairing(base({ outputs: [B] }), { registryNodeIdx: 1, outputsStartIdx: 1 });
  assert.equal(v.status, 'unplannable');
  assert.equal(v.valid, false);
  assert.equal(v.verdicts, null);
  assert.deepEqual(v.missing, ['paired-outputs']);
  assert.equal(v.shortfall, 3);
});

test('every planned redeemer verifies across a grid of transaction shapes and both actions', () => {
  const shapes = [
    base(),
    base({ action: 'unfracking' }),
    base({ inputs: [B], outputs: [B], outputsStartIdx: 0, referenceInputs: ['registry-node-acted-on'], registryNodeRef: 'registry-node-acted-on' }),
    base({ inputs: [B, O, B], outputs: [O, O, B, B], outputsStartIdx: 2 }),
    base({ inputs: [O, O], outputs: [], outputsStartIdx: 0 }),
  ];
  for (const shape of shapes) {
    const p = planDelegatePairing(shape);
    assert.equal(p.status, 'planned');
    const v = verifyDelegatePairing(shape, { registryNodeIdx: p.registryNodeIndex, outputsStartIdx: p.outputsStartIdx });
    assert.equal(v.valid, true);
    // Each pair's output index is the start plus the base ordinal.
    for (const pair of p.pairs) assert.equal(pair.outputIndex, p.outputsStartIdx + pair.baseOrdinal);
  }
});

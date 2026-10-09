import test from 'node:test';
import assert from 'node:assert/strict';
import { planRegistryProofs, verifyRegistryProofs } from '../src/domain.js';

// Same modeled registry as the planner tests: the spec's [A, C, E] example.
const A = '11'.repeat(28), C = '33'.repeat(28), E = '55'.repeat(28), D = '44'.repeat(28);
const B = '22'.repeat(28), F = '66'.repeat(28), LOW = '00'.repeat(28);

// The correct claimed proofs for queried [C, D] against registry [A, C, E],
// in the spec's own terms: C exists at node 1; D is absent, covered by C.
const existsC = { policy: C, proofType: 'TokenExists', nodeIndex: 1, nodeKey: C, nextKey: E };
const absentD = { policy: D, proofType: 'TokenDoesNotExist', nodeIndex: 1, nodeKey: C, nextKey: E };

test("the planner's own output verifies as a valid proof list", () => {
  const plan = planRegistryProofs([A, C, E], [E, D, C, A]);
  const claimed = plan.proofs.map(p => ({ policy: p.policy, proofType: p.proofType, nodeIndex: p.nodeIndex, nodeKey: p.nodeKey, nextKey: p.nextKey }));
  const v = verifyRegistryProofs([A, C, E], [E, D, C, A], claimed);
  assert.equal(v.valid, true);
  assert.equal(v.correctCount, 4);
  assert.equal(v.completeness.complete, true);
  assert.equal(v.ordering.ordered, true);
});

test('a correct two-proof list for the spec example verifies, per position', () => {
  const v = verifyRegistryProofs([A, C, E], [C, D], [existsC, absentD]);
  assert.equal(v.valid, true);
  assert.deepEqual(v.perProof.map(p => p.status), ['correct', 'correct']);
  assert.deepEqual(v.perProof[1].verdicts, { proofType: true, nodeIndex: true, nodeKey: true, nextKey: true });
});

test('completeness: a missing proof, an extra proof, and a duplicate each fail it by name', () => {
  const missing = verifyRegistryProofs([A, C, E], [C, D], [existsC]);
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.completeness.missing, [D]);
  assert.equal(missing.perProof[1].status, 'missing');
  const extra = verifyRegistryProofs([A, C, E], [C], [existsC, { policy: F, proofType: 'TokenDoesNotExist', nodeIndex: 2, nodeKey: E, nextKey: null }]);
  assert.equal(extra.valid, false);
  assert.deepEqual(extra.completeness.extra, [F]);
  const dup = verifyRegistryProofs([A, C, E], [C, D], [existsC, absentD, absentD]);
  assert.equal(dup.valid, false);
  assert.deepEqual(dup.completeness.duplicates, [D]);
  assert.equal(dup.duplicateCount, 1);
});

test('ordering: the same correct proofs in reverse order fail ordering alone', () => {
  const v = verifyRegistryProofs([A, C, E], [C, D], [absentD, existsC]);
  assert.equal(v.valid, false);
  assert.equal(v.ordering.ordered, false);
  assert.equal(v.ordering.firstOutOfOrder, 1);
  // Both proofs are individually correct — ordering is a property of the list.
  assert.equal(v.correctCount, 2);
  assert.equal(v.completeness.complete, true);
});

test('correctness: claiming a registered policy is absent (the bypass the mechanism exists to prevent) fails the type verdict', () => {
  const bypass = { policy: C, proofType: 'TokenDoesNotExist', nodeIndex: 0, nodeKey: A, nextKey: C };
  const v = verifyRegistryProofs([A, C, E], [C], [bypass]);
  assert.equal(v.valid, false);
  assert.equal(v.perProof[0].status, 'incorrect');
  assert.equal(v.perProof[0].verdicts.proofType, false);
  assert.equal(v.perProof[0].expected.proofType, 'TokenExists');
});

test('correctness: the right covering node at the wrong index fails only the index verdict', () => {
  const wrongIndex = { ...absentD, nodeIndex: 2 };
  const v = verifyRegistryProofs([A, C, E], [D], [wrongIndex]);
  assert.equal(v.perProof[0].status, 'incorrect');
  assert.deepEqual(v.perProof[0].verdicts, { proofType: true, nodeIndex: false, nodeKey: true, nextKey: true });
});

test('correctness: a covering node whose stated next does not pass the policy fails only the next verdict', () => {
  // Node A with next C does not cover D: C is not above D.
  const wrongCover = { policy: D, proofType: 'TokenDoesNotExist', nodeIndex: 0, nodeKey: A, nextKey: C };
  const v = verifyRegistryProofs([A, C, E], [D], [wrongCover]);
  assert.equal(v.perProof[0].status, 'incorrect');
  assert.equal(v.perProof[0].verdicts.nodeKey, false);
  assert.equal(v.perProof[0].verdicts.nextKey, false);
  // The right node with a wrong stated next fails next alone.
  const wrongNext = { ...absentD, nextKey: A };
  const v2 = verifyRegistryProofs([A, C, E], [D], [wrongNext]);
  assert.deepEqual(v2.perProof[0].verdicts, { proofType: true, nodeIndex: true, nodeKey: true, nextKey: false });
});

test('an omitted next key is not-stated, not a failure — the node is identified by key and index', () => {
  const noNext = { policy: D, proofType: 'TokenDoesNotExist', nodeIndex: 1, nodeKey: C };
  const v = verifyRegistryProofs([A, C, E], [D], [noNext]);
  assert.equal(v.valid, true);
  assert.equal(v.perProof[0].verdicts.nextKey, 'not-stated');
});

test('the last node has no successor in the model: a claimed next for it fails, an omitted one passes', () => {
  const existsE = { policy: E, proofType: 'TokenExists', nodeIndex: 2, nodeKey: E };
  assert.equal(verifyRegistryProofs([A, C, E], [E], [existsE]).valid, true);
  const inventedNext = { ...existsE, nextKey: F };
  const v = verifyRegistryProofs([A, C, E], [E], [inventedNext]);
  assert.equal(v.perProof[0].verdicts.nextKey, false);
  assert.equal(v.perProof[0].expected.nextKey, null);
});

test('a policy the modeled list cannot prove is unverifiable in the model, claimed or not', () => {
  const claimed = { policy: LOW, proofType: 'TokenDoesNotExist', nodeIndex: 0, nodeKey: A, nextKey: C };
  const v = verifyRegistryProofs([A, C, E], [LOW], [claimed]);
  assert.equal(v.valid, false);
  assert.equal(v.perProof[0].status, 'unverifiable');
  assert.equal(v.unverifiableCount, 1);
  const unclaimed = verifyRegistryProofs([A, C, E], [LOW], []);
  assert.equal(unclaimed.perProof[0].status, 'unverifiable');
  assert.equal(unclaimed.missingCount, 0);
});

test('malformed claimed proofs are refused, never scored as mismatches', () => {
  assert.throws(() => verifyRegistryProofs([A, C, E], [C], [{ ...existsC, policy: 'abcd' }]), /Claimed proof 1's policy is not a 28-byte policy ID/);
  assert.throws(() => verifyRegistryProofs([A, C, E], [C], [{ ...existsC, proofType: 'Exists' }]), /proof type must be TokenExists or TokenDoesNotExist/);
  assert.throws(() => verifyRegistryProofs([A, C, E], [C], [{ ...existsC, nodeIndex: 1.5 }]), /non-negative integer/);
  assert.throws(() => verifyRegistryProofs([A, C, E], [C], [{ ...existsC, nodeIndex: -1 }]), /non-negative integer/);
  assert.throws(() => verifyRegistryProofs([A, C, E], [C], [{ ...existsC, nodeKey: 'zz'.repeat(28) }]), /node key is not a 28-byte policy ID/);
  assert.throws(() => verifyRegistryProofs([A, C, E], [C], 'not-a-list'), /array/);
  assert.throws(() => verifyRegistryProofs([A, C, E], [C], [null]), /must be an object/);
});

test('an invalid modeled registry is refused by the planner discipline, before any claim is scored', () => {
  assert.throws(() => verifyRegistryProofs([C, A], [A], []), /lexicographic/);
  assert.throws(() => verifyRegistryProofs([A, A], [A], []), /unique/);
});

test('uppercase claimed IDs are the same IDs, stated in canonical lowercase', () => {
  const upper = { policy: C.toUpperCase(), proofType: 'TokenExists', nodeIndex: 1, nodeKey: C.toUpperCase(), nextKey: E.toUpperCase() };
  const v = verifyRegistryProofs([A, C, E], [C], [upper]);
  assert.equal(v.valid, true);
  assert.equal(v.perProof[0].claimed.nodeKey, C);
});

test('an empty query with an empty claim verifies; an empty query with a claim is extra', () => {
  assert.equal(verifyRegistryProofs([A, C], [], []).valid, true);
  const v = verifyRegistryProofs([A, C], [], [{ policy: B, proofType: 'TokenDoesNotExist', nodeIndex: 0, nodeKey: A, nextKey: C }]);
  assert.equal(v.valid, false);
  assert.deepEqual(v.completeness.extra, [B]);
});

test('verification never mutates its inputs', () => {
  const registry = Object.freeze([A, C, E]);
  const queried = Object.freeze([C, D]);
  const claimed = Object.freeze([Object.freeze({ ...existsC }), Object.freeze({ ...absentD })]);
  const v = verifyRegistryProofs(registry, queried, claimed);
  assert.equal(v.valid, true);
  assert.deepEqual([...registry], [A, C, E]);
});

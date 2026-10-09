import test from 'node:test';
import assert from 'node:assert/strict';
import { planRegistryProofs, diffRegistryProofs, planRegistryInsertion } from '../src/domain.js';

// Same modeled registry as the planner/verifier/diff suites: the spec's
// [A, C, E] worked example. Registration per the CIP-113 spec section
// "Programmable token registration": the transaction spends prev_node (the
// node preceding the new policy), returns it with only its `next` set to
// the new key, and adds the new node with `next` = prev_node's old `next`.
const A = '11'.repeat(28), B = '22'.repeat(28), C = '33'.repeat(28), D = '44'.repeat(28);
const E = '55'.repeat(28), LOW = '00'.repeat(28), HIGH = 'ff'.repeat(28);

test('inserting between two keys spends the covering node as prev_node', () => {
  // D belongs between C and E: prev_node is C, the planner's covering
  // node — its next is rewritten E → D, and the new node D points at E.
  const r = planRegistryInsertion([A, C, E], D);
  assert.equal(r.status, 'insertable');
  assert.equal(r.insertionIndex, 2);
  assert.equal(r.prevKind, 'node');
  assert.deepEqual(r.prevNode, { index: 1, key: C, nextBefore: E, nextAfter: D });
  assert.deepEqual(r.newNode, { key: D, nextKey: E, nextKind: 'node' });
  assert.equal(r.successorKey, E);
  assert.deepEqual(r.shiftedKeys, [E]);
  assert.deepEqual(r.resultingKeys, [A, C, D, E]);
  assert.equal(r.resultingSize, 4);
});

test('inserting at the front is preceded by the origin node, which the model does not carry', () => {
  // LOW sorts before A: prev_node is the registry origin node — a real
  // node on chain, but deployment data this list does not contain. The
  // new node's next is still fully known: the current first key.
  const r = planRegistryInsertion([A, C, E], LOW);
  assert.equal(r.status, 'insertable');
  assert.equal(r.insertionIndex, 0);
  assert.equal(r.prevNode, null);
  assert.equal(r.prevKind, 'origin');
  assert.deepEqual(r.newNode, { key: LOW, nextKey: A, nextKind: 'node' });
  assert.equal(r.successorKey, A);
  assert.deepEqual(r.shiftedKeys, [A, C, E]);
  assert.deepEqual(r.resultingKeys, [LOW, A, C, E]);
});

test('inserting after the last key spends the last node and inherits its terminal next', () => {
  // HIGH sorts after E: prev_node is E itself, fully known, but the new
  // node's next is E's old next — the list's terminal value, which the
  // modeled list does not carry and the plan does not invent.
  const r = planRegistryInsertion([A, C, E], HIGH);
  assert.equal(r.status, 'insertable');
  assert.equal(r.insertionIndex, 3);
  assert.equal(r.prevKind, 'node');
  assert.deepEqual(r.prevNode, { index: 2, key: E, nextBefore: null, nextAfter: HIGH });
  assert.deepEqual(r.newNode, { key: HIGH, nextKey: null, nextKind: 'terminal' });
  assert.equal(r.successorKey, null);
  assert.deepEqual(r.shiftedKeys, []);
  assert.deepEqual(r.resultingKeys, [A, C, E, HIGH]);
});

test('inserting into an empty registry sits between the origin and the terminal', () => {
  const r = planRegistryInsertion([], D);
  assert.equal(r.status, 'insertable');
  assert.equal(r.insertionIndex, 0);
  assert.equal(r.prevNode, null);
  assert.equal(r.prevKind, 'origin');
  assert.deepEqual(r.newNode, { key: D, nextKey: null, nextKind: 'terminal' });
  assert.deepEqual(r.shiftedKeys, []);
  assert.deepEqual(r.resultingKeys, [D]);
  assert.equal(r.resultingSize, 1);
});

test('a policy already in the list is already registered, not an insertion', () => {
  const r = planRegistryInsertion([A, C, E], C);
  assert.equal(r.status, 'already-registered');
  assert.equal(r.insertionIndex, 1);
  assert.deepEqual(r.existingNode, { index: 1, key: C, nextKey: E });
  assert.equal(r.prevNode, null);
  assert.equal(r.newNode, null);
  assert.deepEqual(r.shiftedKeys, []);
  assert.deepEqual(r.resultingKeys, [A, C, E]);
  assert.equal(r.resultingSize, 3);
});

test('the planned registry actually registers the policy at the planned index', () => {
  // Cross-tool invariant: planning proofs against the resulting list
  // finds the inserted policy registered, as a TokenExists proof naming
  // its own node at exactly the insertion index the plan named.
  for (const [keys, policy] of [[[A, C, E], B], [[A, C, E], D], [[A, C, E], LOW], [[A, C, E], HIGH], [[], D], [[A], HIGH], [[A], LOW]]) {
    const r = planRegistryInsertion(keys, policy);
    const plan = planRegistryProofs(r.resultingKeys, [policy]);
    assert.equal(plan.proofs[0].status, 'registered');
    assert.equal(plan.proofs[0].proofType, 'TokenExists');
    assert.equal(plan.proofs[0].nodeIndex, r.insertionIndex);
    assert.equal(plan.proofs[0].nodeKey, policy);
    assert.equal(plan.proofs[0].nextKey, r.newNode.nextKind === 'node' ? r.newNode.nextKey : null);
  }
});

test('the insertion agrees with the change-impact diff between the two lists', () => {
  // Cross-tool invariant, second direction: diffing the before list
  // against the plan's resulting list classifies the inserted policy as
  // newly registered and names exactly the plan's key as added.
  const r = planRegistryInsertion([A, C, E], D);
  const d = diffRegistryProofs([A, C, E], r.resultingKeys, [D]);
  assert.deepEqual(d.addedKeys, [D]);
  assert.deepEqual(d.removedKeys, []);
  assert.equal(d.perPolicy[0].change, 'newly-registered');
  assert.equal(d.newlyRegisteredCount, 1);
});

test('the covering node the plan spends is the planner absence-proof node', () => {
  // The insertion's prev_node and the absence proof for the same policy
  // name the same node — one mechanism, two directions.
  const plan = planRegistryProofs([A, C, E], [D]);
  const r = planRegistryInsertion([A, C, E], D);
  assert.equal(plan.proofs[0].proofType, 'TokenDoesNotExist');
  assert.equal(r.prevNode.key, plan.proofs[0].nodeKey);
  assert.equal(r.prevNode.index, plan.proofs[0].nodeIndex);
  assert.equal(r.prevNode.nextBefore, plan.proofs[0].nextKey);
});

test('an insertion in the middle shifts exactly the keys after it', () => {
  const r = planRegistryInsertion([A, C, E], B);
  assert.equal(r.insertionIndex, 1);
  assert.deepEqual(r.prevNode, { index: 0, key: A, nextBefore: C, nextAfter: B });
  assert.deepEqual(r.newNode, { key: B, nextKey: C, nextKind: 'node' });
  assert.deepEqual(r.shiftedKeys, [C, E]);
  assert.deepEqual(r.resultingKeys, [A, B, C, E]);
});

test('the modeled list inherits the planner refusal discipline', () => {
  assert.throws(() => planRegistryInsertion([C, A, E], D), /lexicographic/);
  assert.throws(() => planRegistryInsertion([A, C, C], D), /unique/);
  assert.throws(() => planRegistryInsertion(['zz'.repeat(28), C, E], D), /28-byte policy ID/);
  assert.throws(() => planRegistryInsertion('not-an-array', D), /must be an array/);
});

test('the policy being registered is validated as a 28-byte ID, never truncated', () => {
  assert.throws(() => planRegistryInsertion([A, C, E], 'abcd'), /28-byte policy ID/);
  assert.throws(() => planRegistryInsertion([A, C, E], '11'.repeat(29)), /28-byte policy ID/);
  assert.throws(() => planRegistryInsertion([A, C, E], 42), /policy ID string/);
});

test('the plan does not mutate the modeled list it was given', () => {
  const keys = [A, C, E];
  const r = planRegistryInsertion(keys, D);
  assert.deepEqual(keys, [A, C, E]);
  r.resultingKeys.push(HIGH);
  assert.deepEqual(keys, [A, C, E]);
});

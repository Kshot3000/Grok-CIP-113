import test from 'node:test';
import assert from 'node:assert/strict';
import { planRegistryProofs, planRegistryInsertion, verifyRegistryInsertion } from '../src/domain.js';

// The checking half of the v1.66 insertion planner, over the same modeled
// registry as the planner suite: the spec's [A, C, E] worked example.
// A claimed insertion is judged per the CIP-113 spec section
// "Programmable token registration": the transaction spends prev_node,
// returns it with only its `next` rewritten to the new key, and adds the
// new node with `next` = prev_node's old `next`, at the sorted position.
const A = '11'.repeat(28), B = '22'.repeat(28), C = '33'.repeat(28), D = '44'.repeat(28);
const E = '55'.repeat(28), LOW = '00'.repeat(28), HIGH = 'ff'.repeat(28);

// The canonical claim for a plan: exactly what the planner plans.
const claimFor = (keys, policy) => {
  const p = planRegistryInsertion(keys, policy);
  return { prevKey: p.prevNode?.key ?? null, prevNextAfter: policy, newNext: p.newNode.nextKey, insertionIndex: p.insertionIndex };
};

test('a correct mid-list insertion claim verifies on every position', () => {
  const v = verifyRegistryInsertion([A, C, E], D, claimFor([A, C, E], D));
  assert.equal(v.status, 'correct');
  assert.equal(v.valid, true);
  assert.deepEqual(v.verdicts, { prevNode: true, prevRewrite: true, newNodeNext: true, insertionIndex: true });
  assert.deepEqual(v.expected, { insertionIndex: 2, prevKind: 'node', prevKey: C, prevNextAfter: D, newNext: E, newNextKind: 'node' });
});

test('inserting before the first key verifies with the origin node claimed as null', () => {
  const v = verifyRegistryInsertion([A, C, E], LOW, claimFor([A, C, E], LOW));
  assert.equal(v.valid, true);
  assert.equal(v.expected.prevKind, 'origin');
  assert.equal(v.expected.prevKey, null);
  assert.equal(v.expected.newNext, A);
  assert.equal(v.expected.insertionIndex, 0);
});

test('inserting after the last key verifies with the terminal next claimed as null', () => {
  const v = verifyRegistryInsertion([A, C, E], HIGH, claimFor([A, C, E], HIGH));
  assert.equal(v.valid, true);
  assert.equal(v.expected.prevKey, E);
  assert.equal(v.expected.newNext, null);
  assert.equal(v.expected.newNextKind, 'terminal');
  assert.equal(v.expected.insertionIndex, 3);
});

test('inserting into an empty registry verifies with both neighbours as null statements', () => {
  const v = verifyRegistryInsertion([], D, { prevKey: null, prevNextAfter: D, newNext: null, insertionIndex: 0 });
  assert.equal(v.valid, true);
  assert.equal(v.status, 'correct');
});

test('every planned insertion verifies across the boundary grid', () => {
  const lists = [[], [C], [A, C, E], [B, D]];
  const policies = [LOW, A, B, C, D, E, HIGH];
  for (const keys of lists) for (const policy of policies) {
    const p = planRegistryInsertion(keys, policy);
    if (p.status !== 'insertable') continue;
    const v = verifyRegistryInsertion(keys, policy, claimFor(keys, policy));
    assert.equal(v.valid, true, `${policy} into [${keys}] should verify`);
    // The verified index is where the planner's resulting list — and a
    // fresh proof plan over it — actually finds the policy registered.
    assert.equal(p.resultingKeys[v.expected.insertionIndex], policy);
    assert.equal(planRegistryProofs(p.resultingKeys, [policy]).proofs[0].nodeIndex, v.expected.insertionIndex);
  }
});

test('a wrong prev node fails only the prev-node verdict', () => {
  const claim = claimFor([A, C, E], D);
  claim.prevKey = A; // a real node, but not the covering node for D
  const v = verifyRegistryInsertion([A, C, E], D, claim);
  assert.equal(v.status, 'incorrect');
  assert.equal(v.valid, false);
  assert.deepEqual(v.verdicts, { prevNode: false, prevRewrite: true, newNodeNext: true, insertionIndex: true });
});

test('claiming a node where the origin belongs fails only the prev-node verdict', () => {
  const claim = claimFor([A, C, E], LOW);
  claim.prevKey = A;
  const v = verifyRegistryInsertion([A, C, E], LOW, claim);
  assert.equal(v.verdicts.prevNode, false);
  assert.equal(v.verdicts.newNodeNext, true);
  assert.equal(v.valid, false);
});

test('a prev_node returned pointing anywhere but the new key fails only the rewrite verdict', () => {
  const claim = claimFor([A, C, E], D);
  claim.prevNextAfter = E; // prev_node left pointing at its old next: the new node is never linked in
  const v = verifyRegistryInsertion([A, C, E], D, claim);
  assert.deepEqual(v.verdicts, { prevNode: true, prevRewrite: false, newNodeNext: true, insertionIndex: true });
});

test('a new node pointing at the wrong successor fails only the new-next verdict', () => {
  const claim = claimFor([A, C, E], D);
  claim.newNext = C; // points backwards at prev_node itself — the chain would loop, E orphaned
  const v = verifyRegistryInsertion([A, C, E], D, claim);
  assert.deepEqual(v.verdicts, { prevNode: true, prevRewrite: true, newNodeNext: false, insertionIndex: true });
});

test('a wrong insertion index fails only the index verdict', () => {
  const claim = claimFor([A, C, E], D);
  claim.insertionIndex = 1;
  const v = verifyRegistryInsertion([A, C, E], D, claim);
  assert.deepEqual(v.verdicts, { prevNode: true, prevRewrite: true, newNodeNext: true, insertionIndex: false });
});

test('a policy already registered has no insertion to verify', () => {
  const v = verifyRegistryInsertion([A, C, E], C, claimFor([A, C, E], D));
  assert.equal(v.status, 'not-insertable');
  assert.equal(v.valid, false);
  assert.equal(v.verdicts, null);
  assert.equal(v.expected, null);
  assert.deepEqual(v.existingNode, { index: 1, key: C, nextKey: E });
});

test('an unstated position makes the claim incomplete, not incorrect', () => {
  const claim = claimFor([A, C, E], D);
  delete claim.newNext;
  const v = verifyRegistryInsertion([A, C, E], D, claim);
  assert.equal(v.status, 'incomplete');
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.newNodeNext, 'not-stated');
  assert.equal(v.verdicts.prevNode, true);
  // null is a statement, undefined is not: stating the terminal where a
  // node belongs is a false claim, not an omission.
  const v2 = verifyRegistryInsertion([A, C, E], D, { ...claimFor([A, C, E], D), newNext: null });
  assert.equal(v2.verdicts.newNodeNext, false);
  assert.equal(v2.status, 'incorrect');
});

test('uppercase hex claims verify and are stated in canonical lowercase', () => {
  const claim = claimFor([A, C, E], D);
  const upper = { prevKey: claim.prevKey.toUpperCase(), prevNextAfter: claim.prevNextAfter.toUpperCase(), newNext: claim.newNext.toUpperCase(), insertionIndex: 2 };
  const v = verifyRegistryInsertion([A, C, E], D.toUpperCase(), upper);
  assert.equal(v.valid, true);
  assert.equal(v.claimed.prevKey, C);
  assert.equal(v.policy, D);
});

test('a malformed claim is refused, never scored as a wrong insertion', () => {
  assert.throws(() => verifyRegistryInsertion([A, C, E], D, null), /must be an object/);
  assert.throws(() => verifyRegistryInsertion([A, C, E], D, 'claim'), /must be an object/);
  assert.throws(() => verifyRegistryInsertion([A, C, E], D, { ...claimFor([A, C, E], D), prevKey: 'abcd' }), /28-byte policy ID/);
  assert.throws(() => verifyRegistryInsertion([A, C, E], D, { ...claimFor([A, C, E], D), newNext: 'zz'.repeat(28) }), /28-byte policy ID/);
  assert.throws(() => verifyRegistryInsertion([A, C, E], D, { ...claimFor([A, C, E], D), prevNextAfter: B.slice(0, 54) }), /28-byte policy ID/);
  assert.throws(() => verifyRegistryInsertion([A, C, E], D, { ...claimFor([A, C, E], D), insertionIndex: 1.5 }), /non-negative integer/);
  assert.throws(() => verifyRegistryInsertion([A, C, E], D, { ...claimFor([A, C, E], D), insertionIndex: -1 }), /non-negative integer/);
});

test('the modeled list and the policy inherit the planner refusal discipline', () => {
  assert.throws(() => verifyRegistryInsertion([C, A, E], D, claimFor([A, C, E], D)), /lexicographic/);
  assert.throws(() => verifyRegistryInsertion([A, C, E], 'abcd', claimFor([A, C, E], D)), /28-byte policy ID/);
});

test('verification does not mutate the modeled list or the claim', () => {
  const keys = [A, C, E];
  const claim = claimFor(keys, D);
  const snapshot = { ...claim };
  verifyRegistryInsertion(keys, D, claim);
  assert.deepEqual(keys, [A, C, E]);
  assert.deepEqual(claim, snapshot);
});

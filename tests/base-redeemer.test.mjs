import test from 'node:test';
import assert from 'node:assert/strict';
import { planBaseSpendRedeemer, verifyBaseSpendRedeemer } from '../src/domain.js';

// CIP-113 BaseSpendRedeemer hint planning, per the spec's delegation
// architecture: params_idx is the protocol parameters UTxO's index in
// the transaction's reference inputs (the order the transaction lists
// them — the ledger does not reorder reference inputs), and wdrl_idx is
// the programmableLogicGlobal credential's index in the withdrawal map
// AS THE LEDGER ORDERS IT: script credentials first, bytewise within
// each kind, then public-key credentials, bytewise within each kind.
const GLOBAL = { kind: 'script', hash: 'aa'.repeat(28) };
const SCRIPT_B = { kind: 'script', hash: 'bb'.repeat(28) };
const PUBKEY_9 = { kind: 'pubkey', hash: '99'.repeat(28) };
const PUBKEY_1 = { kind: 'pubkey', hash: '11'.repeat(28) };
const base = (over = {}) => ({
  referenceInputs: ['registry-node-33', 'protocol-parameters', 'registry-node-55'],
  paramsRef: 'protocol-parameters',
  // Insertion order deliberately fights the ledger order: a public-key
  // withdrawal first, and the two script credentials out of byte order.
  withdrawals: [PUBKEY_9, SCRIPT_B, GLOBAL],
  globalCredential: GLOBAL,
  ...over,
});

test('params_idx is the parameters UTxO position in the reference inputs as listed', () => {
  const p = planBaseSpendRedeemer(base());
  assert.equal(p.status, 'planned');
  assert.equal(p.paramsIndex, 1);
  assert.equal(p.referenceCount, 3);
  // Reference inputs are not reordered: moving the parameters UTxO in
  // the list moves the hint with it.
  const moved = planBaseSpendRedeemer(base({ referenceInputs: ['protocol-parameters', 'registry-node-33'] }));
  assert.equal(moved.paramsIndex, 0);
});

test('wdrl_idx is counted in the ledger withdrawal order, not the insertion order', () => {
  const p = planBaseSpendRedeemer(base());
  // In insertion order the global credential sits at index 2.
  assert.equal(p.givenWithdrawalIndex, 2);
  // The ledger orders script credentials first, bytewise: aa…, bb…,
  // then the public-key credential — so the global credential is at 0.
  assert.deepEqual(p.orderedWithdrawals, [GLOBAL, SCRIPT_B, PUBKEY_9]);
  assert.equal(p.wdrlIndex, 0);
  assert.notEqual(p.wdrlIndex, p.givenWithdrawalIndex);
});

test('script credentials order bytewise among themselves, public-key credentials after all of them', () => {
  const p = planBaseSpendRedeemer(base({
    withdrawals: [PUBKEY_1, GLOBAL, SCRIPT_B, PUBKEY_9],
    globalCredential: PUBKEY_9,
  }));
  // Even the smallest public-key hash sorts after every script hash.
  assert.deepEqual(p.orderedWithdrawals, [GLOBAL, SCRIPT_B, PUBKEY_1, PUBKEY_9]);
  assert.equal(p.wdrlIndex, 3);
  assert.equal(p.givenWithdrawalIndex, 3); // insertion index coincides here — the ordering above is the rule
});

test('a transaction already in ledger order plans the same index both ways', () => {
  const p = planBaseSpendRedeemer(base({ withdrawals: [GLOBAL, SCRIPT_B, PUBKEY_9] }));
  assert.equal(p.wdrlIndex, 0);
  assert.equal(p.givenWithdrawalIndex, 0);
  const q = planBaseSpendRedeemer(base({ withdrawals: [SCRIPT_B, GLOBAL], globalCredential: SCRIPT_B }));
  assert.equal(q.wdrlIndex, 1); // bb… sorts after aa… in the ledger order
  assert.equal(q.givenWithdrawalIndex, 0);
});

test('a parameters UTxO missing from the reference inputs is unplannable, never given an invented index', () => {
  const p = planBaseSpendRedeemer(base({ paramsRef: 'protocol-parameters-v2' }));
  assert.equal(p.status, 'unplannable');
  assert.deepEqual(p.missing, ['params']);
  assert.equal(p.paramsIndex, null);
  assert.equal(p.wdrlIndex, 0); // the other hint is still computable and reported
});

test('a global credential with no withdrawal is unplannable — no withdraw-zero, no index', () => {
  const p = planBaseSpendRedeemer(base({ withdrawals: [SCRIPT_B, PUBKEY_9] }));
  assert.equal(p.status, 'unplannable');
  assert.deepEqual(p.missing, ['global-withdrawal']);
  assert.equal(p.wdrlIndex, null);
  assert.equal(p.paramsIndex, 1);
});

test('both missing pieces are named together', () => {
  const p = planBaseSpendRedeemer(base({ paramsRef: 'absent', withdrawals: [SCRIPT_B] }));
  assert.equal(p.status, 'unplannable');
  assert.deepEqual(p.missing, ['params', 'global-withdrawal']);
});

test('the same hash under the other credential kind is a different withdrawal', () => {
  const p = planBaseSpendRedeemer(base({ globalCredential: { kind: 'pubkey', hash: GLOBAL.hash } }));
  assert.equal(p.status, 'unplannable');
  assert.deepEqual(p.missing, ['global-withdrawal']);
});

test('uppercase hashes plan and are stated in canonical lowercase', () => {
  const p = planBaseSpendRedeemer(base({
    withdrawals: [PUBKEY_9, SCRIPT_B, { kind: 'script', hash: GLOBAL.hash.toUpperCase() }],
    globalCredential: { kind: 'script', hash: GLOBAL.hash.toUpperCase() },
  }));
  assert.equal(p.status, 'planned');
  assert.equal(p.globalCredential.hash, GLOBAL.hash);
  assert.equal(p.wdrlIndex, 0);
});

test('a modeled transaction that cannot be read is refused, never planned in part', () => {
  assert.throws(() => planBaseSpendRedeemer(base({ referenceInputs: ['a', 'a'] })), /more than once/);
  assert.throws(() => planBaseSpendRedeemer(base({ referenceInputs: ['a', ''] })), /non-empty name/);
  assert.throws(() => planBaseSpendRedeemer(base({ withdrawals: [GLOBAL, GLOBAL] })), /more than once/);
  assert.throws(() => planBaseSpendRedeemer(base({ withdrawals: [{ kind: 'token', hash: GLOBAL.hash }] })), /kind must be pubkey or script/);
  assert.throws(() => planBaseSpendRedeemer(base({ withdrawals: [{ kind: 'script', hash: 'aa'.repeat(20) }] })), /28-byte credential hash/);
  assert.throws(() => planBaseSpendRedeemer(base({ globalCredential: { kind: 'script' } })), /both a kind/);
  assert.throws(() => planBaseSpendRedeemer(base({ paramsRef: ' ' })), /must name one of the reference inputs/);
  assert.throws(() => planBaseSpendRedeemer({ ...base(), extra: 1 }), /unknown field "extra"/);
});

test('planning does not mutate or reorder the modeled lists it was given', () => {
  const input = base();
  const snapshot = JSON.parse(JSON.stringify(input));
  planBaseSpendRedeemer(input);
  assert.deepEqual(input, snapshot);
});

test('the planned hints verify, and each hint fails alone', () => {
  const ok = verifyBaseSpendRedeemer(base(), { paramsIdx: 1, wdrlIdx: 0 });
  assert.equal(ok.status, 'correct');
  assert.equal(ok.valid, true);
  // The insertion-order trap as a claim: wdrl_idx counted as inserted.
  const trap = verifyBaseSpendRedeemer(base(), { paramsIdx: 1, wdrlIdx: 2 });
  assert.equal(trap.status, 'incorrect');
  assert.deepEqual(trap.verdicts, { paramsIdx: true, wdrlIdx: false });
  const wrongParams = verifyBaseSpendRedeemer(base(), { paramsIdx: 0, wdrlIdx: 0 });
  assert.equal(wrongParams.status, 'incorrect');
  assert.deepEqual(wrongParams.verdicts, { paramsIdx: false, wdrlIdx: true });
});

test('an unstated hint is incomplete, never a pass and never a failure', () => {
  const v = verifyBaseSpendRedeemer(base(), { paramsIdx: 1 });
  assert.equal(v.status, 'incomplete');
  assert.deepEqual(v.verdicts, { paramsIdx: true, wdrlIdx: 'not-stated' });
  const none = verifyBaseSpendRedeemer(base(), {});
  assert.equal(none.status, 'incomplete');
  assert.deepEqual(none.verdicts, { paramsIdx: 'not-stated', wdrlIdx: 'not-stated' });
});

test('a malformed claimed hint is refused, never scored', () => {
  assert.throws(() => verifyBaseSpendRedeemer(base(), { paramsIdx: 1.5, wdrlIdx: 0 }), /non-negative integer/);
  assert.throws(() => verifyBaseSpendRedeemer(base(), { paramsIdx: 1, wdrlIdx: -1 }), /non-negative integer/);
  assert.throws(() => verifyBaseSpendRedeemer(base(), { paramsIdx: '1', wdrlIdx: 0 }), /non-negative integer/);
  assert.throws(() => verifyBaseSpendRedeemer(base(), { paramsIdx: 1, wdrlIdx: 0, nodeIdx: 0 }), /only params_idx and wdrl_idx/);
});

test('a claim for an unplannable transaction is reported unplannable, with no claim scored', () => {
  const v = verifyBaseSpendRedeemer(base({ paramsRef: 'absent' }), { paramsIdx: 0, wdrlIdx: 0 });
  assert.equal(v.status, 'unplannable');
  assert.equal(v.valid, false);
  assert.equal(v.verdicts, null);
  assert.deepEqual(v.missing, ['params']);
});

test('every planned pair verifies across a grid of list shapes', () => {
  const shapes = [
    base(),
    base({ referenceInputs: ['protocol-parameters'], withdrawals: [GLOBAL] }),
    base({ withdrawals: [PUBKEY_1, PUBKEY_9, SCRIPT_B, GLOBAL] }),
    base({ withdrawals: [GLOBAL], referenceInputs: ['x', 'y', 'protocol-parameters'] }),
  ];
  for (const shape of shapes) {
    const p = planBaseSpendRedeemer(shape);
    assert.equal(p.status, 'planned');
    const v = verifyBaseSpendRedeemer(shape, { paramsIdx: p.paramsIndex, wdrlIdx: p.wdrlIndex });
    assert.equal(v.valid, true);
    // And the ledger-ordered position is where the ordered map holds it.
    assert.deepEqual(p.orderedWithdrawals[p.wdrlIndex], p.globalCredential);
  }
});

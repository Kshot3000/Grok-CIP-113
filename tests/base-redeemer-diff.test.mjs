import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planBaseSpendRedeemer, diffBaseSpendRedeemer, BASE_REDEEMER_COMPARE_FIELDS } from '../src/domain.js';

// BaseSpendRedeemer comparison — the comparison counterpart to the
// planner/verifier pair. Planning says what a modeled transaction's two
// hints are; comparing says how they change when the transaction itself
// changes first. Both sides are planned by planBaseSpendRedeemer itself,
// so compare and plan can never disagree. Three positions only: the
// insertion-order position is not carried by the redeemer, so it is
// reported by the plan, never counted as a difference of its own.
const GLOBAL = { kind: 'script', hash: 'aa'.repeat(28) };
const SCRIPT_B = { kind: 'script', hash: 'bb'.repeat(28) };
const SCRIPT_0 = { kind: 'script', hash: '00'.repeat(28) };
const PUBKEY_9 = { kind: 'pubkey', hash: '99'.repeat(28) };
const PUBKEY_0 = { kind: 'pubkey', hash: '00'.repeat(28) };
const base = (over = {}) => ({
  referenceInputs: ['registry-node-33', 'protocol-parameters', 'registry-node-55'],
  paramsRef: 'protocol-parameters',
  withdrawals: [PUBKEY_9, SCRIPT_B, GLOBAL],
  globalCredential: GLOBAL,
  ...over,
});

test('the same modeled transaction on both sides compares as unchanged on all three positions', () => {
  const r = diffBaseSpendRedeemer(base(), base());
  assert.equal(r.change, 'unchanged');
  assert.equal(r.unchanged, true);
  assert.deepEqual(r.differences, []);
  assert.deepEqual(r.changedFields, []);
  assert.deepEqual(r.addedRefs, []);
  assert.deepEqual(r.removedRefs, []);
  assert.deepEqual(r.addedWithdrawals, []);
  assert.deepEqual(r.removedWithdrawals, []);
  assert.equal(BASE_REDEEMER_COMPARE_FIELDS.length, 3);
});

test('comparison returns exactly its twelve keys, and each difference exactly four', () => {
  const r = diffBaseSpendRedeemer(base(), base({ referenceInputs: ['global-state-utxo', 'registry-node-33', 'protocol-parameters', 'registry-node-55'] }));
  assert.deepEqual(Object.keys(r).sort(), ['addedRefs', 'addedWithdrawals', 'after', 'before', 'change', 'changedFields', 'differences', 'globalCredential', 'paramsRef', 'removedRefs', 'removedWithdrawals', 'unchanged'].sort());
  assert.equal(Object.keys(r).length, 12);
  for (const diff of r.differences) assert.deepEqual(Object.keys(diff).sort(), ['after', 'before', 'field', 'label']);
});

test('both sides are the planner returns planBaseSpendRedeemer itself produces', () => {
  const afterIn = base({ withdrawals: [SCRIPT_0, PUBKEY_9, SCRIPT_B, GLOBAL] });
  const r = diffBaseSpendRedeemer(base(), afterIn);
  assert.deepEqual(r.before, planBaseSpendRedeemer(base()));
  assert.deepEqual(r.after, planBaseSpendRedeemer(afterIn));
  assert.equal(r.paramsRef, 'protocol-parameters');
  assert.deepEqual(r.globalCredential, GLOBAL);
});

test('a reference input added ahead of the parameters UTxO shifts params_idx alone', () => {
  const r = diffBaseSpendRedeemer(base(), base({ referenceInputs: ['global-state-utxo', 'registry-node-33', 'protocol-parameters', 'registry-node-55'] }));
  assert.equal(r.change, 'hints-changed');
  assert.deepEqual(r.differences, [{ field: 'paramsIdx', label: 'params_idx', before: 1, after: 2 }]);
  assert.deepEqual(r.addedRefs, ['global-state-utxo']);
  assert.deepEqual(r.removedRefs, []);
});

test('a reference input appended after the parameters UTxO changes no hint — the list grew, the redeemer did not', () => {
  const r = diffBaseSpendRedeemer(base(), base({ referenceInputs: ['registry-node-33', 'protocol-parameters', 'registry-node-55', 'global-state-utxo'] }));
  assert.equal(r.change, 'unchanged');
  assert.equal(r.unchanged, true);
  assert.deepEqual(r.addedRefs, ['global-state-utxo']);
});

test('a script withdrawal sorting before the global credential in ledger order shifts wdrl_idx alone', () => {
  const r = diffBaseSpendRedeemer(base(), base({ withdrawals: [PUBKEY_9, SCRIPT_B, GLOBAL, SCRIPT_0] }));
  assert.equal(r.change, 'hints-changed');
  assert.deepEqual(r.differences, [{ field: 'wdrlIdx', label: 'wdrl_idx', before: 0, after: 1 }]);
  assert.deepEqual(r.addedWithdrawals, [SCRIPT_0]);
  assert.deepEqual(r.removedWithdrawals, []);
});

test('a public-key withdrawal inserted first changes no hint — insertion position is not a compared position', () => {
  // Inserted at the head of the list, but the ledger orders every
  // public-key credential after every script credential, so the global
  // credential's ledger position — the only one the redeemer carries —
  // stands still.
  const r = diffBaseSpendRedeemer(base(), base({ withdrawals: [PUBKEY_0, PUBKEY_9, SCRIPT_B, GLOBAL] }));
  assert.equal(r.change, 'unchanged');
  assert.deepEqual(r.addedWithdrawals, [PUBKEY_0]);
});

test('a pure reordering of the withdrawal insertions compares as unchanged even though the insertion index moved', () => {
  const r = diffBaseSpendRedeemer(base(), base({ withdrawals: [GLOBAL, SCRIPT_B, PUBKEY_9] }));
  // The plan's insertion-order index genuinely differs (2 → 0)…
  assert.equal(r.before.givenWithdrawalIndex, 2);
  assert.equal(r.after.givenWithdrawalIndex, 0);
  // …but the redeemer carries the ledger-order index, which did not
  // move, so the comparison is unchanged and nothing was added/removed.
  assert.equal(r.change, 'unchanged');
  assert.deepEqual(r.addedWithdrawals, []);
  assert.deepEqual(r.removedWithdrawals, []);
});

test('dropping the parameters UTxO makes the redeemer unplannable — status and params_idx differ, wdrl_idx does not', () => {
  const r = diffBaseSpendRedeemer(base(), base({ referenceInputs: ['registry-node-33', 'registry-node-55'] }));
  assert.equal(r.change, 'became-unplannable');
  assert.deepEqual(r.differences, [
    { field: 'status', label: 'Status', before: 'planned', after: 'unplannable' },
    { field: 'paramsIdx', label: 'params_idx', before: 1, after: null },
  ]);
  assert.deepEqual(r.removedRefs, ['protocol-parameters']);
  assert.deepEqual(r.after.missing, ['params']);
});

test('dropping the global withdrawal makes the redeemer unplannable — status and wdrl_idx differ, params_idx does not', () => {
  const r = diffBaseSpendRedeemer(base(), base({ withdrawals: [PUBKEY_9, SCRIPT_B] }));
  assert.equal(r.change, 'became-unplannable');
  assert.deepEqual(r.differences, [
    { field: 'status', label: 'Status', before: 'planned', after: 'unplannable' },
    { field: 'wdrlIdx', label: 'wdrl_idx', before: 0, after: null },
  ]);
  assert.deepEqual(r.removedWithdrawals, [GLOBAL]);
  assert.deepEqual(r.after.missing, ['global-withdrawal']);
});

test('restoring the missing piece is became-plannable, the mirror of losing it', () => {
  const r = diffBaseSpendRedeemer(base({ referenceInputs: ['registry-node-33', 'registry-node-55'] }), base());
  assert.equal(r.change, 'became-plannable');
  assert.deepEqual(r.changedFields, ['Status', 'params_idx']);
});

test('two unplannable versions missing different pieces are still-unplannable and differ on the hints alone', () => {
  const before = base({ referenceInputs: ['registry-node-33', 'registry-node-55'] }); // missing params; wdrl 0 computable
  const after = base({ withdrawals: [PUBKEY_9, SCRIPT_B] }); // missing global withdrawal; params 1 computable
  const r = diffBaseSpendRedeemer(before, after);
  assert.equal(r.change, 'still-unplannable');
  // Status is identical on both sides, so it is NOT a difference — the
  // different missing pieces show up exactly as the two hints' null-ness.
  assert.deepEqual(r.differences, [
    { field: 'paramsIdx', label: 'params_idx', before: null, after: 1 },
    { field: 'wdrlIdx', label: 'wdrl_idx', before: 0, after: null },
  ]);
});

test('different parameters references are different redeemers — refused, never compared', () => {
  assert.throws(
    () => diffBaseSpendRedeemer(base(), base({ paramsRef: 'protocol-parameters-v2', referenceInputs: ['registry-node-33', 'protocol-parameters-v2', 'registry-node-55'] })),
    /different protocol parameters references/,
  );
});

test('different global credentials are different redeemers — refused, never compared', () => {
  assert.throws(
    () => diffBaseSpendRedeemer(base(), base({ globalCredential: SCRIPT_B })),
    /different programmableLogicGlobal credentials/,
  );
});

test('the same global credential in different hex case is the same redeemer and compares as unchanged', () => {
  const upper = { kind: 'script', hash: 'AA'.repeat(28) };
  const r = diffBaseSpendRedeemer(base(), base({ globalCredential: upper, withdrawals: [PUBKEY_9, SCRIPT_B, upper] }));
  assert.equal(r.change, 'unchanged');
});

test('a version that cannot be read is refused with the planner reason, on either side', () => {
  const dup = base({ referenceInputs: ['registry-node-33', 'protocol-parameters', 'registry-node-33'] });
  assert.throws(() => diffBaseSpendRedeemer(base(), dup), /listed more than once/);
  assert.throws(() => diffBaseSpendRedeemer(dup, base()), /listed more than once/);
});

test('comparing mutates neither modeled transaction', () => {
  const before = base(), after = base({ referenceInputs: ['global-state-utxo', 'registry-node-33', 'protocol-parameters', 'registry-node-55'] });
  const snapshot = JSON.stringify([before, after]);
  diffBaseSpendRedeemer(before, after);
  assert.equal(JSON.stringify([before, after]), snapshot);
});

test('app and README carry the comparison at the current version', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /diffBaseSpendRedeemer/);
  assert.match(app, /baseRedeemerDiffPreview/);
  assert.match(app, /base-redeemer-diff-after-refs/);
  assert.match(app, /base-redeemer-diff-after-withdrawals/);
  assert.match(app, /base-redeemer-diff-result/);
  assert.match(app, /v1\.102/);
  assert.match(readme, /BaseSpendRedeemer comparison/);
});

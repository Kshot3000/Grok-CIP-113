import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkUserStateReferences, USER_STATE_VERDICTS } from '../src/domain.js';

// CIP-113 user-state reference inputs (spec: "Reference Inputs" item 4
// and "Existing substandards", re-read 2026-10-11): a substandard may
// manage no user state, one state per user involved in the spending,
// or one state per user involved in the transfer itself; where it
// manages state, the involved users prove it with reference inputs.
// The requirement is conditional on the substandard's own mode; the
// query method is reported, never scored.
const ready = () => ({
  stateMode: 'transfer-users',
  senderState: 'included',
  receiverState: 'included',
  stateQuery: 'nft',
});

test('a transfer including both state inputs under a transfer-users substandard is ready', () => {
  const v = checkUserStateReferences(ready());
  assert.equal(v.status, 'ready');
  assert.equal(v.valid, true);
  assert.deepEqual(Object.keys(v.verdicts), USER_STATE_VERDICTS.map(([f]) => f));
  assert.deepEqual(v.verdicts, { senderStateIncluded: true, receiverStateIncluded: true });
});

test('an omitted sender state input fails the first position in either state mode', () => {
  const transfer = checkUserStateReferences({ ...ready(), senderState: 'omitted' });
  assert.equal(transfer.verdicts.senderStateIncluded, false);
  assert.equal(transfer.verdicts.receiverStateIncluded, true);
  assert.equal(transfer.valid, false);
  assert.equal(transfer.status, 'not-ready');
  const spending = checkUserStateReferences({ stateMode: 'spending-user', senderState: 'omitted', receiverState: 'not-applicable', stateQuery: 'nft' });
  assert.equal(spending.verdicts.senderStateIncluded, false);
  assert.equal(spending.valid, false);
});

test('an omitted receiver state input fails the second position under a transfer-users substandard', () => {
  const v = checkUserStateReferences({ ...ready(), receiverState: 'omitted' });
  assert.equal(v.verdicts.receiverStateIncluded, false);
  assert.equal(v.verdicts.senderStateIncluded, true);
  assert.equal(v.valid, false);
});

test('the receiver position carries no verdict under a spending-user substandard', () => {
  const v = checkUserStateReferences({ stateMode: 'spending-user', senderState: 'included', receiverState: 'not-applicable', stateQuery: 'nft' });
  assert.equal(v.verdicts.senderStateIncluded, true);
  assert.equal(v.verdicts.receiverStateIncluded, null);
  assert.equal(v.valid, true);
  assert.equal(v.status, 'ready');
});

test('a stateless substandard requires nothing: both positions verdictless, ready vacuously', () => {
  const v = checkUserStateReferences({ stateMode: 'none', senderState: 'not-applicable', receiverState: 'not-applicable', stateQuery: 'not-applicable' });
  assert.deepEqual(v.verdicts, { senderStateIncluded: null, receiverStateIncluded: null });
  assert.equal(v.valid, true);
  assert.equal(v.status, 'ready');
  assert.equal(v.stateQueriedByNft, false);
});

test('each scored position fails independently: the verdicts are separate positions', () => {
  const cases = [
    [{ senderState: 'omitted' }, 'senderStateIncluded'],
    [{ receiverState: 'omitted' }, 'receiverStateIncluded'],
  ];
  for (const [patch, key] of cases) {
    const v = checkUserStateReferences({ ...ready(), ...patch });
    assert.equal(v.verdicts[key], false, key);
    assert.equal(Object.values(v.verdicts).filter(x => x === false).length, 1, key);
    assert.equal(v.valid, false, key);
  }
});

test('the query method is reported, never scored: ready with a non-NFT query method', () => {
  const v = checkUserStateReferences({ ...ready(), stateQuery: 'other' });
  assert.equal(v.valid, true);
  assert.equal(v.status, 'ready');
  assert.equal(v.stateQuery, 'other');
  assert.equal(v.stateQueriedByNft, false);
});

test('an NFT query is reported as the spec-stated method — and cannot rescue an omitted state input', () => {
  const pinned = checkUserStateReferences(ready());
  assert.equal(pinned.stateQueriedByNft, true);
  const failing = checkUserStateReferences({ ...ready(), receiverState: 'omitted' });
  assert.equal(failing.stateQueriedByNft, true);
  assert.equal(failing.valid, false);
});

test('state named where the substandard manages no state is refused', () => {
  assert.throws(() => checkUserStateReferences({ stateMode: 'none', senderState: 'included', receiverState: 'not-applicable', stateQuery: 'not-applicable' }), /names user state where the substandard manages no state/i);
  assert.throws(() => checkUserStateReferences({ stateMode: 'none', senderState: 'not-applicable', receiverState: 'not-applicable', stateQuery: 'nft' }), /names user state where the substandard manages no state/i);
});

test('a sender input declared not-applicable in a state mode is refused', () => {
  for (const stateMode of ['spending-user', 'transfer-users']) {
    assert.throws(() => checkUserStateReferences({ stateMode, senderState: 'not-applicable', receiverState: stateMode === 'transfer-users' ? 'included' : 'not-applicable', stateQuery: 'nft' }), /sender state input not-applicable in a state mode/i, stateMode);
  }
});

test('a receiver input declared not-applicable under a transfer-users mode is refused', () => {
  assert.throws(() => checkUserStateReferences({ ...ready(), receiverState: 'not-applicable' }), /receiver state input not-applicable where the mode involves the receiver/i);
});

test('a receiver input named under a spending-user mode is refused', () => {
  for (const receiverState of ['included', 'omitted']) {
    assert.throws(() => checkUserStateReferences({ stateMode: 'spending-user', senderState: 'included', receiverState, stateQuery: 'nft' }), /receiver state input where the mode involves only the spending user/i, receiverState);
  }
});

test('a query method declared not-applicable while a mode manages state is refused', () => {
  assert.throws(() => checkUserStateReferences({ ...ready(), stateQuery: 'not-applicable' }), /state query method not-applicable while the substandard manages state/i);
});

test('refusal discipline: a non-object profile is refused', () => {
  assert.throws(() => checkUserStateReferences(null), /must be an object/i);
  assert.throws(() => checkUserStateReferences([]), /must be an object/i);
  assert.throws(() => checkUserStateReferences('transfer-users'), /must be an object/i);
});

test('refusal discipline: unknown and missing fields are refused, never scored in part', () => {
  assert.throws(() => checkUserStateReferences({ ...ready(), stateNftPolicy: 'aa'.repeat(28) }), /unknown field/i);
  const { receiverState, ...missing } = ready();
  assert.throws(() => checkUserStateReferences(missing), /missing its "receiverState" field/i);
});

test('refusal discipline: unknown values in any field are refused', () => {
  assert.throws(() => checkUserStateReferences({ ...ready(), stateMode: 'everyone' }), /state mode must be one of/i);
  assert.throws(() => checkUserStateReferences({ ...ready(), senderState: 'partially' }), /sender state field must be one of/i);
  assert.throws(() => checkUserStateReferences({ ...ready(), receiverState: 'partially' }), /receiver state field must be one of/i);
  assert.throws(() => checkUserStateReferences({ ...ready(), stateQuery: 'a-lookup-table' }), /state query field must be one of/i);
});

test('the checker does not mutate its claim', () => {
  const claim = ready();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkUserStateReferences(claim);
  assert.deepEqual(claim, snapshot);
});

test('the entered profile is carried through unchanged in the result', () => {
  const v = checkUserStateReferences(ready());
  assert.equal(v.stateMode, 'transfer-users');
  assert.equal(v.senderState, 'included');
  assert.equal(v.receiverState, 'included');
  assert.equal(v.stateQuery, 'nft');
});

test('app wires the user-state checker: panel, verdicts, query reported-never-scored, conditional grade, honest boundary, v1.256', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkUserStateReferences/);
  assert.match(app, /user-state-mode/);
  assert.match(app, /user-state-result/);
  assert.match(app, /USER STATE · LOCAL MODEL/);
  assert.match(app, /CONDITIONAL ON THE SUBSTANDARD/);
  assert.match(app, /REPORTED, NEVER SCORED/);
  assert.match(app, /inspected no transfer, read no substandard, and no chain state/);
  assert.match(app, /v1\.256/);
});

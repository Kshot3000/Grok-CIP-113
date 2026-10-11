import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkGlobalDispatch, GLOBAL_DISPATCH_ACTIONS } from '../src/domain.js';

// programmableLogicGlobal dispatch (spec: Layer 2 components,
// the Transfer section, and "Architecture: Delegation Pattern",
// re-read 2026-10-11): the global validator is a dispatcher, not
// the validator of record — parameterized by the delegates'
// credentials, it reads the declared action from its redeemer and
// requires that action's delegate to have been invoked in the
// transaction. It performs no validation of its own, and its
// redeemer arms carry no payload.
const TRANSFER = { kind: 'script', hash: '33'.repeat(28) };
const THIRD_PARTY = { kind: 'script', hash: '44'.repeat(28) };
const UNFRACKING = { kind: 'script', hash: '55'.repeat(28) };
const TOKEN_LOGIC = { kind: 'script', hash: 'ee'.repeat(28) };
const GLOBAL = { kind: 'script', hash: 'aa'.repeat(28) };

const wiring = () => ({ transfer: { ...TRANSFER }, thirdParty: { ...THIRD_PARTY }, unfracking: { ...UNFRACKING } });

const conforming = () => ({
  action: 'transfer',
  delegates: wiring(),
  withdrawals: [{ ...GLOBAL }, { ...TRANSFER }, { ...TOKEN_LOGIC }],
});

test('a conforming dispatch passes: the declared action\u2019s delegate is among the withdrawals, kind and hash both', () => {
  const v = checkGlobalDispatch(conforming());
  assert.equal(v.status, 'conforming');
  assert.equal(v.valid, true);
  assert.equal(v.action, 'transfer');
  assert.deepEqual(v.delegate, TRANSFER);
  assert.equal(v.delegateInvoked, true);
  assert.deepEqual(v.verdicts, { delegateInvoked: true, otherDelegatesInvoked: null });
});

test('each action dispatches to its own delegate: the same withdrawals conform for transfer and fail for third-party', () => {
  const claim = conforming();
  assert.equal(checkGlobalDispatch(claim).valid, true);
  claim.action = 'third-party';
  const v = checkGlobalDispatch(claim);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-conforming');
  assert.deepEqual(v.delegate, THIRD_PARTY);
  assert.equal(v.delegateInvoked, false);
  claim.withdrawals.push({ ...THIRD_PARTY });
  assert.equal(checkGlobalDispatch(claim).valid, true);
});

test('unfracking dispatches to the unfracking delegate alone', () => {
  const claim = conforming();
  claim.action = 'unfracking';
  claim.withdrawals = [{ ...UNFRACKING }];
  const v = checkGlobalDispatch(claim);
  assert.equal(v.valid, true);
  assert.deepEqual(v.delegate, UNFRACKING);
});

test('the other delegates carry NO verdict: another delegate invoked alongside the declared one still conforms', () => {
  const claim = conforming();
  claim.withdrawals.push({ ...THIRD_PARTY }, { ...UNFRACKING });
  const v = checkGlobalDispatch(claim);
  assert.equal(v.valid, true);
  assert.equal(v.verdicts.otherDelegatesInvoked, null);
  assert.deepEqual(v.otherDelegates.map(o => o.action), ['third-party', 'unfracking']);
  assert.deepEqual(v.otherDelegates.map(o => o.invoked), [true, true]);
});

test('invoking only the wrong delegate fails on the declared delegate\u2019s absence, reported per other delegate', () => {
  const claim = conforming();
  claim.withdrawals = [{ ...THIRD_PARTY }];
  const v = checkGlobalDispatch(claim);
  assert.equal(v.valid, false);
  assert.equal(v.delegateInvoked, false);
  assert.deepEqual(v.otherDelegates.map(o => o.invoked), [true, false]);
});

test('a delegate present with the wrong kind is not invoked: kind and hash must both match', () => {
  const claim = conforming();
  claim.withdrawals = [{ kind: 'pubkey', hash: TRANSFER.hash }];
  const v = checkGlobalDispatch(claim);
  assert.equal(v.valid, false);
  assert.equal(v.delegateInvoked, false);
});

test('an empty withdrawal list invokes nothing and fails the one position', () => {
  const claim = conforming();
  claim.withdrawals = [];
  const v = checkGlobalDispatch(claim);
  assert.equal(v.valid, false);
  assert.equal(v.delegateInvoked, false);
  assert.deepEqual(v.otherDelegates.map(o => o.invoked), [false, false]);
});

test('unrelated withdrawals — the global credential itself, a token\u2019s logic — neither satisfy nor block the dispatch', () => {
  const claim = conforming();
  claim.withdrawals = [{ ...GLOBAL }, { ...TOKEN_LOGIC }];
  const v = checkGlobalDispatch(claim);
  assert.equal(v.valid, false);
  claim.withdrawals.push({ ...TRANSFER });
  assert.equal(checkGlobalDispatch(claim).valid, true);
});

test('the wiring is read as entered: re-pointing the transfer delegate in the wiring moves the requirement to the new credential', () => {
  const claim = conforming();
  claim.delegates.transfer = { kind: 'script', hash: '66'.repeat(28) };
  assert.equal(checkGlobalDispatch(claim).valid, false);
  claim.withdrawals.push({ kind: 'script', hash: '66'.repeat(28) });
  assert.equal(checkGlobalDispatch(claim).valid, true);
});

test('two actions may name the same modeled delegate credential: invocation is judged per action against it', () => {
  const claim = conforming();
  claim.delegates.thirdParty = { ...TRANSFER };
  claim.action = 'third-party';
  const v = checkGlobalDispatch(claim);
  assert.equal(v.valid, true);
  assert.deepEqual(v.delegate, TRANSFER);
});

test('hex case is canonicalised: an uppercase withdrawal still names the delegate', () => {
  const claim = conforming();
  claim.withdrawals = [{ kind: 'script', hash: TRANSFER.hash.toUpperCase() }];
  const v = checkGlobalDispatch(claim);
  assert.equal(v.valid, true);
  assert.equal(v.delegateInvoked, true);
});

test('the action list is exactly the three dispatcher arms', () => {
  assert.deepEqual([...GLOBAL_DISPATCH_ACTIONS], ['transfer', 'third-party', 'unfracking']);
});

test('refusal discipline: an unknown action is refused — the dispatcher\u2019s arms are the three actions and nothing else', () => {
  assert.throws(() => checkGlobalDispatch({ ...conforming(), action: 'mint' }), /declared action must be transfer, third-party, or unfracking/);
  assert.throws(() => checkGlobalDispatch({ ...conforming(), action: 'TransferAct' }), /declared action must be/);
});

test('refusal discipline: a payload on the dispatch claim is refused — the redeemer arms carry no payload', () => {
  assert.throws(() => checkGlobalDispatch({ ...conforming(), proofs: [] }), /unknown field "proofs"/);
  assert.throws(() => checkGlobalDispatch({ ...conforming(), registryNodeIdx: 0 }), /carry no payload/);
});

test('refusal discipline: unknown or missing fields, incomplete wiring, a malformed delegate, and a duplicated withdrawal are refused, never scored', () => {
  const missing = conforming();
  delete missing.withdrawals;
  assert.throws(() => checkGlobalDispatch(missing), /missing its "withdrawals"/);
  const noDelegate = conforming();
  delete noDelegate.delegates.unfracking;
  assert.throws(() => checkGlobalDispatch(noDelegate), /missing its "unfracking" delegate/);
  assert.throws(() => checkGlobalDispatch({ ...conforming(), delegates: { ...wiring(), issuance: { ...TRANSFER } } }), /unknown field "issuance"/);
  assert.throws(() => checkGlobalDispatch({ ...conforming(), delegates: { ...wiring(), transfer: { kind: 'script', hash: '33'.repeat(10) } } }), /28-byte credential hash/);
  assert.throws(() => checkGlobalDispatch({ ...conforming(), delegates: { ...wiring(), transfer: { kind: 'native', hash: TRANSFER.hash } } }), /kind must be pubkey or script/);
  assert.throws(() => checkGlobalDispatch({ ...conforming(), withdrawals: [{ ...TRANSFER }, { ...TRANSFER }] }), /listed more than once/);
  assert.throws(() => checkGlobalDispatch(null), /must be an object/);
});

test('the checker does not mutate its claim', () => {
  const claim = conforming();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkGlobalDispatch(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the global dispatch checker: panel, verdicts, honest boundary, v1.122', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkGlobalDispatch/);
  assert.match(app, /global-dispatch-withdrawals/);
  assert.match(app, /GLOBAL DISPATCH · LOCAL MODEL/);
  assert.match(app, /NO VERDICT/);
  assert.match(app, /v1\.122/);
});

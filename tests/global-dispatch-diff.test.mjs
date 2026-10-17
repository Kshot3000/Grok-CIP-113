import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkGlobalDispatch, diffGlobalDispatch, GLOBAL_DISPATCH_COMPARE_FIELDS } from '../src/domain.js';

// programmableLogicGlobal dispatch impact (spec: Protocol
// upgradability — "Consequences for integrators", re-read
// 2026-10-11): delegate credentials are read live, so a dispatch
// that conformed against the wiring and withdrawals as they stood
// can be staled by a later change — an upgrade re-pointing the
// declared action's delegate, or assembly dropping its withdrawal.
// Both versions are checked through checkGlobalDispatch itself, and
// three positions are compared: the status, the delegate the wiring
// names for the declared action, and the one verdict.
const TRANSFER = { kind: 'script', hash: '33'.repeat(28) };
const THIRD_PARTY = { kind: 'script', hash: '44'.repeat(28) };
const UNFRACKING = { kind: 'script', hash: '55'.repeat(28) };
const NEW_TRANSFER = { kind: 'script', hash: '66'.repeat(28) };
const GLOBAL = { kind: 'script', hash: 'aa'.repeat(28) };
const TOKEN_LOGIC = { kind: 'script', hash: 'ee'.repeat(28) };

const wiring = () => ({ transfer: { ...TRANSFER }, thirdParty: { ...THIRD_PARTY }, unfracking: { ...UNFRACKING } });
const conforming = () => ({ action: 'transfer', delegates: wiring(), withdrawals: [{ ...GLOBAL }, { ...TRANSFER }, { ...TOKEN_LOGIC }] });

test('an unchanged dispatch compares as unchanged on all three positions', () => {
  const d = diffGlobalDispatch(conforming(), conforming());
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.equal(d.action, 'transfer');
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 3);
  assert.deepEqual(d.wiringChangedFields, []);
  assert.deepEqual(d.addedWithdrawals, []);
  assert.deepEqual(d.removedWithdrawals, []);
  assert.equal(d.otherDelegatesChanged, false);
  assert.deepEqual([...GLOBAL_DISPATCH_COMPARE_FIELDS].map(f => f[0]), ['status', 'delegate', 'delegateInvoked']);
});

test('dropping the declared delegate\u2019s withdrawal makes the dispatch BECAME NOT CONFORMING, on the status and verdict positions', () => {
  const after = conforming();
  after.withdrawals = [{ ...GLOBAL }, { ...TOKEN_LOGIC }];
  const d = diffGlobalDispatch(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Delegate invoked']);
  assert.deepEqual(d.removedWithdrawals, [TRANSFER]);
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, false);
});

test('restoring the declared delegate\u2019s withdrawal makes the dispatch BECAME CONFORMING', () => {
  const before = conforming();
  before.withdrawals = [{ ...GLOBAL }];
  const d = diffGlobalDispatch(before, conforming());
  assert.equal(d.change, 'became-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Delegate invoked']);
  assert.deepEqual(d.addedWithdrawals, [TRANSFER, TOKEN_LOGIC]);
});

test('an upgrade re-pointing the declared delegate to a credential the transaction also invokes is REQUIREMENT CHANGED: conforming on both sides, a different delegate', () => {
  const after = conforming();
  after.delegates.transfer = { ...NEW_TRANSFER };
  after.withdrawals = [{ ...GLOBAL }, { ...NEW_TRANSFER }, { ...TOKEN_LOGIC }];
  const d = diffGlobalDispatch(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Declared action\u2019s delegate']);
  assert.deepEqual(d.differences[0].before, TRANSFER);
  assert.deepEqual(d.differences[0].after, NEW_TRANSFER);
  assert.deepEqual(d.wiringChangedFields, ['transfer']);
});

test('an upgrade re-pointing the declared delegate to a credential the transaction does not invoke is BECAME NOT CONFORMING — the conformance story takes precedence over the delegate\u2019s move', () => {
  const after = conforming();
  after.delegates.transfer = { ...NEW_TRANSFER };
  const d = diffGlobalDispatch(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Declared action\u2019s delegate', 'Delegate invoked']);
  assert.deepEqual(d.wiringChangedFields, ['transfer']);
});

test('a dispatch not conforming on both sides whose required delegate moved underneath it is STILL NOT CONFORMING', () => {
  const before = conforming();
  before.withdrawals = [{ ...GLOBAL }];
  const after = conforming();
  after.delegates.transfer = { ...NEW_TRANSFER };
  after.withdrawals = [{ ...GLOBAL }];
  const d = diffGlobalDispatch(before, after);
  assert.equal(d.change, 'still-not-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, false);
  assert.deepEqual(d.changedFields, ['Declared action\u2019s delegate']);
});

test('re-pointing an UNDECLARED action\u2019s delegate moves no position of this dispatch: reported as a wiring change, never counted (pinned)', () => {
  const after = conforming();
  after.delegates.thirdParty = { ...NEW_TRANSFER };
  const d = diffGlobalDispatch(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.wiringChangedFields, ['third-party']);
});

test('another delegate becoming invoked is reported, never counted: the checker gives it NO verdict, so the comparison invents no prohibition (pinned)', () => {
  const after = conforming();
  after.withdrawals.push({ ...THIRD_PARTY });
  const d = diffGlobalDispatch(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.otherDelegatesChanged, true);
  assert.deepEqual(d.addedWithdrawals, [THIRD_PARTY]);
});

test('an unrelated withdrawal joining or leaving changes no position and is reported as the list\u2019s own change', () => {
  const after = conforming();
  after.withdrawals = [{ ...GLOBAL }, { ...TRANSFER }];
  const d = diffGlobalDispatch(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.removedWithdrawals, [TOKEN_LOGIC]);
  assert.equal(d.otherDelegatesChanged, false);
});

test('hex case alone is the same dispatch: an uppercase delegate hash in the after wiring compares as unchanged', () => {
  const after = conforming();
  after.delegates.transfer = { kind: 'script', hash: TRANSFER.hash.toUpperCase() };
  const d = diffGlobalDispatch(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.wiringChangedFields, []);
});

test('a third-party dispatch compares under its own arm: its delegate is the position that moves', () => {
  const before = { action: 'third-party', delegates: wiring(), withdrawals: [{ ...THIRD_PARTY }] };
  const after = { action: 'third-party', delegates: wiring(), withdrawals: [{ ...GLOBAL }] };
  const d = diffGlobalDispatch(before, after);
  assert.equal(d.action, 'third-party');
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.before.delegate, THIRD_PARTY);
});

test('refusal discipline: two versions declaring different actions are refused — a comparison tracks one dispatch', () => {
  const after = conforming();
  after.action = 'unfracking';
  assert.throws(() => diffGlobalDispatch(conforming(), after), /declare different actions/);
});

test('refusal discipline: a version that cannot be read is refused on either side with the checker\u2019s reason, never compared around', () => {
  const badAfter = conforming();
  badAfter.withdrawals = [{ ...TRANSFER }, { ...TRANSFER }];
  assert.throws(() => diffGlobalDispatch(conforming(), badAfter), /listed more than once/);
  const badBefore = conforming();
  badBefore.delegates.transfer = { kind: 'script', hash: '33'.repeat(10) };
  assert.throws(() => diffGlobalDispatch(badBefore, conforming()), /28-byte credential hash/);
  assert.throws(() => diffGlobalDispatch({ ...conforming(), proofs: [] }, conforming()), /carry no payload/);
});

test('the comparison does not mutate either claim, and its two sides are the checker\u2019s own verdicts', () => {
  const before = conforming();
  const after = conforming();
  after.withdrawals = [{ ...GLOBAL }];
  const bSnap = JSON.parse(JSON.stringify(before));
  const aSnap = JSON.parse(JSON.stringify(after));
  const d = diffGlobalDispatch(before, after);
  assert.deepEqual(before, bSnap);
  assert.deepEqual(after, aSnap);
  assert.deepEqual(d.before, checkGlobalDispatch(bSnap));
  assert.deepEqual(d.after, checkGlobalDispatch(aSnap));
});

test('app wires the global dispatch impact comparison: panel, verdicts, honest boundary, v1.227', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffGlobalDispatch/);
  assert.match(app, /global-dispatch-diff-after-delegates/);
  assert.match(app, /global-dispatch-diff-after-withdrawals/);
  assert.match(app, /GLOBAL DISPATCH IMPACT · LOCAL MODEL/);
  assert.match(app, /BECAME NOT CONFORMING/);
  assert.match(app, /REQUIREMENT CHANGED/);
  assert.match(app, /v1\.227/);
});

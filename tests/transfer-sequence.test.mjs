import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, formatUnits, simulateTransferSequence, toUnits, LEDGER_ACCOUNTS } from '../src/domain.js';

const RWA = fromTemplate('rwa'); // supply 1,000,000 · cap 10,000 · allowlist + pause + eligibility on
const DISTRIBUTION = [
  { from: 'issuer', to: 'approved', amount: '250' },
  { from: 'approved', to: 'pending', amount: '100' },
  { from: 'approved', to: 'blocked', amount: '50' },
  { from: 'issuer', to: 'approved', amount: '100' },
];
const balanceSum = r => Object.values(r.balances).reduce((sum, v) => sum + BigInt(v), 0n);

test('formatUnits renders BigInt base units exactly, past float precision', () => {
  assert.equal(formatUnits(250000000n, 6), '250');
  assert.equal(formatUnits(1500000n, 6), '1.5');
  assert.equal(formatUnits(1n, 6), '0.000001');
  assert.equal(formatUnits(0n, 6), '0');
  assert.equal(formatUnits(5n, 0), '5');
  assert.equal(formatUnits(1000000n, 6), '1');
  assert.equal(formatUnits(123456789123456789n, 6), '123456789123.456789');
  assert.equal(formatUnits(-1500000n, 6), '-1.5');
  assert.throws(() => formatUnits(250, 6));
  assert.throws(() => formatUnits(1n, 7));
  assert.throws(() => formatUnits(1n, 1.5));
});

test('the ledger starts with the issuer holding the full designed supply', () => {
  assert.deepEqual(Object.keys(LEDGER_ACCOUNTS), ['issuer', 'approved', 'pending', 'blocked']);
  const r = simulateTransferSequence(RWA, [{ from: 'issuer', to: 'issuer', amount: '1' }]);
  assert.equal(r.balances.issuer, toUnits(RWA.supply, RWA.decimals).toString());
  assert.equal(r.balances.approved, '0');
  assert.equal(r.balances.pending, '0');
  assert.equal(r.balances.blocked, '0');
});

test('distribution sequence: denials block their step and later steps still evaluate', () => {
  const r = simulateTransferSequence(RWA, DISTRIBUTION);
  assert.equal(r.invalid, false);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, false, false, true]);
  assert.equal(r.appliedCount, 2);
  // Step 2 is denied on access + eligibility; step 3 on the frozen recipient.
  assert.ok(r.steps[1].checks.find(c => c.name === 'Transfer access' && !c.pass));
  assert.ok(r.steps[1].checks.find(c => c.name === 'Eligibility requirement' && !c.pass));
  assert.ok(r.steps[2].checks.find(c => c.name === 'Issuer controls' && !c.pass));
  // Blocked steps moved nothing; the second funding (step 4) still applied.
  assert.equal(r.balances.issuer, '999650000000');
  assert.equal(r.balances.approved, '350000000');
  assert.equal(r.balances.pending, '0');
  assert.equal(r.balances.blocked, '0');
  assert.equal(r.transferredBaseUnits, '350000000');
  assert.equal(balanceSum(r), toUnits(RWA.supply, RWA.decimals));
});

test('the transfer cap is per transfer, not cumulative across a sequence', () => {
  const atCap = { from: 'issuer', to: 'approved', amount: RWA.limit };
  const r = simulateTransferSequence(RWA, [atCap, atCap]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true]);
  assert.equal(r.balances.approved, (2n * toUnits(RWA.limit, RWA.decimals)).toString());
  assert.equal(balanceSum(r), toUnits(RWA.supply, RWA.decimals));
});

test('an overspend fails on the sender balance left by earlier steps', () => {
  const r = simulateTransferSequence(RWA, [
    { from: 'issuer', to: 'approved', amount: '200' },
    { from: 'approved', to: 'issuer', amount: '150' },
    { from: 'approved', to: 'issuer', amount: '100' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, false]);
  const failing = r.steps[2].checks.filter(c => !c.pass);
  assert.deepEqual(failing.map(c => c.name), ['Sender balance']);
  assert.match(failing[0].detail, /holds only 50 PRA/);
  assert.equal(r.balances.approved, '50000000');
  assert.equal(balanceSum(r), toUnits(RWA.supply, RWA.decimals));
});

test('a paused design blocks every step and the ledger never moves', () => {
  const r = simulateTransferSequence({ ...RWA, paused: true }, DISTRIBUTION);
  assert.deepEqual(r.steps.map(s => s.allowed), [false, false, false, false]);
  assert.ok(r.steps.every(s => s.checks.find(c => c.name === 'Issuer controls' && !c.pass)));
  assert.equal(r.balances.issuer, toUnits(RWA.supply, RWA.decimals).toString());
  assert.equal(r.transferredBaseUnits, '0');
});

test('with issuer controls off, a frozen participant can receive and send', () => {
  const open = { ...RWA, pausable: false };
  const r = simulateTransferSequence(open, [
    { from: 'issuer', to: 'blocked', amount: '10' },
    { from: 'blocked', to: 'approved', amount: '4' },
  ]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true]);
  assert.equal(r.balances.blocked, '6000000');
});

test('a frozen sender is named by the issuer-controls check when controls are on', () => {
  const r = simulateTransferSequence(RWA, [{ from: 'blocked', to: 'approved', amount: '1' }]);
  assert.equal(r.steps[0].allowed, false);
  const controls = r.steps[0].checks.find(c => c.name === 'Issuer controls');
  assert.equal(controls.pass, false);
  assert.match(controls.detail, /sender is frozen/i);
});

test('an amount the design cannot represent fails its step without throwing', () => {
  const ticket = fromTemplate('ticket'); // 0 decimals
  const r = simulateTransferSequence(ticket, [
    { from: 'issuer', to: 'approved', amount: '1.5' },
    { from: 'issuer', to: 'approved', amount: '2' },
  ]);
  assert.equal(r.steps[0].allowed, false);
  assert.equal(r.steps[0].amountBaseUnits, null);
  assert.deepEqual(r.steps[0].checks.map(c => c.name), ['Valid amount']);
  // The failed step consumed nothing, so the next step still applies.
  assert.equal(r.steps[1].allowed, true);
  assert.equal(r.balances.approved, '2');
});

test('unknown accounts fail their step and move nothing', () => {
  const r = simulateTransferSequence(RWA, [{ from: 'issuer', to: 'stranger', amount: '1' }]);
  assert.equal(r.steps[0].allowed, false);
  assert.deepEqual(r.steps[0].checks.map(c => c.name), ['Known accounts']);
  assert.equal(r.balances.issuer, toUnits(RWA.supply, RWA.decimals).toString());
});

test('a self-transfer applies and leaves the balance unchanged', () => {
  const r = simulateTransferSequence(RWA, [{ from: 'issuer', to: 'issuer', amount: '10' }]);
  assert.equal(r.steps[0].allowed, true);
  assert.equal(r.balances.issuer, toUnits(RWA.supply, RWA.decimals).toString());
  assert.equal(r.transferredBaseUnits, '10000000');
});

test('an invalid design returns its errors instead of a ledger result', () => {
  const bad = { ...RWA, ticker: 'lowercase' };
  const r = simulateTransferSequence(bad, DISTRIBUTION);
  assert.equal(r.invalid, true);
  assert.ok(r.errors.length > 0);
  assert.deepEqual(r.steps, []);
  assert.equal(r.appliedCount, 0);
});

test('sequence shape is guarded: 1–12 well-formed transfers', () => {
  assert.throws(() => simulateTransferSequence(RWA, []));
  assert.throws(() => simulateTransferSequence(RWA, Array(13).fill({ from: 'issuer', to: 'approved', amount: '1' })));
  assert.throws(() => simulateTransferSequence(RWA, 'not-an-array'));
  assert.throws(() => simulateTransferSequence(RWA, [null]));
  assert.throws(() => simulateTransferSequence(RWA, [['issuer', 'approved', '1']]));
});

test('the studio wires the sequence lab into the Test step', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="seq-simulate"/);
  assert.match(app, /data-seq-preset/);
  assert.match(app, /simulateTransferSequence\(state\.design/);
  assert.match(app, /id="seq-result"/);
  // The lab keeps the honesty boundary in its own copy.
  assert.match(app, /A modeled ledger only: balances are fictional, no wallet or on-chain balance is read/);
  // Picking a design input or a new template invalidates a stale sequence result.
  assert.match(app, /state\.design\[el\.dataset\.design\]=value;state\.simulation=null;state\.seqResult=null;/);
  assert.match(app, /fromTemplate\(target\.dataset\.template\);state\.simulation=null;state\.seqResult=null;/);
});
